import type {
    ConversationDecision,
    ConversationLanguage,
    ConversationStatus,
    CreatePublicConversationRequest,
    GuardrailRule,
    GuardrailViolation,
    HandoffReason,
    PublicCitation,
    PublicMessage,
    SendPublicMessageResponse,
} from "@smartservice/contracts";
import {
    conversationDecisionSchema,
    conversationStatusSchema,
    guardrailRuleSchema,
    handoffReasonSchema,
    knowledgeSourceTypeSchema,
} from "@smartservice/contracts";
import type {
    RecentConversationMessage,
    RetrievedEvidence,
} from "@smartservice/assistant-core";
import { z } from "zod";

import { ApiError } from "./errors";
import { createServiceClient } from "./supabase";
import type { SmartServiceBindings } from "./types";

const tenantConfigurationSchema = z.object({
    display_name: z.string().min(1).max(120),
    organization_id: z.uuid(),
    welcome_message: z.string().min(1).max(500),
});

const createdConversationRowSchema = tenantConfigurationSchema.extend({
    conversation_id: z.uuid(),
    created: z.boolean(),
});

const rateLimitRowSchema = z.object({
    allowed: z.boolean(),
    remaining: z.number().int().nonnegative(),
    reset_at: z.string(),
});

const conversationRowSchema = z.object({
    channel: z.enum(["text", "voice"]),
    id: z.uuid(),
    language: z.enum(["zh-CN", "en"]),
    organization_id: z.uuid(),
    status: conversationStatusSchema,
});

const recordedMessageRowSchema = z.object({
    created: z.boolean(),
    created_at: z.string(),
    customer_message_id: z.uuid(),
});

const completedTurnRowSchema = z.object({
    ai_run_id: z.uuid().nullable(),
    created: z.boolean(),
    message_id: z.uuid(),
});

const retrievedEvidenceRowSchema = z.object({
    chunk_id: z.uuid(),
    combined_score: z.number(),
    content: z.string().min(1),
    lexical_score: z.number(),
    semantic_similarity: z.number(),
    source_locator: z.record(z.string(), z.unknown()),
});

const recentMessageRowSchema = z.object({
    sender_type: z.enum(["customer", "ai", "human"]),
    text: z.string(),
});

const storedMessageRowSchema = z.object({
    created_at: z.string(),
    decision: conversationDecisionSchema.or(z.literal("human")).nullable(),
    id: z.uuid(),
    metadata: z.record(z.string(), z.unknown()),
    sender_type: z.enum(["ai", "human", "system"]),
    text: z.string(),
});

const citationRowSchema = z.object({
    chunk_id: z.uuid(),
    id: z.uuid(),
    label: z.string(),
    message_id: z.uuid(),
    supporting_excerpt: z.string(),
});

const chunkCitationRowSchema = z.object({
    id: z.uuid(),
    source_id: z.uuid(),
    source_locator: z.record(z.string(), z.unknown()),
});

const sourceCitationRowSchema = z.object({
    id: z.uuid(),
    source_url: z.string().nullable(),
    type: knowledgeSourceTypeSchema,
});

const handoffRpcRowSchema = z.object({
    created: z.boolean(),
    message_id: z.uuid(),
});

const guardrailRuleRowSchema = z.object({
    code: z.string(),
    created_at: z.string(),
    description: z.string(),
    enabled: z.boolean(),
    id: z.uuid(),
    name: z.string(),
    rule_type: z.string(),
    safe_response: z.string(),
    severity: z.string(),
    updated_at: z.string(),
});

const guardedTurnRowSchema = z.object({
    created: z.boolean(),
    guardrail_event_id: z.uuid(),
    message_id: z.uuid(),
    supervisor_ai_run_id: z.uuid(),
});

const persistedAcknowledgementMarker = "conversation_acknowledgement";

