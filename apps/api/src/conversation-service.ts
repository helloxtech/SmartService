import {
    createSafeHandoff,
    detectConversationLanguage,
    ragPromptVersion,
    validateGroundedAnswer,
    type RagAnswerProvider,
    type RetrievedEvidence,
} from "@smartservice/assistant-core";
import {
    createPublicConversationResponseSchema,
    publicMessageListResponseSchema,
    requestPublicHandoffResponseSchema,
    sendPublicMessageResponseSchema,
    type ConversationLanguage,
    type ConversationTokenClaims,
    type CreatePublicConversationRequest,
    type CreatePublicConversationResponse,
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
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Handoff
 */
function isExplicitHandoffRequest(question: string): boolean
{
    return /(?:转(?:接)?人工|人工客服|真人客服|找个人|speak (?:to|with) (?:a )?(?:human|person|agent|representative)|talk (?:to|with) (?:a )?(?:human|person|agent|representative)|human agent)/iu
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
    const defaultThreshold = bindings.CHAT_PROVIDER_MODE === "live" ? 0.72 : 0;
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
     * Creates the public text-conversation orchestrator from explicit server-side adapters.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversations
     */
    public constructor(
        private readonly bindings: SmartServiceBindings,
        private readonly repository: SupabaseConversationRepository,
        private readonly embeddings: EmbeddingProvider,
        private readonly answers: RagAnswerProvider,
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
     * Verifies the bearer token and authoritative database state, including immediate invalidation after closure.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
     */
    private async authorize(
        request: Request,
        conversationId: string,
        scope: "conversation:read" | "conversation:write",
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

        if (conversation === null || conversation.status === "closed")
        {
            throw new ApiError(401, "CONVERSATION_TOKEN_INVALID", "The conversation session is not valid.");
        }

        return {
            claims,
            conversation,
        };
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
     * send
     * ----------------
     * Persists one customer turn, performs bounded tenant retrieval and grounded generation, then atomically stores its result.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
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
        const language = detectConversationLanguage(input.text);
        const customerMessage = await this.repository.recordCustomerMessage(
            authorization.claims.org,
            conversationId,
            input.clientMessageId,
            input.text,
            language,
        );

        if (!customerMessage.created)
        {
            const existing = await this.repository.findResponseToCustomerMessage(
                authorization.claims.org,
                conversationId,
                customerMessage.id,
            );

            if (existing !== null)
            {
                return sendPublicMessageResponseSchema.parse(existing);
            }

            if (Date.now() - Date.parse(customerMessage.createdAt) < 30_000)
            {
                throw new ApiError(409, "TURN_IN_PROGRESS", "This message is still being processed.");
            }
        }

        const startedAt = Date.now();
        let evidence: RetrievedEvidence[] = [];
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
                const vectors = await this.embeddings.embed([input.text]);
                const queryEmbedding = vectors[0];

                if (queryEmbedding === undefined)
                {
                    throw new ApiError(502, "QUERY_EMBEDDING_INVALID", "The query embedding is not valid.");
                }

                evidence = await this.repository.retrieveEvidence(
                    authorization.claims.org,
                    input.text,
                    queryEmbedding,
                    parseThreshold(this.bindings),
                    8,
                );

                if (evidence.length === 0)
                {
                    provider = "retrieval-gate";
                    model = "no-evidence-v1";
                    answer = createSafeHandoff(input.text, language, "missing_knowledge");
                }
                else
                {
                    const recentMessages = await this.repository.listRecentMessages(
                        authorization.claims.org,
                        conversationId,
                    );
                    const generated = await this.answers.generate({
                        evidence,
                        language,
                        question: input.text,
                        recentMessages,
                    });
                    inputTokens = generated.inputTokens;
                    outputTokens = generated.outputTokens;
                    answer = validateGroundedAnswer(generated.answer, evidence);
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
            answer = createSafeHandoff(input.text, language, "system_error");

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
            organizationId: authorization.claims.org,
            outputTokens,
            promptVersion: ragPromptVersion,
            provider,
            requestId,
            retrievalMetadata: {
                count: evidence.length,
                scores: evidence.map((item) => ({
                    chunkId: item.chunkId,
                    combinedScore: item.combinedScore,
                })),
                threshold: parseThreshold(this.bindings),
            },
            retrievedChunkIds: evidence.map((item) => item.chunkId),
        });
        const response = await this.repository.loadResponse(
            authorization.claims.org,
            conversationId,
            messageId,
        );

        return sendPublicMessageResponseSchema.parse(response);
    }

    /**
     * requestHandoff
     * ----------------
     * Verifies the conversation, applies a bounded write rate, and persists an idempotent customer-requested handoff.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Handoff
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

        return requestPublicHandoffResponseSchema.parse({
            handoff: {
                reason: "customer_requested",
                status: "handoff_requested",
            },
            messageId,
        });
    }
}
