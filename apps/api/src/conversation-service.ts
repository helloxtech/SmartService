import {
    buildCrossLanguageRetrievalQuestion,
    buildQuestionPartEvidenceScope,
    buildRetrievalQuestions,
    createApprovedManualAnswer,
    createConversationalAcknowledgement,
    createExplicitStableFactAnswer,
    createSafeClarification,
    createSafeHandoff,
    detectConversationLanguage,
    enforceCustomerControlledHandoff,
    evaluateDeterministicGuardrails,
    filterEvidenceForQuestionContext,
    getOrganizationProfileRecoveryLimit,
    getRetrievalCandidateLimit,
    guardrailPromptVersion,
    mergeRetrievedEvidence,
    normalizeQuestion,
    ragPromptVersion,
    selectCitedGuardrailEvidence,
    validateGroundedAnswer,
    type GuardrailSupervisor,
    type RagAnswerProvider,
    type RagGenerationInput,
    type RagGenerationResult,
    type RetrievedEvidence,
} from "@smartservice/assistant-core";
import {
    createPublicConversationResponseSchema,
    publicMessageListResponseSchema,
    requestPublicHandoffResponseSchema,
    sendPublicMessageResponseSchema,
    type ConversationLanguage,
    type ConversationStatus,
    type ConversationTokenClaims,
    type CreatePublicConversationRequest,
    type CreatePublicConversationResponse,
    type GuardrailEvaluation,
    type GuardrailRule,
    type PublicMessageListResponse,
    type RagAnswer,
    type RequestPublicHandoffResponse,
    type SendPublicMessageRequest,
    type SendPublicMessageResponse,
} from "@smartservice/contracts";
import type { EmbeddingProvider } from "@smartservice/ingestion";
import { z } from "zod";

import type {
    SupabaseConversationRepository,
    CitationWrite,
    MessageCursorPosition,
    PublicConversationRecord,
} from "./conversation-repository";
import {
    ConversationTokenService,
    readConversationBearerToken,
} from "./conversation-token";
import { ApiError } from "./errors";
import type {
    PublicConversationService,
    SmartServiceBindings,
} from "./types";
import type { TurnstileVerifier } from "./turnstile";

const cursorPayloadSchema = z.object({
    createdAt: z.iso.datetime({ offset: true }),
    messageId: z.uuid(),
});

interface CandidateAudit
{
    answer: string | null;
    inputTokens: number | null;
    latencyMs: number | null;
    model: string | null;
    outputTokens: number | null;
    promptVersion: string | null;
    provider: string | null;
}

interface GuardrailAudit
{
    inputTokens: number | null;
    latencyMs: number;
    model: string;
    outputTokens: number | null;
    provider: string;
}

interface GuardrailBlockInput
{
    candidate: CandidateAudit;
    conversationId: string;
    customerMessageId: string;
    evaluation: GuardrailEvaluation;
    guardrail: GuardrailAudit;
    language: ConversationLanguage;
    organizationId: string;
    requestId: string;
}

type TurnProcessingStage =
    | "answer_generation"
    | "conversation_context"
    | "guardrail_configuration"
    | "input_guardrail"
    | "knowledge_retrieval"
    | "output_guardrail"
    | "output_supervision"
    | "query_embedding"
    | "query_planning";

type TurnStageDurationsMs = Partial<Record<TurnProcessingStage, number>>;

type TimedTurnStageResult<Value> = {
    durationMs: number;
    ok: true;
    value: Value;
} | {
    durationMs: number;
    error: unknown;
    ok: false;
};

interface TurnStageAttribution
{
    model: string;
    provider: string;
}

/**
 * sumKnownTokenCounts
 * ----------------
 * Aggregates token counts from independent question-part generations while preserving null when no provider reported usage.
 *
 * August 06, 2026: Created by Forrest Zhang for Parallel Multipart Answer Generation
 */
function sumKnownTokenCounts(values: readonly (number | null)[]): number | null
{
    const knownValues = values.filter((value): value is number => value !== null);

    return knownValues.length === 0
        ? null
        : knownValues.reduce((total, value) => total + value, 0);
}

/**
 * timeTurnStage
 * ----------------
 * Measures one asynchronous content-free pipeline stage and returns its error as data so independent database reads can run in parallel without losing attribution.
 *
 * August 06, 2026: Created by Forrest Zhang for Customer Answer Latency Hardening
 */
async function timeTurnStage<Value>(
    operation: () => Promise<Value>,
): Promise<TimedTurnStageResult<Value>>
{
    const startedAt = Date.now();

    try
    {
        const value = await operation();

        return {
            durationMs: Date.now() - startedAt,
            ok: true,
            value,
        };
    }
    catch (error: unknown)
    {
        return {
            durationMs: Date.now() - startedAt,
            error,
            ok: false,
        };
    }
}

/**
 * resolveTurnStageAttribution
 * ----------------
 * Maps a failed tenant-generic turn stage to the exact dependency or policy component responsible for its audit row.
 *
 * August 06, 2026: Created by Forrest Zhang for Tenant-Generic Answer Reliability
 */