/**
 * resolvePersistedConversationDecision
 * ----------------
 * Rehydrates a tenant-neutral acknowledgement from the backward-compatible clarification marker while preserving every native message decision.
 *
 * August 07, 2026: Created by Forrest Zhang for Hosted Acknowledgement Compatibility
 */
export function resolvePersistedConversationDecision(
    decision: ConversationDecision | "human",
    metadata: Record<string, unknown>,
): ConversationDecision | "human";
export function resolvePersistedConversationDecision(
    decision: ConversationDecision | "human" | null,
    metadata: Record<string, unknown>,
): ConversationDecision | "human" | null;
export function resolvePersistedConversationDecision(
    decision: ConversationDecision | "human" | null,
    metadata: Record<string, unknown>,
): ConversationDecision | "human" | null
{
    return decision === "clarify"
        && metadata.handoffReason === persistedAcknowledgementMarker
        ? "acknowledge"
        : decision;
}

export interface TenantConfiguration
{
    displayName: string;
    organizationId: string;
    welcomeMessage: string;
}

export interface PublicConversationRecord
{
    channel: "text" | "voice";
    id: string;
    language: ConversationLanguage;
    organizationId: string;
    status: ConversationStatus;
}

export interface RecordedCustomerMessage
{
    created: boolean;
    createdAt: string;
    id: string;
}

export interface MessageCursorPosition
{
    createdAt: string;
    messageId: string;
}

export interface PublicMessagePage
{
    lastPosition: MessageCursorPosition | null;
    messages: PublicMessage[];
}

export interface CitationWrite
{
    chunkId: string;
    label: string;
    supportingExcerpt: string;
}

export interface CompleteTurnInput
{
    aiStatus: "succeeded" | "failed" | "cancelled";
    answer: string;
    citations: CitationWrite[];
    conversationId: string;
    createGap: boolean;
    customerMessageId: string;
    decision: ConversationDecision;
    errorCode: string | null;
    handoffReason: HandoffReason | null;
    inputTokens: number | null;
    language: ConversationLanguage;
    latencyMs: number;
    model: string;
    normalizedQuestion: string;
    organizationId: string;
    outputTokens: number | null;
    promptVersion: string;
    provider: string;
    requestId: string;
    retrievalMetadata: Record<string, unknown>;
    retrievedChunkIds: string[];
}

export interface CompleteGuardrailTurnInput
{
    blockedCandidate: string | null;
    candidateInputTokens: number | null;
    candidateLatencyMs: number | null;
    candidateModel: string | null;
    candidateOutputTokens: number | null;
    candidatePromptVersion: string | null;
    candidateProvider: string | null;
    conversationId: string;
    customerMessageId: string;
    language: ConversationLanguage;
    organizationId: string;
    requestId: string;
    safeResponse: string;
    supervisorInputTokens: number | null;
    supervisorLatencyMs: number;
    supervisorModel: string;
    supervisorOutputTokens: number | null;
    supervisorPromptVersion: string;
    supervisorProvider: string;
    violations: GuardrailViolation[];
}

/**
 * mapGuardrailRule
 * ----------------
 * Maps one database rule row into the shared tenant guardrail contract.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrails
 */
function mapGuardrailRule(input: unknown): GuardrailRule
{
    const row = guardrailRuleRowSchema.parse(input);

    return guardrailRuleSchema.parse({
        code: row.code,
        createdAt: row.created_at,
        description: row.description,
        enabled: row.enabled,
        id: row.id,
        name: row.name,
        ruleType: row.rule_type,
        safeResponse: row.safe_response,
        severity: row.severity,
        updatedAt: row.updated_at,
    });
}

/**
 * vectorToPostgres
 * ----------------
 * Serializes one validated 1024-dimension query embedding for the pgvector retrieval RPC.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
 */
function vectorToPostgres(vector: readonly number[]): string
{
    if (vector.length !== 1024 || vector.some((value) => !Number.isFinite(value)))
    {
        throw new ApiError(502, "QUERY_EMBEDDING_INVALID", "The query embedding is not valid.");
    }

    return `[${vector.join(",")}]`;
}

