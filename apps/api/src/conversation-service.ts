import {
    buildRetrievalQuestion,
    createApprovedManualAnswer,
    createSafeClarification,
    createSafeHandoff,
    detectConversationLanguage,
    enforceCustomerControlledHandoff,
    evaluateDeterministicGuardrails,
    guardrailPromptVersion,
    ragPromptVersion,
    selectCitedGuardrailEvidence,
    validateGroundedAnswer,
    type GuardrailSupervisor,
    type RagAnswerProvider,
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
 * July 27, 2026: Updated by Forrest Zhang for SmartService Conditional Human Support
 */
export function isExplicitHandoffRequest(question: string): boolean
{
    return /(?:转(?:接)?人工|(?:我要|我想要|我需要|需要|联系)(?:一位|一个)?(?:人工|人工客服|真人|真人客服)|人工客服|真人客服|找个人|(?:speak|talk|connect|transfer) (?:me )?(?:to|with) (?:a )?(?:human|person|agent|representative)|i (?:want|need|would like) (?:a )?(?:human|person|agent|representative)|human agent|real person|customer service (?:agent|representative))/iu
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
     * Stores a customer update after human support is requested or connected without running retrieval, guardrails, LLM, or TTS.
     *
     * July 29, 2026: Created by Forrest Zhang for SmartService Pending Handoff Customer Messages
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
                ? "您的补充已发送给人工客服。"
                : "Your update has been sent to human support.",
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
        await this.refreshOperationalContext(
            input.organizationId,
            input.conversationId,
            input.requestId,
            true,
        );
        const response = await this.repository.loadResponse(
            input.organizationId,
            input.conversationId,
            messageId,
        );

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
        let evidence: RetrievedEvidence[] = [];
        let retrievalContextualized = false;
        let provider = this.answers.provider;
        let model = this.answers.model;
        let inputTokens: number | null = null;
        let outputTokens: number | null = null;
        let aiStatus: "succeeded" | "failed" = "succeeded";
        let errorCode: string | null = null;
        let answer: RagAnswer;

        try
        {
            if (isExplicitHandoffRequest(input.text))
            {
                provider = "policy";
                model = "customer-handoff-v1";
                answer = createSafeHandoff(input.text, language, "customer_requested");
            }
            else
            {
                const rules: GuardrailRule[] = await this.repository.listGuardrailRules(
                    organizationId,
                );
                const inputGuardrailStartedAt = Date.now();
                const inputEvaluation = evaluateDeterministicGuardrails({
                    candidateAnswer: null,
                    evidence: [],
                    language,
                    rules,
                    userMessage: input.text,
                });

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

                const recentMessages = await this.repository.listRecentMessages(
                    organizationId,
                    conversationId,
                    customerMessage.id,
                );
                const retrievalQuestion = buildRetrievalQuestion(
                    input.text,
                    recentMessages,
                );
                retrievalContextualized = retrievalQuestion !== input.text.trim();
                const vectors = await this.embeddings.embed([retrievalQuestion]);
                const queryEmbedding = vectors[0];

                if (queryEmbedding === undefined)
                {
                    throw new ApiError(502, "QUERY_EMBEDDING_INVALID", "The query embedding is not valid.");
                }

                evidence = await this.repository.retrieveEvidence(
                    organizationId,
                    retrievalQuestion,
                    queryEmbedding,
                    parseThreshold(this.bindings),
                    8,
                );

                if (evidence.length === 0)
                {
                    provider = "retrieval-gate";
                    model = "no-evidence-v2";
                    answer = createSafeClarification(input.text, language, "missing_knowledge");
                }
                else
                {
                    const generationInput = {
                        evidence,
                        language,
                        question: input.text,
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
                        const generated = await this.answers.generate(generationInput);
                        inputTokens = generated.inputTokens;
                        outputTokens = generated.outputTokens;
                        answer = enforceCustomerControlledHandoff(
                            validateGroundedAnswer(generated.answer, evidence),
                            input.text,
                            language,
                        );
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
                        const outputGuardrailStartedAt = Date.now();
                        const outputEvaluation = evaluateDeterministicGuardrails({
                            candidateAnswer: answer.answer,
                            evidence: citedEvidence,
                            language,
                            rules,
                            userMessage: input.text,
                        });

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

                        const supervisionStartedAt = Date.now();
                        const supervision = await this.guardrails.supervise({
                            candidateAnswer: answer.answer,
                            evidence: citedEvidence,
                            language,
                            rules,
                            userMessage: input.text,
                        });

                        if (!supervision.evaluation.allowed)
                        {
                            return this.persistGuardrailBlock({
                                candidate,
                                conversationId,
                                customerMessageId: customerMessage.id,
                                evaluation: supervision.evaluation,
                                guardrail: {
                                    inputTokens: supervision.inputTokens,
                                    latencyMs: Date.now() - supervisionStartedAt,
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
            errorCode = error instanceof ApiError
                ? error.code
                : error instanceof Error
                    ? error.name.slice(0, 120)
                    : "UNKNOWN_ERROR";
            answer = createSafeClarification(input.text, language, "system_error");

            console.error(JSON.stringify({
                conversationId,
                errorCode,
                event: "public.turn.failed_closed",
                requestId,
            }));
        }

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
                scores: evidence.map((item) => ({
                    chunkId: item.chunkId,
                    combinedScore: item.combinedScore,
                })),
                threshold: parseThreshold(this.bindings),
            },
            retrievedChunkIds: evidence.map((item) => item.chunkId),
        });
        await this.refreshOperationalContext(
            organizationId,
            conversationId,
            requestId,
            answer.decision === "handoff",
        );
        const response = await this.repository.loadResponse(
            organizationId,
            conversationId,
            messageId,
        );

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