function resolveTurnStageAttribution(
    stage: TurnProcessingStage,
    bindings: SmartServiceBindings,
    answers: RagAnswerProvider,
    guardrails: GuardrailSupervisor,
): TurnStageAttribution
{
    switch (stage)
    {
        case "answer_generation":
            return {
                model: answers.model,
                provider: answers.provider,
            };
        case "conversation_context":
            return {
                model: "recent-conversation-v1",
                provider: "supabase",
            };
        case "guardrail_configuration":
            return {
                model: "tenant-guardrails-v1",
                provider: "supabase",
            };
        case "input_guardrail":
        case "output_guardrail":
            return {
                model: "deterministic-guardrail-v1",
                provider: "deterministic",
            };
        case "knowledge_retrieval":
            return {
                model: "pgvector-pg-trgm-v1",
                provider: "supabase",
            };
        case "output_supervision":
            return {
                model: guardrails.model,
                provider: guardrails.provider,
            };
        case "query_embedding":
            return (bindings.EMBEDDING_PROVIDER_MODE ?? bindings.INGESTION_PROVIDER_MODE) === "live"
                ? {
                    model: bindings.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-large",
                    provider: "openai",
                }
                : {
                    model: "deterministic-embedding-v1",
                    provider: "mock",
                };
        case "query_planning":
            return {
                model: "retrieval-query-v1",
                provider: "application",
            };
    }
}

/**
 * sha256Hex
 * ----------------
 * Hashes rate-limit material so raw public keys, IP addresses, and token nonces are not persisted.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
 */
async function sha256Hex(value: string): Promise<string>
{
    const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );

    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * encodeCursor
 * ----------------
 * Encodes the last stable timestamp/UUID position as an opaque URL-safe polling cursor.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Message Polling
 */
function encodeCursor(position: MessageCursorPosition): string
{
    const bytes = new TextEncoder().encode(JSON.stringify(position));
    let binary = "";

    for (const byte of bytes)
    {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary)
        .replace(/\+/gu, "-")
        .replace(/\//gu, "_")
        .replace(/=+$/gu, "");
}

/**
 * decodeCursor
 * ----------------
 * Decodes and validates an untrusted polling cursor without using it in raw query syntax.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Message Polling
 */
function decodeCursor(value: string | null): MessageCursorPosition | null
{
    if (value === null)
    {
        return null;
    }

    if (value.length === 0 || value.length > 500 || !/^[A-Za-z0-9_-]+$/u.test(value))
    {
        throw new ApiError(400, "CURSOR_INVALID", "The message cursor is not valid.");
    }

    try
    {
        const normalized = value
            .replace(/-/gu, "+")
            .replace(/_/gu, "/")
            .padEnd(Math.ceil(value.length / 4) * 4, "=");
        const bytes = Uint8Array.from(
            atob(normalized),
            (character) => character.charCodeAt(0),
        );
        const parsedJson: unknown = JSON.parse(new TextDecoder().decode(bytes));
        return cursorPayloadSchema.parse(parsedJson);
    }
    catch
    {
        throw new ApiError(400, "CURSOR_INVALID", "The message cursor is not valid.");
    }
}

/**
 * isExplicitHandoffRequest
 * ----------------
 * Detects narrow direct requests for a person without treating ordinary mentions of support or sales as takeover requests.
 *
 * August 06, 2026: Updated by Forrest Zhang for Tenant Customer-Service Ownership Policy
 */
export function isExplicitHandoffRequest(question: string): boolean
{
    return /(?:转(?:接)?人工|(?:我要|我想要|我需要|需要|联系)(?:一位|一个)?(?:人工|人工客服|真人|真人客服|客服专员)|人工客服|真人客服|客服专员|找个人|(?:speak|talk|connect|transfer) (?:me )?(?:to|with) (?:a )?(?:human|person|agent|representative|support specialist)|i (?:want|need|would like) (?:a )?(?:human|person|agent|representative|support specialist)|human agent|real person|customer service (?:agent|representative)|support specialist)/iu
        .test(question);
}

/**
 * readLocatorString
 * ----------------
 * Safely reads one optional source-locator string without trusting arbitrary ingestion metadata.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Citations
 */
function readLocatorString(
    locator: Record<string, unknown>,
    key: string,
): string | null
{
    const value = locator[key];
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : null;
}

/**
 * readLocatorPage
 * ----------------
 * Safely reads one positive page number from source-locator metadata.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Citations
 */
function readLocatorPage(locator: Record<string, unknown>): number | null
{
    const value = locator.pageStart;
    return typeof value === "number" && Number.isInteger(value) && value > 0
        ? value
        : null;
}

/**
 * buildCitationLabel
 * ----------------
 * Formats a source title plus real page or section locator while withholding all database identifiers.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Citations
 */
function buildCitationLabel(evidence: RetrievedEvidence): string
{
    const title = readLocatorString(evidence.sourceLocator, "title")
        ?? readLocatorString(evidence.sourceLocator, "fileName")
        ?? "Approved knowledge";
    const page = readLocatorPage(evidence.sourceLocator);
    const section = readLocatorString(evidence.sourceLocator, "section");
    const suffix = page !== null
        ? `, p. ${page}`
        : section !== null
            ? ` — ${section}`
            : "";

    return `${title}${suffix}`.slice(0, 240);
}

/**
 * buildSupportingExcerpt
 * ----------------
 * Returns a bounded verbatim supporting excerpt for the citation drawer without exposing the full retrieved corpus.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Citations
 */
function buildSupportingExcerpt(content: string): string
{
    const normalized = content
        .replace(/\s+/gu, " ")
        .replace(/([.!?])(?=[A-Z])/gu, "$1 ")
        .trim();
    return normalized.length <= 900
        ? normalized
        : `${normalized.slice(0, 897).trimEnd()}…`;
}

/**
 * buildCitationWrites
 * ----------------
 * Resolves validated model citation selections back to exact retrieved evidence for atomic persistence.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Citations
 */
function buildCitationWrites(
    citationChunkIds: readonly string[],
    evidence: readonly RetrievedEvidence[],
): CitationWrite[]
{
    const evidenceById = new Map(evidence.map((item) => [item.chunkId, item]));

    return citationChunkIds.map((chunkId) =>
    {
        const item = evidenceById.get(chunkId);

        if (item === undefined)
        {
            throw new ApiError(502, "CITATION_VALIDATION_FAILED", "The generated citation is not valid.");
        }

        return {
            chunkId,
            label: buildCitationLabel(item),
            supportingExcerpt: buildSupportingExcerpt(item.content),
        };
    });
}

/**
 * parseThreshold
 * ----------------
 * Uses the calibrated live default while allowing a bounded explicit threshold for deterministic local fixtures.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
 */
function parseThreshold(bindings: SmartServiceBindings): number
{
    const defaultThreshold = bindings.CHAT_PROVIDER_MODE === "live" ? 0.35 : 0;
    const threshold = bindings.RAG_MATCH_THRESHOLD === undefined
        ? defaultThreshold
        : Number(bindings.RAG_MATCH_THRESHOLD);

    if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1)
    {
        throw new ApiError(503, "RAG_CONFIGURATION_INVALID", "The retrieval threshold is not valid.");
    }

    return threshold;
}