/**
 * mapTenantConfiguration
 * ----------------
 * Converts an authoritative public-tenant RPC row into the internal naming convention.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversations
 */
function mapTenantConfiguration(
    row: z.infer<typeof tenantConfigurationSchema>,
): TenantConfiguration
{
    return {
        displayName: row.display_name,
        organizationId: row.organization_id,
        welcomeMessage: row.welcome_message,
    };
}

/**
 * readHandoffReason
 * ----------------
 * Narrows stored message metadata to a safe customer-visible handoff reason.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversations
 */
function readHandoffReason(
    metadata: Record<string, unknown>,
): HandoffReason
{
    const result = handoffReasonSchema.safeParse(metadata.handoffReason);
    return result.success ? result.data : "system_error";
}

export class SupabaseConversationRepository
{
    /**
     * SupabaseConversationRepository
     * ----------------
     * Creates a service-role repository that exposes only conversation-scoped operations to the Worker.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversations
     */
    public constructor(private readonly bindings: SmartServiceBindings)
    {
    }

    /**
     * resolveTenant
     * ----------------
     * Resolves a public widget key to the minimum display configuration without exposing tenant records to the browser.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversations
     */
    public async resolveTenant(publicKey: string): Promise<TenantConfiguration | null>
    {
        const client = createServiceClient(this.bindings);
        const { data: organization, error: organizationError } = await client
            .from("organizations")
            .select("id")
            .eq("public_key", publicKey)
            .maybeSingle();

        if (organizationError !== null)
        {
            throw new ApiError(503, "TENANT_LOOKUP_FAILED", "The customer service widget is unavailable.");
        }

        if (organization === null)
        {
            return null;
        }

        const organizationId = z.uuid().parse(organization.id);
        const { data: setting, error: settingError } = await client
            .from("organization_settings")
            .select("display_name, chat_welcome_message")
            .eq("organization_id", organizationId)
            .maybeSingle();

        if (settingError !== null || setting === null)
        {
            throw new ApiError(503, "TENANT_LOOKUP_FAILED", "The customer service widget is unavailable.");
        }

        return mapTenantConfiguration(tenantConfigurationSchema.parse({
            display_name: setting.display_name,
            organization_id: organizationId,
            welcome_message: setting.chat_welcome_message,
        }));
    }

    /**
     * consumeRateLimit
     * ----------------
     * Atomically consumes one tenant-scoped fixed-window request allowance.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
     */
    public async consumeRateLimit(
        organizationId: string,
        bucketHash: string,
        action: string,
        limit: number,
        windowSeconds: number,
    ): Promise<void>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client.rpc("consume_public_rate_limit", {
            p_action: action,
            p_bucket_hash: bucketHash,
            p_limit: limit,
            p_organization_id: organizationId,
            p_window_seconds: windowSeconds,
        });

        if (error !== null || data === null || data.length !== 1)
        {
            throw new ApiError(503, "RATE_LIMIT_UNAVAILABLE", "The customer service request could not be checked.");
        }

        const result = rateLimitRowSchema.parse(data[0]);