/**
 * parseTokenTtlSeconds
 * ----------------
 * Parses the configured conversation lifetime while enforcing the approved one-minute to 24-hour boundary.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
 */
function parseTokenTtlSeconds(bindings: SmartServiceBindings): number
{
    const minutes = Number.parseInt(bindings.CONVERSATION_TOKEN_TTL_MINUTES ?? "120", 10);

    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1_440)
    {
        throw new ApiError(
            503,
            "CONVERSATION_TOKEN_TTL_INVALID",
            "The conversation-token lifetime is not valid.",
        );
    }

    return minutes * 60;
}

export class DefaultPublicConversationService implements PublicConversationService
{
    private readonly tokenService: ConversationTokenService;

    /**
     * DefaultPublicConversationService
     * ----------------
     * Creates the public text-conversation orchestrator from explicit server-side RAG, guardrail, and security adapters.
     *
     * July 26, 2026: Updated by Forrest Zhang for SmartService Day 4 Guardrails and Handoff
     */
    public constructor(
        private readonly bindings: SmartServiceBindings,
        private readonly repository: SupabaseConversationRepository,
        private readonly embeddings: EmbeddingProvider,
        private readonly answers: RagAnswerProvider,
        private readonly guardrails: GuardrailSupervisor,
        private readonly turnstile: TurnstileVerifier,
    )
    {
        this.tokenService = new ConversationTokenService(
            bindings.CONVERSATION_TOKEN_SECRET ?? "",
            parseTokenTtlSeconds(bindings),
        );
    }

    /**
     * generateGroundedAnswer
     * ----------------
     * Generates independent multipart answers concurrently from each part's scoped evidence, then returns one server-composable result without asking the model to assign cross-part citations.
     *
     * August 06, 2026: Created by Forrest Zhang for Parallel Multipart Answer Generation
     */
    private async generateGroundedAnswer(
        input: RagGenerationInput,
    ): Promise<RagGenerationResult>
    {
        const questionParts = (input.questionParts ?? [input.question])
            .map((part) => part.trim())
            .filter((part) => part.length > 0)
            .slice(0, 5);

        if (questionParts.length <= 1)
        {
            const stableFactAnswer = createExplicitStableFactAnswer(
                questionParts[0] ?? input.question,
                input.evidence,
                input.language,
            );

            if (stableFactAnswer !== null)
            {
                return {
                    answer: stableFactAnswer,
                    generationAttempts: 0,
                    inputTokens: null,
                    model: "stable-fact-v1",
                    outputTokens: null,
                    provider: "deterministic",
                };
            }

            return this.answers.generate(input);
        }

        const evidenceById = new Map(
            input.evidence.map((item) => [item.chunkId, item] as const),
        );
        const generatedParts = await Promise.all(questionParts.map(async (questionPart, index) =>
        {
            const scopedIds = input.questionPartEvidenceIds?.[index]
                ?? input.evidence.map((item) => item.chunkId);
            const scopedEvidence = scopedIds.flatMap((chunkId) =>
            {
                const item = evidenceById.get(chunkId);
                return item === undefined ? [] : [item];
            });

            if (scopedEvidence.length === 0)
            {
                return {
                    answer: createSafeClarification(
                        questionPart,
                        input.language,
                        "missing_knowledge",
                    ),
                    generationAttempts: 0,
                    inputTokens: null,
                    model: "no-evidence-v3",
                    outputTokens: null,
                    provider: "retrieval-gate",
                } satisfies RagGenerationResult;
            }

            const stableFactAnswer = createExplicitStableFactAnswer(
                questionPart,
                scopedEvidence,
                input.language,
            );

            if (stableFactAnswer !== null)
            {
                return {
                    answer: stableFactAnswer,
                    generationAttempts: 0,
                    inputTokens: null,
                    model: "stable-fact-v1",
                    outputTokens: null,
                    provider: "deterministic",
                } satisfies RagGenerationResult;
            }

            return this.answers.generate({
                evidence: scopedEvidence,
                language: input.language,
                question: questionPart,
                questionPartEvidenceIds: [scopedEvidence.map((item) => item.chunkId)],
                questionParts: [questionPart],
                recentMessages: input.recentMessages,
            });
        }));
        const questionPartAnswers = generatedParts.map((result, index) => ({
            answer: result.answer.answer,
            citationChunkIds: result.answer.citationChunkIds,
            partIndex: index,
            supported: result.answer.decision === "answer",
        }));
        const supportedParts = questionPartAnswers.filter((part) => part.supported);
        const citationChunkIds = [...new Set(
            supportedParts.flatMap((part) => part.citationChunkIds),
        )];
        const representativeResult = generatedParts.find((result) =>
            result.provider !== "retrieval-gate",
        ) ?? generatedParts[0];

        if (representativeResult === undefined)
        {
            throw new ApiError(
                502,
                "MULTIPART_GENERATION_EMPTY",
                "The multipart answer did not produce any question-part result.",
            );
        }

        const recoveryMode = generatedParts.some((result) =>
            result.recoveryMode === "provider_fallback",
        )
            ? "provider_fallback" as const
            : generatedParts.some((result) =>
                result.recoveryMode === "same_provider_repair",
            )
                ? "same_provider_repair" as const
                : undefined;

        return {
            answer: {
                answer: "The server will compose the validated question-part answers.",
                citationChunkIds: citationChunkIds.slice(0, 5),
                confidence: Math.min(...generatedParts.map((result) =>
                    result.answer.confidence,
                )),
                decision: supportedParts.length > 0 ? "answer" : "clarify",
                handoffReason: supportedParts.length > 0
                    ? null
                    : generatedParts.some((result) =>
                        result.answer.handoffReason === "conflicting_knowledge",
                    )
                        ? "conflicting_knowledge"
                        : "missing_knowledge",
                normalizedQuestion: normalizeQuestion(input.question),
                questionPartAnswers,
            },
            generationAttempts: Math.max(...generatedParts.map((result) =>
                result.generationAttempts ?? 1,
            )),
            inputTokens: sumKnownTokenCounts(generatedParts.map((result) =>
                result.inputTokens,
            )),
            model: representativeResult.model,
            outputTokens: sumKnownTokenCounts(generatedParts.map((result) =>
                result.outputTokens,
            )),
            provider: representativeResult.provider,
            ...(recoveryMode === undefined ? {} : { recoveryMode }),
        };
    }

    /**
     * create
     * ----------------
     * Rate-limits, verifies Turnstile, creates an idempotent text conversation, and issues its scoped token.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversations
     */
    public async create(
        input: CreatePublicConversationRequest,
        idempotencyKey: string,
        remoteIp: string | null,
        requestId: string,
    ): Promise<CreatePublicConversationResponse>
    {
        if ((this.bindings.CONVERSATION_TOKEN_SECRET ?? "").length < 32)
        {
            throw new ApiError(
                503,
                "CONVERSATION_TOKEN_CONFIGURATION_INVALID",
                "Customer conversations are not configured.",
            );
        }

        const tenant = await this.repository.resolveTenant(input.publicKey);

        if (tenant === null)
        {
            throw new ApiError(404, "WIDGET_NOT_FOUND", "The customer service widget is not available.");
        }

        const bucketHash = await sha256Hex(
            `${input.publicKey}|${remoteIp ?? "unknown"}`,
        );
        await this.repository.consumeRateLimit(
            tenant.organizationId,
            bucketHash,
            "conversation.create",
            10,
            60,
        );
        await this.turnstile.verify(
            input.turnstileToken,
            remoteIp,
            crypto.randomUUID(),
        );
        const created = await this.repository.createConversation(
            input,
            idempotencyKey,
            requestId,
        );

        if (created.organizationId !== tenant.organizationId)
        {
            throw new ApiError(503, "TENANT_MISMATCH", "The conversation could not be started.");
        }

        const issued = await this.tokenService.issue(
            created.conversationId,
            created.organizationId,
        );

        return createPublicConversationResponseSchema.parse({
            conversationId: created.conversationId,
            conversationToken: issued.token,
            displayName: created.displayName,
            expiresAt: issued.expiresAt,
            welcomeMessage: created.welcomeMessage,
        });
    }

    /**
     * authorize
     * ----------------
     * Verifies the bearer token and authoritative database state while allowing read-only polling after handoff or closure.
     *
     * July 26, 2026: Updated by Forrest Zhang for SmartService Day 4 Conversation State Machine
     */
    private async authorize(
        request: Request,
        conversationId: string,
        scope: "conversation:read" | "conversation:write",
        writableStatuses: readonly ConversationStatus[] = ["active_ai"],
    ): Promise<{
        claims: ConversationTokenClaims;
        conversation: PublicConversationRecord;
    }>
    {
        const claims = await this.tokenService.verify(
            readConversationBearerToken(request),
            conversationId,
            scope,
        );
        const conversation = await this.repository.getConversation(
            claims.org,
            conversationId,
        );

        if (conversation === null)
        {
            throw new ApiError(401, "CONVERSATION_TOKEN_INVALID", "The conversation session is not valid.");
        }

        if (
            scope === "conversation:write"
            && !writableStatuses.includes(conversation.status)
        )
        {
            throw new ApiError(
                409,
                "CONVERSATION_NOT_WRITEABLE",
                "This conversation is no longer open for customer messages.",
            );
        }

        return {
            claims,
            conversation,
        };
    }

    /**
     * recordHumanRoutedCustomerMessage
     * ----------------
     * Stores a customer update after specialist follow-up is requested or connected without running retrieval, guardrails, LLM, or TTS.
     *
     * August 06, 2026: Updated by Forrest Zhang for Tenant Customer-Service Ownership Policy
     */
    private async recordHumanRoutedCustomerMessage(
        organizationId: string,
        conversationId: string,
        input: SendPublicMessageRequest,
        requestId: string,
    ): Promise<SendPublicMessageResponse>
    {
        const language = detectConversationLanguage(input.text);
        const customerMessage = await this.repository.recordCustomerMessage(
            organizationId,
            conversationId,
            input.clientMessageId,
            input.text,
            language,
        );

        if (customerMessage.created)
        {
            await this.refreshOperationalContext(
                organizationId,
                conversationId,
                requestId,
                true,
            );
        }

        return sendPublicMessageResponseSchema.parse({
            answer: language === "zh-CN"
                ? "您的补充已发送给客服专员。"
                : "Your update has been sent to a support specialist.",
            citations: [],
            decision: "human",
            handoff: null,
            messageId: customerMessage.id,
        });
    }