        if (!result.allowed)
        {
            throw new ApiError(429, "RATE_LIMITED", "Please wait briefly before trying again.");
        }
    }

    /**
     * createConversation
     * ----------------
     * Creates or replays one idempotent public conversation through the service-only database function.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversations
     */
    public async createConversation(
        input: CreatePublicConversationRequest,
        idempotencyKey: string,
        requestId: string,
    ): Promise<TenantConfiguration & { conversationId: string }>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client.rpc("create_public_conversation", {
            p_channel: input.channel,
            p_customer_company: input.customer.company ?? null,
            p_customer_email: input.customer.email ?? null,
            p_customer_name: input.customer.name ?? null,
            p_customer_phone: input.customer.phone ?? null,
            p_idempotency_key: idempotencyKey,
            p_language: input.customer.language,
            p_public_key: input.publicKey,
            p_request_id: requestId,
        });

        if (error !== null)
        {
            throw new ApiError(503, "CONVERSATION_CREATE_FAILED", "The conversation could not be started.");
        }

        if (data === null || data.length !== 1)
        {
            throw new ApiError(404, "WIDGET_NOT_FOUND", "The customer service widget is not available.");
        }

        const row = createdConversationRowSchema.parse(data[0]);

        return {
            ...mapTenantConfiguration(row),
            conversationId: row.conversation_id,
        };
    }

    /**
     * getConversation
     * ----------------
     * Loads the exact token-bound conversation and rejects organization mismatches without fallback.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
     */
    public async getConversation(
        organizationId: string,
        conversationId: string,
    ): Promise<PublicConversationRecord | null>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client
            .from("conversations")
            .select("id, organization_id, channel, status, language")
            .eq("organization_id", organizationId)
            .eq("id", conversationId)
            .maybeSingle();

        if (error !== null)
        {
            throw new ApiError(503, "CONVERSATION_LOOKUP_FAILED", "The conversation could not be loaded.");
        }

        if (data === null)
        {
            return null;
        }

        const row = conversationRowSchema.parse(data);

        return {
            channel: row.channel,
            id: row.id,
            language: row.language,
            organizationId: row.organization_id,
            status: row.status,
        };
    }

    /**
     * recordCustomerMessage
     * ----------------
     * Persists one idempotent customer message while AI owns the conversation or while a human handoff remains open.
     *
     * July 29, 2026: Updated by Forrest Zhang for SmartService Pending Handoff Customer Messages
     */
    public async recordCustomerMessage(
        organizationId: string,
        conversationId: string,
        clientMessageId: string,
        text: string,
        language: ConversationLanguage,
    ): Promise<RecordedCustomerMessage>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client.rpc("record_public_customer_message", {
            p_client_message_id: clientMessageId,
            p_conversation_id: conversationId,
            p_language: language,
            p_organization_id: organizationId,
            p_text: text,
        });

        if (error !== null || data === null || data.length !== 1)
        {
            throw new ApiError(409, "MESSAGE_NOT_ACCEPTED", "The message cannot be accepted in the current state.");
        }

        const row = recordedMessageRowSchema.parse(data[0]);

        return {
            created: row.created,
            createdAt: row.created_at,
            id: row.customer_message_id,
        };
    }

    /**
     * retrieveEvidence
     * ----------------
     * Runs tenant/current-version hybrid retrieval and maps only the bounded evidence fields used by the answer service.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
     */
    public async retrieveEvidence(
        organizationId: string,
        question: string,
        queryEmbedding: readonly number[],
        threshold: number,
        limit: number,
    ): Promise<RetrievedEvidence[]>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client.rpc("match_knowledge_chunks", {
            p_match_count: limit,
            p_match_threshold: threshold,
            p_organization_id: organizationId,
            p_query_embedding: vectorToPostgres(queryEmbedding),
            p_query_text: question,
        });

        if (error !== null)
        {
            throw new ApiError(503, "RETRIEVAL_FAILED", "Approved knowledge could not be searched.");
        }

        return (data ?? []).map((value: unknown) =>
        {
            const row = retrievedEvidenceRowSchema.parse(value);

            return {
                chunkId: row.chunk_id,
                combinedScore: row.combined_score,
                content: row.content,
                sourceLocator: row.source_locator,
            };
        });
    }

    /**
     * listGuardrailRules
     * ----------------
     * Loads the current tenant's bounded rule configuration for deterministic checks and candidate supervision.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrails
     */
    public async listGuardrailRules(
        organizationId: string,
    ): Promise<GuardrailRule[]>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client
            .from("guardrail_rules")
            .select("id, code, name, description, severity, rule_type, safe_response, enabled, created_at, updated_at")
            .eq("organization_id", organizationId)
            .order("code");

        if (error !== null)
        {
            throw new ApiError(503, "GUARDRAIL_RULES_UNAVAILABLE", "Guardrail rules could not be loaded.");
        }

        return (data ?? []).map(mapGuardrailRule);
    }

    /**
     * listRecentMessages
     * ----------------
     * Loads a bounded recent transcript for continuity without exposing it outside the server-side prompt boundary.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
     */
    public async listRecentMessages(
        organizationId: string,
        conversationId: string,
        excludedMessageId?: string,
    ): Promise<RecentConversationMessage[]>
    {
        const client = createServiceClient(this.bindings);
        let query = client
            .from("messages")
            .select("sender_type, text")
            .eq("organization_id", organizationId)
            .eq("conversation_id", conversationId)
            .in("sender_type", ["customer", "ai", "human"])
            .order("created_at", { ascending: false })
            .limit(6);

        if (excludedMessageId !== undefined)
        {
            query = query.neq("id", excludedMessageId);
        }

        const { data, error } = await query;

        if (error !== null)
        {
            throw new ApiError(503, "CONVERSATION_CONTEXT_FAILED", "Recent conversation context could not be loaded.");
        }

        return (data ?? [])
            .map((value: unknown) => recentMessageRowSchema.parse(value))
            .reverse()
            .map((row) => ({
                senderType: row.sender_type,
                text: row.text,
            }));
    }

    /**
     * completeTurn
     * ----------------
     * Atomically persists either one deterministic conversational acknowledgement or one grounded AI audit row with validated citations and optional handoff/gap.
     *
     * August 07, 2026: Updated by Forrest Zhang for Tenant-Generic Conversational Turn Planning
     */
    public async completeTurn(input: CompleteTurnInput): Promise<string>
    {
        const client = createServiceClient(this.bindings);

        if (input.decision === "acknowledge")
        {
            const { data, error } = await client.rpc("complete_public_turn", {
                p_ai_status: "succeeded",
                p_answer: input.answer,
                p_citations: [],
                p_conversation_id: input.conversationId,
                p_create_gap: false,
                p_customer_message_id: input.customerMessageId,
                p_decision: "clarify",
                p_error_code: null,
                p_handoff_reason: persistedAcknowledgementMarker,
                p_input_tokens: null,
                p_language: input.language,
                p_latency_ms: input.latencyMs,
                p_model: "deterministic",
                p_normalized_question: input.normalizedQuestion,
                p_organization_id: input.organizationId,
                p_output_tokens: null,
                p_prompt_version: "conversation-act-v1",
                p_provider: "smartservice",
                p_request_id: input.requestId,
                p_retrieval_metadata: {
                    conversationAct: "acknowledgement",
                    storageEncoding: "clarify-marker-v1",
                },
                p_retrieved_chunk_ids: [],
            });

            if (error !== null || data === null || data.length !== 1)
            {
                throw new ApiError(
                    503,
                    "TURN_PERSISTENCE_FAILED",
                    "The conversational response could not be saved.",
                );
            }

            return completedTurnRowSchema.parse(data[0]).message_id;
        }

        const { data, error } = await client.rpc("complete_public_turn", {
            p_ai_status: input.aiStatus,
            p_answer: input.answer,
            p_citations: input.citations,
            p_conversation_id: input.conversationId,
            p_create_gap: input.createGap,
            p_customer_message_id: input.customerMessageId,
            p_decision: input.decision,
            p_error_code: input.errorCode,
            p_handoff_reason: input.handoffReason,
            p_input_tokens: input.inputTokens,
            p_language: input.language,
            p_latency_ms: input.latencyMs,
            p_model: input.model,
            p_normalized_question: input.normalizedQuestion,
            p_organization_id: input.organizationId,
            p_output_tokens: input.outputTokens,
            p_prompt_version: input.promptVersion,
            p_provider: input.provider,
            p_request_id: input.requestId,
            p_retrieval_metadata: input.retrievalMetadata,
            p_retrieved_chunk_ids: input.retrievedChunkIds,
        });

        if (error !== null || data === null || data.length !== 1)
        {
            throw new ApiError(503, "TURN_PERSISTENCE_FAILED", "The grounded response could not be saved.");
        }

        return completedTurnRowSchema.parse(data[0]).message_id;
    }

    /**
     * completeGuardrailTurn
     * ----------------
     * Atomically withholds a blocked candidate and stores the safe response, AI audit runs, rule events, and handoff.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrails
     */
    public async completeGuardrailTurn(
        input: CompleteGuardrailTurnInput,
    ): Promise<string>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client.rpc("complete_guardrail_turn", {
            p_blocked_candidate: input.blockedCandidate,
            p_candidate_input_tokens: input.candidateInputTokens,
            p_candidate_latency_ms: input.candidateLatencyMs,
            p_candidate_model: input.candidateModel,
            p_candidate_output_tokens: input.candidateOutputTokens,
            p_candidate_prompt_version: input.candidatePromptVersion,
            p_candidate_provider: input.candidateProvider,
            p_conversation_id: input.conversationId,
            p_customer_message_id: input.customerMessageId,
            p_language: input.language,
            p_organization_id: input.organizationId,
            p_request_id: input.requestId,
            p_safe_response: input.safeResponse,
            p_supervisor_input_tokens: input.supervisorInputTokens,
            p_supervisor_latency_ms: input.supervisorLatencyMs,
            p_supervisor_model: input.supervisorModel,
            p_supervisor_output_tokens: input.supervisorOutputTokens,
            p_supervisor_prompt_version: input.supervisorPromptVersion,
            p_supervisor_provider: input.supervisorProvider,
            p_violations: input.violations,
        });

        if (error !== null || data === null || data.length !== 1)
        {
            throw new ApiError(503, "GUARDRAIL_PERSISTENCE_FAILED", "The blocked response could not be saved.");
        }

        return guardedTurnRowSchema.parse(data[0]).message_id;
    }

    /**
     * refreshIncrementalSummary
     * ----------------
     * Stores a bounded transcript snapshot after a completed turn so a later handoff never starts from a cold summary.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Handoff Summary
     */
    public async refreshIncrementalSummary(
        organizationId: string,
        conversationId: string,
        requestId: string,
    ): Promise<void>
    {
        const client = createServiceClient(this.bindings);
        const { error } = await client.rpc("refresh_incremental_conversation_summary", {
            p_conversation_id: conversationId,
            p_organization_id: organizationId,
            p_request_id: requestId,
        });

        if (error !== null)
        {
            throw new ApiError(503, "SUMMARY_REFRESH_FAILED", "The handoff summary could not be refreshed.");
        }
    }

    /**
     * refreshHandoffSnapshot
     * ----------------
     * Rebuilds the handoff package from authoritative customer, transcript, and incremental-summary data.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Handoff Summary
     */
    public async refreshHandoffSnapshot(
        organizationId: string,
        conversationId: string,
        requestId: string,
    ): Promise<void>
    {
        const client = createServiceClient(this.bindings);
        const { error } = await client.rpc("refresh_handoff_snapshot", {
            p_conversation_id: conversationId,
            p_organization_id: organizationId,
            p_request_id: requestId,
        });

        if (error !== null)
        {
            throw new ApiError(503, "HANDOFF_SNAPSHOT_FAILED", "The handoff package could not be refreshed.");
        }
    }

    /**
     * findResponseToCustomerMessage
     * ----------------
     * Finds an already persisted AI response so a retried client message does not trigger a second model call.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversations
     */
    public async findResponseToCustomerMessage(
        organizationId: string,
        conversationId: string,
        customerMessageId: string,
    ): Promise<SendPublicMessageResponse | null>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client
            .from("messages")
            .select("id")
            .eq("organization_id", organizationId)
            .eq("conversation_id", conversationId)
            .eq("sender_type", "ai")
            .contains("metadata", {
                replyToMessageId: customerMessageId,
            })
            .limit(1)
            .maybeSingle();

        if (error !== null)
        {
            throw new ApiError(503, "TURN_LOOKUP_FAILED", "The existing response could not be loaded.");
        }

        return data === null
            ? null
            : this.loadResponse(organizationId, conversationId, z.uuid().parse(data.id));
    }

    /**
     * loadCitations
     * ----------------
     * Resolves stored citation rows into safe labels, excerpts, and source metadata without returning chunk IDs.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversations
     */
    public async loadCitations(
        organizationId: string,
        messageIds: readonly string[],
    ): Promise<Map<string, PublicCitation[]>>
    {
        const result = new Map<string, PublicCitation[]>();

        for (const messageId of messageIds)
        {
            result.set(messageId, []);
        }

        if (messageIds.length === 0)
        {
            return result;
        }

        const client = createServiceClient(this.bindings);
        const { data: citationData, error: citationError } = await client
            .from("message_citations")
            .select("id, message_id, chunk_id, label, supporting_excerpt")
            .eq("organization_id", organizationId)
            .in("message_id", [...messageIds]);

        if (citationError !== null)
        {
            throw new ApiError(503, "CITATION_LOOKUP_FAILED", "Response citations could not be loaded.");
        }

        const citations = (citationData ?? []).map((value: unknown) => citationRowSchema.parse(value));
        const chunkIds = [...new Set(citations.map((citation) => citation.chunk_id))];

        if (chunkIds.length === 0)
        {
            return result;
        }

        const { data: chunkData, error: chunkError } = await client
            .from("knowledge_chunks")
            .select("id, source_id, source_locator")
            .eq("organization_id", organizationId)
            .in("id", chunkIds);

        if (chunkError !== null)
        {
            throw new ApiError(503, "CITATION_LOOKUP_FAILED", "Response citations could not be loaded.");
        }

        const chunks = (chunkData ?? []).map((value: unknown) => chunkCitationRowSchema.parse(value));
        const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
        const sourceIds = [...new Set(chunks.map((chunk) => chunk.source_id))];
        const { data: sourceData, error: sourceError } = await client
            .from("knowledge_sources")
            .select("id, type, source_url")
            .eq("organization_id", organizationId)
            .in("id", sourceIds);

        if (sourceError !== null)
        {
            throw new ApiError(503, "CITATION_LOOKUP_FAILED", "Response citations could not be loaded.");
        }

        const sources = (sourceData ?? []).map((value: unknown) => sourceCitationRowSchema.parse(value));
        const sourceById = new Map(sources.map((source) => [source.id, source]));

        for (const citation of citations)
        {
            const chunk = chunkById.get(citation.chunk_id);
            const source = chunk === undefined ? undefined : sourceById.get(chunk.source_id);

            if (chunk === undefined || source === undefined)
            {
                throw new ApiError(503, "CITATION_LOOKUP_FAILED", "Response citations could not be loaded.");
            }

            const pageUrl = source.type === "url"
                ? z.url().safeParse(chunk.source_locator.url)
                : null;

            result.get(citation.message_id)?.push({
                citationId: citation.id,
                label: citation.label,
                sourceType: source.type,
                sourceUrl: pageUrl?.success === true
                    ? pageUrl.data
                    : source.source_url,
                supportingExcerpt: citation.supporting_excerpt,
            });
        }

        return result;
    }

    /**
     * loadResponse
     * ----------------
     * Rehydrates one immediate AI response from persisted customer-visible fields and citation records.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversations
     */
    public async loadResponse(
        organizationId: string,
        conversationId: string,
        messageId: string,
    ): Promise<SendPublicMessageResponse>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client
            .from("messages")
            .select("id, sender_type, text, decision, metadata, created_at")
            .eq("organization_id", organizationId)
            .eq("conversation_id", conversationId)
            .eq("id", messageId)
            .eq("sender_type", "ai")
            .maybeSingle();

        if (error !== null || data === null)
        {
            throw new ApiError(503, "TURN_LOOKUP_FAILED", "The grounded response could not be loaded.");
        }

        const message = storedMessageRowSchema.parse(data);
        const decisionResult = conversationDecisionSchema.safeParse(message.decision);

        if (!decisionResult.success)
        {
            throw new ApiError(503, "TURN_LOOKUP_FAILED", "The grounded response could not be loaded.");
        }

        const citations = await this.loadCitations(organizationId, [message.id]);
        const decision = resolvePersistedConversationDecision(
            decisionResult.data,
            message.metadata,
        );

        return {
            answer: message.text,
            citations: citations.get(message.id) ?? [],
            decision,
            handoff: decision === "handoff"
                ? {
                    reason: readHandoffReason(message.metadata),
                    status: "handoff_requested",
                }
                : null,
            messageId: message.id,
        };
    }

    /**
     * listPublicMessages
     * ----------------
     * Lists only customer-visible server messages after an opaque cursor position.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversations
     */
    public async listPublicMessages(
        organizationId: string,
        conversationId: string,
        cursor: MessageCursorPosition | null,
        limit: number,
    ): Promise<PublicMessagePage>
    {
        const client = createServiceClient(this.bindings);
        let query = client
            .from("messages")
            .select("id, sender_type, text, decision, metadata, created_at")
            .eq("organization_id", organizationId)
            .eq("conversation_id", conversationId)
            .in("sender_type", ["ai", "human", "system"])
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .limit(limit + 1);

        if (cursor !== null)
        {
            query = query.gte("created_at", cursor.createdAt);
        }

        const { data, error } = await query;

        if (error !== null)
        {
            throw new ApiError(503, "MESSAGE_POLL_FAILED", "Conversation messages could not be loaded.");
        }

        const rows = (data ?? [])
            .map((value: unknown) => storedMessageRowSchema.parse(value))
            .filter((row) =>
            {
                if (cursor === null)
                {
                    return true;
                }

                return row.created_at > cursor.createdAt
                    || (row.created_at === cursor.createdAt && row.id > cursor.messageId);
            })
            .slice(0, limit);
        const citations = await this.loadCitations(
            organizationId,
            rows.map((row) => row.id),
        );
        const messages = rows.map((row): PublicMessage => ({
            citations: citations.get(row.id) ?? [],
            createdAt: row.created_at,
            decision: resolvePersistedConversationDecision(
                row.decision,
                row.metadata,
            ),
            messageId: row.id,
            senderType: row.sender_type,
            text: row.text,
        }));
        const last = rows.at(-1);

        return {
            lastPosition: last === undefined
                ? null
                : {
                    createdAt: last.created_at,
                    messageId: last.id,
                },
            messages,
        };
    }

    /**
     * requestHandoff
     * ----------------
     * Idempotently persists a customer-requested handoff and customer-visible system confirmation.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversations
     */
    public async requestHandoff(
        organizationId: string,
        conversationId: string,
        idempotencyKey: string,
        language: ConversationLanguage,
        requestId: string,
    ): Promise<string>
    {
        const client = createServiceClient(this.bindings);
        const systemMessage = language === "zh-CN"
            ? "已收到您的请求，客服专员将继续跟进本次咨询。"
            : "Your request has been sent to a support specialist, who will continue with your enquiry.";
        const { data, error } = await client.rpc("request_public_handoff", {
            p_conversation_id: conversationId,
            p_idempotency_key: idempotencyKey,
            p_language: language,
            p_organization_id: organizationId,
            p_reason: "Customer explicitly requested support-specialist follow-up.",
            p_request_id: requestId,
            p_system_message: systemMessage,
        });

        if (error !== null || data === null || data.length !== 1)
        {
            throw new ApiError(409, "HANDOFF_NOT_ACCEPTED", "A handoff cannot be requested in the current state.");
        }

        return handoffRpcRowSchema.parse(data[0]).message_id;
    }
}