    /**
     * list
     * ----------------
     * Polls only customer-visible messages for the token-bound conversation and advances an opaque stable cursor.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Message Polling
     */
    public async list(
        request: Request,
        conversationId: string,
        after: string | null,
        limit: number,
    ): Promise<PublicMessageListResponse>
    {
        const authorization = await this.authorize(
            request,
            conversationId,
            "conversation:read",
        );
        const page = await this.repository.listPublicMessages(
            authorization.claims.org,
            conversationId,
            decodeCursor(after),
            limit,
        );
        const nextCursor = page.lastPosition === null
            ? after
            : encodeCursor(page.lastPosition);

        return publicMessageListResponseSchema.parse({
            messages: page.messages,
            nextCursor,
            status: authorization.conversation.status,
        });
    }

    /**
     * refreshOperationalContext
     * ----------------
     * Refreshes the bounded incremental summary and, for escalated turns, the authoritative handoff snapshot.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Handoff Summary
     */
    private async refreshOperationalContext(
        organizationId: string,
        conversationId: string,
        requestId: string,
        handoff: boolean,
    ): Promise<void>
    {
        await this.repository.refreshIncrementalSummary(
            organizationId,
            conversationId,
            requestId,
        );

        if (handoff)
        {
            await this.repository.refreshHandoffSnapshot(
                organizationId,
                conversationId,
                requestId,
            );
        }
    }

    /**
     * persistGuardrailBlock
     * ----------------
     * Atomically withholds a blocked candidate, exposes only safe wording, transitions to handoff, and refreshes agent context.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrails
     */
    private async persistGuardrailBlock(
        input: GuardrailBlockInput,
    ): Promise<SendPublicMessageResponse>
    {
        if (
            input.evaluation.allowed
            || !input.evaluation.requestHandoff
            || input.evaluation.safeResponse === null
            || input.evaluation.violations.length === 0
        )
        {
            throw new ApiError(
                502,
                "GUARDRAIL_EVALUATION_INVALID",
                "The guardrail result could not be applied safely.",
            );
        }

        const messageId = await this.repository.completeGuardrailTurn({
            blockedCandidate: input.candidate.answer,
            candidateInputTokens: input.candidate.inputTokens,
            candidateLatencyMs: input.candidate.latencyMs,
            candidateModel: input.candidate.model,
            candidateOutputTokens: input.candidate.outputTokens,
            candidatePromptVersion: input.candidate.promptVersion,
            candidateProvider: input.candidate.provider,
            conversationId: input.conversationId,
            customerMessageId: input.customerMessageId,
            language: input.language,
            organizationId: input.organizationId,
            requestId: input.requestId,
            safeResponse: input.evaluation.safeResponse,
            supervisorInputTokens: input.guardrail.inputTokens,
            supervisorLatencyMs: input.guardrail.latencyMs,
            supervisorModel: input.guardrail.model,
            supervisorOutputTokens: input.guardrail.outputTokens,
            supervisorPromptVersion: guardrailPromptVersion,
            supervisorProvider: input.guardrail.provider,
            violations: input.evaluation.violations,
        });
        const [response] = await Promise.all([
            this.repository.loadResponse(
                input.organizationId,
                input.conversationId,
                messageId,
            ),
            this.refreshOperationalContext(
                input.organizationId,
                input.conversationId,
                input.requestId,
                true,
            ),
        ]);

        return sendPublicMessageResponseSchema.parse(response);
    }

    /**
     * send
     * ----------------
     * Persists one customer turn, applies input/output guardrails around grounded generation, and exposes only validated safe output.
     *
     * July 26, 2026: Updated by Forrest Zhang for SmartService Day 4 Guardrails and Handoff
     */
    public async send(
        request: Request,
        conversationId: string,
        input: SendPublicMessageRequest,
        requestId: string,
        remoteIp: string | null,
    ): Promise<SendPublicMessageResponse>
    {
        const authorization = await this.authorize(
            request,
            conversationId,
            "conversation:write",
            ["active_ai", "handoff_requested", "active_human"],
        );
        const rateBucket = await sha256Hex(
            `${authorization.claims.org}|${conversationId}|${remoteIp ?? "unknown"}`,
        );
        await this.repository.consumeRateLimit(
            authorization.claims.org,
            rateBucket,
            "conversation.message",
            30,
            60,
        );

        if (authorization.conversation.status !== "active_ai")
        {
            return this.recordHumanRoutedCustomerMessage(
                authorization.claims.org,
                conversationId,
                input,
                requestId,
            );
        }

        return this.processTurn(
            authorization.claims.org,
            conversationId,
            input,
            requestId,
        );
    }

    /**
     * sendTrusted
     * ----------------
     * Reuses the exact text RAG, citation, guardrail, and persistence path for one Agent-authenticated active voice conversation.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 7 Voice RAG and TTS
     */
    public async sendTrusted(
        organizationId: string,
        conversationId: string,
        input: SendPublicMessageRequest,
        requestId: string,
    ): Promise<SendPublicMessageResponse>
    {
        const conversation = await this.repository.getConversation(
            organizationId,
            conversationId,
        );

        if (
            conversation === null
            || conversation.channel !== "voice"
            || conversation.status !== "active_ai"
        )
        {
            throw new ApiError(409, "VOICE_CONVERSATION_NOT_ACTIVE", "This voice conversation is no longer AI-active.");
        }

        return this.processTurn(
            organizationId,
            conversationId,
            input,
            requestId,
        );
    }

    /**
     * processTurn
     * ----------------
     * Applies the shared idempotent customer-message, RAG, citation, guardrail, handoff, and audit pipeline after caller authorization.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 7 Shared Voice Assistant Core
     */
    private async processTurn(
        organizationId: string,
        conversationId: string,
        input: SendPublicMessageRequest,
        requestId: string,
    ): Promise<SendPublicMessageResponse>
    {
        const language = detectConversationLanguage(input.text);
        const customerMessage = await this.repository.recordCustomerMessage(
            organizationId,
            conversationId,
            input.clientMessageId,
            input.text,
            language,
        );

        if (!customerMessage.created)
        {
            const existing = await this.repository.findResponseToCustomerMessage(
                organizationId,
                conversationId,
                customerMessage.id,
            );

            if (existing !== null)
            {
                await this.refreshOperationalContext(
                    organizationId,
                    conversationId,
                    requestId,
                    existing.handoff !== null,
                );
                return sendPublicMessageResponseSchema.parse(existing);
            }

            if (Date.now() - Date.parse(customerMessage.createdAt) < 30_000)
            {
                throw new ApiError(409, "TURN_IN_PROGRESS", "This message is still being processed.");
            }
        }

        const startedAt = Date.now();
        const stageDurationsMs: TurnStageDurationsMs = {};
        let evidence: RetrievedEvidence[] = [];
        let retrievalCrossLanguageExpanded = false;
        const retrievalCandidateCounts: number[] = [];
        let retrievalContextualized = false;
        const retrievalFilteredCounts: number[] = [];
        const retrievalProfileRecoveryUsed: boolean[] = [];
        let retrievalMinimumThreshold: number | null = null;
        let retrievalQueryCount = 1;
        let provider: string;
        let model: string;
        let inputTokens: number | null = null;
        let outputTokens: number | null = null;
        let generationAttempts: number | null = null;
        let generationRecoveryMode: "none" | "provider_fallback" | "same_provider_repair" | null = null;
        let aiStatus: "succeeded" | "failed" = "succeeded";
        let errorCode: string | null = null;
        let currentStage: TurnProcessingStage = "guardrail_configuration";
        let failedStage: TurnProcessingStage | null = null;
        let answer: RagAnswer;

        try
        {
            const acknowledgement = createConversationalAcknowledgement(
                input.text,
                language,
            );

            if (isExplicitHandoffRequest(input.text))
            {
                provider = "policy";
                model = "customer-handoff-v1";
                answer = createSafeHandoff(input.text, language, "customer_requested");
            }
            else if (acknowledgement !== null)
            {
                provider = "deterministic";
                model = "conversation-act-v1";
                answer = acknowledgement;
            }
            else
            {
                currentStage = "guardrail_configuration";
                const [rulesResult, recentMessagesResult] = await Promise.all([
                    timeTurnStage(() => this.repository.listGuardrailRules(
                        organizationId,
                    )),
                    timeTurnStage(() => this.repository.listRecentMessages(
                        organizationId,
                        conversationId,
                        customerMessage.id,
                    )),
                ]);
                stageDurationsMs.guardrail_configuration = rulesResult.durationMs;
                stageDurationsMs.conversation_context = recentMessagesResult.durationMs;

                if (!rulesResult.ok)
                {
                    currentStage = "guardrail_configuration";
                    throw rulesResult.error;
                }

                if (!recentMessagesResult.ok)
                {
                    currentStage = "conversation_context";
                    throw recentMessagesResult.error;
                }

                const rules: GuardrailRule[] = rulesResult.value;
                const recentMessages = recentMessagesResult.value;
                currentStage = "input_guardrail";
                const inputGuardrailStartedAt = Date.now();
                const inputEvaluation = evaluateDeterministicGuardrails({
                    candidateAnswer: null,
                    evidence: [],
                    language,
                    rules,
                    userMessage: input.text,
                });
                stageDurationsMs.input_guardrail = Date.now() - inputGuardrailStartedAt;

                if (!inputEvaluation.allowed)
                {
                    return this.persistGuardrailBlock({
                        candidate: {
                            answer: null,
                            inputTokens: null,
                            latencyMs: null,
                            model: null,
                            outputTokens: null,
                            promptVersion: null,
                            provider: null,
                        },
                        conversationId,
                        customerMessageId: customerMessage.id,
                        evaluation: inputEvaluation,
                        guardrail: {
                            inputTokens: null,
                            latencyMs: Date.now() - inputGuardrailStartedAt,
                            model: "deterministic-guardrail-v1",
                            outputTokens: null,
                            provider: "deterministic",
                        },
                        language,
                        organizationId,
                        requestId,
                    });
                }

                currentStage = "query_planning";
                const queryPlanningStartedAt = Date.now();
                const configuredThreshold = parseThreshold(this.bindings);
                const focusedRetrievalQuestions = buildRetrievalQuestions(
                    input.text,
                    recentMessages,
                );
                const retrievalQuestions = focusedRetrievalQuestions.map((question) =>
                    buildCrossLanguageRetrievalQuestion(question),
                );
                const retrievalThresholds = retrievalQuestions.map(() => configuredThreshold);
                retrievalCrossLanguageExpanded = retrievalQuestions.some(
                    (question, index) => question !== focusedRetrievalQuestions[index],
                );
                retrievalContextualized = focusedRetrievalQuestions.length > 1
                    || focusedRetrievalQuestions[0] !== input.text.trim();
                retrievalMinimumThreshold = Math.min(...retrievalThresholds);
                retrievalQueryCount = focusedRetrievalQuestions.length;
                stageDurationsMs.query_planning = Date.now() - queryPlanningStartedAt;
                currentStage = "query_embedding";
                const queryEmbeddingStartedAt = Date.now();
                let vectors: number[][];

                try
                {
                    vectors = await this.embeddings.embed(retrievalQuestions);
                }
                finally
                {
                    stageDurationsMs.query_embedding = Date.now() - queryEmbeddingStartedAt;
                }

                if (vectors.length !== retrievalQuestions.length)
                {
                    throw new ApiError(502, "QUERY_EMBEDDING_INVALID", "The query embedding is not valid.");
                }

                currentStage = "knowledge_retrieval";
                const knowledgeRetrievalStartedAt = Date.now();
                let retrievalResultSets: RetrievedEvidence[][];

                try
                {
                    retrievalResultSets = await Promise.all(
                        retrievalQuestions.map(async (retrievalQuestion, index) =>
                        {
                            const queryEmbedding = vectors[index];

                            if (queryEmbedding === undefined)
                            {
                                throw new ApiError(502, "QUERY_EMBEDDING_INVALID", "The query embedding is not valid.");
                            }

                            let resultSet = await this.repository.retrieveEvidence(
                                organizationId,
                                retrievalQuestion,
                                queryEmbedding,
                                retrievalThresholds[index] ?? configuredThreshold,
                                getRetrievalCandidateLimit(
                                    focusedRetrievalQuestions[index] ?? input.text,
                                ),
                            );
                            const focusedRetrievalQuestion = focusedRetrievalQuestions[index]
                                ?? input.text;
                            const profileRecoveryLimit = getOrganizationProfileRecoveryLimit(
                                focusedRetrievalQuestion,
                            );

                            if (resultSet.length === 0 && profileRecoveryLimit !== null)
                            {
                                resultSet = await this.repository.retrieveEvidence(
                                    organizationId,
                                    retrievalQuestion,
                                    queryEmbedding,
                                    0,
                                    profileRecoveryLimit,
                                );
                                retrievalThresholds[index] = 0;
                                retrievalProfileRecoveryUsed[index] = true;
                            }
                            else
                            {
                                retrievalProfileRecoveryUsed[index] = false;
                            }

                            retrievalCandidateCounts[index] = resultSet.length;
                            const evidenceQuestion = focusedRetrievalQuestions.length === 1
                                ? input.text
                                : focusedRetrievalQuestion;
                            const filteredResultSet = filterEvidenceForQuestionContext(
                                evidenceQuestion,
                                recentMessages,
                                resultSet,
                            );
                            retrievalFilteredCounts[index] = filteredResultSet.length;

                            return filteredResultSet;
                        }),
                    );
                }
                finally
                {
                    stageDurationsMs.knowledge_retrieval = Date.now() - knowledgeRetrievalStartedAt;
                }

                retrievalMinimumThreshold = Math.min(...retrievalThresholds);
                const mergedEvidenceLimit = Math.min(
                    8,
                    Math.max(3, focusedRetrievalQuestions.length * 2),
                );
                evidence = mergeRetrievedEvidence(retrievalResultSets, mergedEvidenceLimit);

                if (evidence.length === 0)
                {
                    provider = "retrieval-gate";
                    model = "no-evidence-v3";
                    answer = createSafeClarification(input.text, language, "missing_knowledge");
                }
                else
                {
                    currentStage = "answer_generation";
                    const answerGenerationStartedAt = Date.now();

                    try
                    {
                        const generationInput = {
                            evidence,
                            language,
                            question: input.text,
                            questionPartEvidenceIds: buildQuestionPartEvidenceScope(
                                focusedRetrievalQuestions,
                                retrievalResultSets,
                                evidence,
                            ),
                            questionParts: focusedRetrievalQuestions,
                            recentMessages,
                        };
                        const approvedManualAnswer = createApprovedManualAnswer(generationInput);

                        if (approvedManualAnswer !== null)
                        {
                            provider = "deterministic";
                            model = "approved-manual-v1";
                            answer = approvedManualAnswer;
                        }
                        else
                        {
                            const generated = await this.generateGroundedAnswer(generationInput);
                            generationAttempts = generated.generationAttempts ?? 1;
                            generationRecoveryMode = generated.recoveryMode ?? "none";
                            inputTokens = generated.inputTokens;
                            model = generated.model;
                            outputTokens = generated.outputTokens;
                            provider = generated.provider;
                            answer = enforceCustomerControlledHandoff(
                                validateGroundedAnswer(generated.answer, evidence, {
                                    language,
                                    questionPartEvidenceIds: generationInput.questionPartEvidenceIds,
                                    questionParts: focusedRetrievalQuestions,
                                }),
                                input.text,
                                language,
                            );
                        }
                    }
                    finally
                    {
                        stageDurationsMs.answer_generation = Date.now() - answerGenerationStartedAt;
                    }

                    if (
                        answer.decision === "answer"
                        || answer.decision === "clarify"
                    )
                    {
                        const citedEvidence = selectCitedGuardrailEvidence(
                            evidence,
                            answer.citationChunkIds,
                        );
                        const candidate: CandidateAudit = {
                            answer: answer.answer,
                            inputTokens,
                            latencyMs: Date.now() - startedAt,
                            model,
                            outputTokens,
                            promptVersion: ragPromptVersion,
                            provider,
                        };
                        currentStage = "output_guardrail";
                        const outputGuardrailStartedAt = Date.now();
                        const outputEvaluation = evaluateDeterministicGuardrails({
                            candidateAnswer: answer.answer,
                            evidence: citedEvidence,
                            language,
                            rules,
                            userMessage: input.text,
                        });
                        stageDurationsMs.output_guardrail = Date.now() - outputGuardrailStartedAt;

                        if (!outputEvaluation.allowed)
                        {
                            return this.persistGuardrailBlock({
                                candidate,
                                conversationId,
                                customerMessageId: customerMessage.id,
                                evaluation: outputEvaluation,
                                guardrail: {
                                    inputTokens: null,
                                    latencyMs: Date.now() - outputGuardrailStartedAt,
                                    model: "deterministic-guardrail-v1",
                                    outputTokens: null,
                                    provider: "deterministic",
                                },
                                language,
                                organizationId,
                                requestId,
                            });
                        }

                        currentStage = "output_supervision";
                        const supervisionResult = await timeTurnStage(() =>
                            this.guardrails.supervise({
                                candidateAnswer: answer.answer,
                                evidence: citedEvidence,
                                language,
                                rules,
                                userMessage: input.text,
                            }),
                        );
                        stageDurationsMs.output_supervision = supervisionResult.durationMs;

                        if (!supervisionResult.ok)
                        {
                            throw supervisionResult.error;
                        }

                        const supervision = supervisionResult.value;

                        if (!supervision.evaluation.allowed)
                        {
                            return this.persistGuardrailBlock({
                                candidate,
                                conversationId,
                                customerMessageId: customerMessage.id,
                                evaluation: supervision.evaluation,
                                guardrail: {
                                    inputTokens: supervision.inputTokens,
                                    latencyMs: supervisionResult.durationMs,
                                    model: this.guardrails.model,
                                    outputTokens: supervision.outputTokens,
                                    provider: this.guardrails.provider,
                                },
                                language,
                                organizationId,
                                requestId,
                            });
                        }
                    }
                }
            }
        }
        catch (error: unknown)
        {
            aiStatus = "failed";
            failedStage = currentStage;
            errorCode = error instanceof ApiError
                ? error.code
                : error instanceof Error
                    ? error.name.slice(0, 120)
                    : "UNKNOWN_ERROR";
            const failureAttribution = resolveTurnStageAttribution(
                failedStage,
                this.bindings,
                this.answers,
                this.guardrails,
            );
            model = failureAttribution.model;
            provider = failureAttribution.provider;
            answer = createSafeClarification(input.text, language, "system_error");

            console.error(JSON.stringify({
                conversationId,
                errorCode,
                event: "public.turn.failed_closed",
                failedStage,
                model,
                provider,
                requestId,
            }));
        }

        console.info(JSON.stringify({
            event: "public.turn.pipeline.completed",
            failedStage,
            latencyMs: Date.now() - startedAt,
            requestId,
            retrievalCandidateCounts,
            retrievalFilteredCounts,
            retrievalProfileRecoveryUsed,
            retrievedEvidenceCount: evidence.length,
            stageDurationsMs,
        }));

        const citations = buildCitationWrites(answer.citationChunkIds, evidence);
        const messageId = await this.repository.completeTurn({
            aiStatus,
            answer: answer.answer,
            citations,
            conversationId,
            createGap: answer.handoffReason === "missing_knowledge"
                || answer.handoffReason === "conflicting_knowledge",
            customerMessageId: customerMessage.id,
            decision: answer.decision,
            errorCode,
            handoffReason: answer.handoffReason,
            inputTokens,
            language,
            latencyMs: Date.now() - startedAt,
            model,
            normalizedQuestion: answer.normalizedQuestion,
            organizationId,
            outputTokens,
            promptVersion: ragPromptVersion,
            provider,
            requestId,
            retrievalMetadata: {
                contextualized: retrievalContextualized,
                count: evidence.length,
                candidateCounts: retrievalCandidateCounts,
                crossLanguageExpanded: retrievalCrossLanguageExpanded,
                filteredCounts: retrievalFilteredCounts,
                profileRecoveryUsed: retrievalProfileRecoveryUsed,
                processing: {
                    failedStage,
                    generationAttempts,
                    generationRecoveryMode,
                    stageDurationsMs,
                },
                queryCount: retrievalQueryCount,
                normalizedQuestion: answer.normalizedQuestion,
                scores: evidence.map((item) => ({
                    chunkId: item.chunkId,
                    combinedScore: item.combinedScore,
                })),
                threshold: retrievalMinimumThreshold,
            },
            retrievedChunkIds: evidence.map((item) => item.chunkId),
        });
        const [response] = await Promise.all([
            this.repository.loadResponse(
                organizationId,
                conversationId,
                messageId,
            ),
            this.refreshOperationalContext(
                organizationId,
                conversationId,
                requestId,
                answer.decision === "handoff",
            ),
        ]);

        return sendPublicMessageResponseSchema.parse(response);
    }

    /**
     * requestHandoff
     * ----------------
     * Verifies the conversation, persists an idempotent customer-requested handoff, and refreshes the agent package.
     *
     * July 26, 2026: Updated by Forrest Zhang for SmartService Day 4 Handoff Summary
     */
    public async requestHandoff(
        request: Request,
        conversationId: string,
        idempotencyKey: string,
        requestId: string,
        remoteIp: string | null,
    ): Promise<RequestPublicHandoffResponse>
    {
        const authorization = await this.authorize(
            request,
            conversationId,
            "conversation:write",
        );
        const rateBucket = await sha256Hex(
            `${authorization.claims.org}|${conversationId}|${remoteIp ?? "unknown"}`,
        );
        await this.repository.consumeRateLimit(
            authorization.claims.org,
            rateBucket,
            "conversation.handoff",
            5,
            60,
        );
        const messageId = await this.repository.requestHandoff(
            authorization.claims.org,
            conversationId,
            idempotencyKey,
            authorization.conversation.language as ConversationLanguage,
            requestId,
        );
        await this.refreshOperationalContext(
            authorization.claims.org,
            conversationId,
            requestId,
            true,
        );

        return requestPublicHandoffResponseSchema.parse({
            handoff: {
                reason: "customer_requested",
                status: "handoff_requested",
            },
            messageId,
        });
    }
}
