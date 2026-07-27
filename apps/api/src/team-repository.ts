import type {
    ClaimConversationResponse,
    ConversationFinalization,
    ConversationLanguage,
    CreateGuardrailRuleRequest,
    GuardrailEvent,
    GuardrailRule,
    HandoffSummary,
    SendHumanMessageResponse,
    TeamConversationDetail,
    TeamInboxItem,
    TeamMessage,
    UpdateGuardrailRuleRequest,
} from "@smartservice/contracts";
import {
    claimConversationResponseSchema,
    conversationSummarySchema,
    guardrailCandidateResponseSchema,
    guardrailEventSchema,
    guardrailRuleSchema,
    handoffSummarySchema,
    sendHumanMessageResponseSchema,
    teamConversationDetailSchema,
    teamInboxItemSchema,
    teamMessageSchema,
} from "@smartservice/contracts";
import {
    finalizationPromptVersion,
    type FinalizationMessage,
} from "@smartservice/assistant-core";
import { z } from "zod";

import type { SupabaseConversationRepository } from "./conversation-repository";
import { ApiError } from "./errors";
import { createServiceClient } from "./supabase";
import type {
    AdminIdentity,
    MemberIdentity,
    SmartServiceBindings,
} from "./types";

const handoffRowSchema = z.object({
    accepted_at: z.string().nullable(),
    accepted_by: z.uuid().nullable(),
    conversation_id: z.uuid(),
    reason: z.string(),
    requested_at: z.string(),
    summary_snapshot: z.record(z.string(), z.unknown()),
});

const teamConversationRowSchema = z.object({
    channel: z.literal("text"),
    customer_company: z.string().nullable(),
    customer_email: z.string().nullable(),
    customer_name: z.string().nullable(),
    customer_phone: z.string().nullable(),
    handoff_requested_at: z.string().nullable(),
    id: z.uuid(),
    language: z.enum(["zh-CN", "en"]),
    organization_id: z.uuid(),
    started_at: z.string(),
    status: z.enum([
        "active_ai",
        "resolved_ai",
        "handoff_requested",
        "active_human",
        "closed",
    ]),
});

const guardrailEventRowSchema = z.object({
    blocked_candidate: z.string().nullable().optional(),
    conversation_id: z.uuid(),
    created_at: z.string(),
    customer_message_id: z.uuid().nullable(),
    id: z.uuid(),
    reason: z.string(),
    rule_code: z.string(),
    rule_id: z.uuid().nullable(),
    severity: z.enum(["low", "medium", "high", "critical"]),
});

const teamMessageRowSchema = z.object({
    created_at: z.string(),
    decision: z.enum(["answer", "clarify", "handoff", "human"]).nullable(),
    id: z.uuid(),
    sender_type: z.enum(["customer", "ai", "human", "system"]),
    sender_user_id: z.uuid().nullable(),
    text: z.string(),
});

const summaryRowSchema = z.object({
    created_at: z.string(),
    customer_facts: z.array(z.unknown()),
    follow_up_actions: z.array(z.unknown()),
    id: z.uuid(),
    intent_level: z.string(),
    outcome: z.string(),
    primary_intent: z.string(),
    suggested_script: z.string(),
    summary: z.string(),
});

const managedRuleRowSchema = z.object({
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

const claimedRowSchema = z.object({
    accepted_at: z.string(),
    accepted_by: z.uuid(),
    created: z.boolean(),
    status: z.literal("active_human"),
});

const humanMessageRowSchema = z.object({
    created: z.boolean(),
    created_at: z.string(),
    message_id: z.uuid(),
});

const closeConversationRowSchema = z.object({
    created: z.boolean(),
    language: z.enum(["zh-CN", "en"]),
    status: z.literal("closed"),
});

const finalizationConversationRowSchema = z.object({
    id: z.uuid(),
    language: z.enum(["zh-CN", "en"]),
    organization_id: z.uuid(),
    status: z.literal("closed"),
});

/**
 * mapRuleRow
 * ----------------
 * Maps one service-role guardrail row into the shared Admin/assistant contract.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrails
 */
function mapRuleRow(input: unknown): GuardrailRule
{
    const row = managedRuleRowSchema.parse(input);

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
 * mapGuardrailEvent
 * ----------------
 * Maps a stored event with optional Admin-only candidate text into the shared event contract.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrail Logs
 */
function mapGuardrailEvent(
    input: unknown,
    includeCandidate: boolean,
): GuardrailEvent
{
    const row = guardrailEventRowSchema.parse(input);

    return guardrailEventSchema.parse({
        blockedCandidate: includeCandidate
            ? row.blocked_candidate ?? null
            : undefined,
        conversationId: row.conversation_id,
        createdAt: row.created_at,
        customerMessageId: row.customer_message_id,
        id: row.id,
        reason: row.reason,
        ruleCode: row.rule_code,
        ruleId: row.rule_id,
        severity: row.severity,
    });
}

/**
 * readSnapshotText
 * ----------------
 * Reads one bounded nonempty handoff field from untrusted historical JSON with a safe non-factual fallback.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Handoff Workspace
 */
function readSnapshotText(
    snapshot: Record<string, unknown>,
    key: string,
    fallback: string,
    maxLength: number,
): string
{
    const value = snapshot[key];
    return typeof value === "string" && value.trim().length > 0
        ? value.trim().slice(0, maxLength)
        : fallback;
}

/**
 * normalizeHandoffSummary
 * ----------------
 * Validates current snapshots and safely upgrades older minimal snapshots without inventing customer facts.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Handoff Workspace
 */
function normalizeHandoffSummary(
    snapshot: Record<string, unknown>,
    language: ConversationLanguage,
): HandoffSummary
{
    const parsed = handoffSummarySchema.safeParse(snapshot);

    if (parsed.success)
    {
        return parsed.data;
    }

    const notProvided = language === "zh-CN" ? "未提供" : "Not provided";
    const customerQuestion = readSnapshotText(
        snapshot,
        "customerQuestion",
        notProvided,
        4000,
    );
    const facts = Array.isArray(snapshot.confirmedFacts)
        ? snapshot.confirmedFacts
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.slice(0, 500))
            .slice(0, 20)
        : [];

    return handoffSummarySchema.parse({
        confirmedFacts: facts,
        conversationSummary: customerQuestion,
        currentIntent: notProvided,
        customerQuestion,
        nextStep: readSnapshotText(
            snapshot,
            "nextStep",
            language === "zh-CN"
                ? "人工客服应查看会话并确认客户需求。"
                : "A human specialist should review the conversation and confirm the request.",
            1000,
        ),
        suggestedReply: language === "zh-CN"
            ? "您好，我已查看目前的会话记录。请允许我先确认您的具体需求。"
            : "Hello, I have reviewed the conversation so far. Let me first confirm your specific request.",
        triggerReason: readSnapshotText(
            snapshot,
            "triggerReason",
            notProvided,
            1000,
        ),
    });
}

export interface FinalizationAggregate
{
    alreadyFinalized: boolean;
    conversationId: string;
    language: ConversationLanguage;
    messages: FinalizationMessage[];
    organizationId: string;
}

export class SupabaseTeamRepository
{
    /**
     * SupabaseTeamRepository
     * ----------------
     * Creates the tenant-reconciling team workspace and finalization repository.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Human Handoff
     */
    public constructor(
        private readonly bindings: SmartServiceBindings,
        private readonly conversations: SupabaseConversationRepository,
    )
    {
    }

    /**
     * listRules
     * ----------------
     * Lists all tenant guardrail rules for the Admin workspace and assistant runtime.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrails
     */
    public async listRules(organizationId: string): Promise<GuardrailRule[]>
    {
        return this.conversations.listGuardrailRules(organizationId);
    }

    /**
     * manageRule
     * ----------------
     * Creates or updates one tenant rule through the audited service-only state transition.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrail Admin
     */
    public async manageRule(
        identity: AdminIdentity,
        ruleId: string | null,
        input: CreateGuardrailRuleRequest | UpdateGuardrailRuleRequest,
        requestId: string,
    ): Promise<GuardrailRule>
    {
        const existing = ruleId === null
            ? null
            : (await this.listRules(identity.organizationId))
                .find((rule) => rule.id === ruleId) ?? null;

        if (ruleId !== null && existing === null)
        {
            throw new ApiError(404, "GUARDRAIL_RULE_NOT_FOUND", "The guardrail rule was not found.");
        }

        const merged = {
            code: "code" in input ? input.code : existing?.code,
            description: input.description ?? existing?.description,
            enabled: input.enabled ?? existing?.enabled,
            name: input.name ?? existing?.name,
            ruleType: input.ruleType ?? existing?.ruleType,
            safeResponse: input.safeResponse ?? existing?.safeResponse,
            severity: input.severity ?? existing?.severity,
        };
        const parsed = guardrailRuleSchema.omit({
            createdAt: true,
            id: true,
            updatedAt: true,
        }).parse(merged);
        const client = createServiceClient(this.bindings);
        const { data, error } = await client.rpc("manage_guardrail_rule", {
            p_actor_user_id: identity.userId,
            p_code: parsed.code,
            p_description: parsed.description,
            p_enabled: parsed.enabled,
            p_name: parsed.name,
            p_organization_id: identity.organizationId,
            p_request_id: requestId,
            p_rule_id: ruleId,
            p_rule_type: parsed.ruleType,
            p_safe_response: parsed.safeResponse,
            p_severity: parsed.severity,
        });

        if (error !== null || data === null || data.length !== 1)
        {
            throw new ApiError(409, "GUARDRAIL_RULE_NOT_SAVED", "The guardrail rule could not be saved.");
        }

        return mapRuleRow(data[0]);
    }

    /**
     * listGuardrailEvents
     * ----------------
     * Lists tenant guardrail context with candidate text omitted unless a distinct Admin-only read requests it.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrail Logs
     */
    public async listGuardrailEvents(
        organizationId: string,
        conversationId?: string,
    ): Promise<GuardrailEvent[]>
    {
        const client = createServiceClient(this.bindings);
        let query = client
            .from("guardrail_events")
            .select("id, conversation_id, customer_message_id, rule_id, rule_code, severity, reason, created_at")
            .eq("organization_id", organizationId)
            .order("created_at", { ascending: false })
            .limit(200);

        if (conversationId !== undefined)
        {
            query = query.eq("conversation_id", conversationId);
        }

        const { data, error } = await query;

        if (error !== null)
        {
            throw new ApiError(503, "GUARDRAIL_EVENTS_UNAVAILABLE", "Guardrail events could not be loaded.");
        }

        return (data ?? []).map((row: unknown) => mapGuardrailEvent(row, false));
    }

    /**
     * getGuardrailCandidate
     * ----------------
     * Returns blocked candidate text only from the explicit Admin endpoint after tenant scoping.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrail Privacy
     */
    public async getGuardrailCandidate(
        identity: AdminIdentity,
        eventId: string,
    ): Promise<ReturnType<typeof guardrailCandidateResponseSchema.parse>>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client
            .from("guardrail_events")
            .select("id, blocked_candidate")
            .eq("organization_id", identity.organizationId)
            .eq("id", eventId)
            .maybeSingle();

        if (error !== null)
        {
            throw new ApiError(503, "GUARDRAIL_EVENT_UNAVAILABLE", "The guardrail event could not be loaded.");
        }

        if (data === null)
        {
            throw new ApiError(404, "GUARDRAIL_EVENT_NOT_FOUND", "The guardrail event was not found.");
        }

        return guardrailCandidateResponseSchema.parse({
            blockedCandidate: data.blocked_candidate,
            eventId: data.id,
        });
    }

    /**
     * listInbox
     * ----------------
     * Loads tenant handoffs, customer cards, summaries, and redacted guardrail indicators for the team queue.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Inbox
     */
    public async listInbox(
        organizationId: string,
        includeClosed = false,
    ): Promise<TeamInboxItem[]>
    {
        const client = createServiceClient(this.bindings);
        const { data: handoffData, error: handoffError } = await client
            .from("handoffs")
            .select("conversation_id, reason, summary_snapshot, requested_at, accepted_by, accepted_at")
            .eq("organization_id", organizationId)
            .order("requested_at", { ascending: false })
            .limit(200);

        if (handoffError !== null)
        {
            throw new ApiError(503, "INBOX_UNAVAILABLE", "The handoff inbox could not be loaded.");
        }

        const handoffs = (handoffData ?? []).map((row: unknown) => handoffRowSchema.parse(row));
        const conversationIds = handoffs.map((handoff) => handoff.conversation_id);

        if (conversationIds.length === 0)
        {
            return [];
        }

        const { data: conversationData, error: conversationError } = await client
            .from("conversations")
            .select("id, organization_id, channel, status, customer_name, customer_email, customer_phone, customer_company, language, started_at, handoff_requested_at")
            .eq("organization_id", organizationId)
            .in("id", conversationIds);

        if (conversationError !== null)
        {
            throw new ApiError(503, "INBOX_UNAVAILABLE", "The handoff inbox could not be loaded.");
        }

        const conversations = (conversationData ?? [])
            .map((row: unknown) => teamConversationRowSchema.parse(row));
        const conversationById = new Map(
            conversations.map((conversation) => [conversation.id, conversation]),
        );
        const events = await this.listGuardrailEvents(organizationId);
        const eventsByConversation = new Map<string, GuardrailEvent[]>();

        for (const event of events)
        {
            const current = eventsByConversation.get(event.conversationId) ?? [];
            current.push(event);
            eventsByConversation.set(event.conversationId, current);
        }

        return handoffs.flatMap((handoff) =>
        {
            const conversation = conversationById.get(handoff.conversation_id);

            if (
                conversation === undefined
                || conversation.status === "active_ai"
                || conversation.status === "resolved_ai"
                || (!includeClosed && conversation.status === "closed")
            )
            {
                return [];
            }

            const conversationEvents = eventsByConversation.get(conversation.id) ?? [];

            return [teamInboxItemSchema.parse({
                acceptedAt: handoff.accepted_at,
                acceptedBy: handoff.accepted_by,
                conversationId: conversation.id,
                customer: {
                    channel: conversation.channel,
                    company: conversation.customer_company,
                    email: conversation.customer_email,
                    language: conversation.language,
                    name: conversation.customer_name,
                    phone: conversation.customer_phone,
                },
                guardrailCount: conversationEvents.length,
                handoffReason: handoff.reason,
                handoffRequestedAt: conversation.handoff_requested_at
                    ?? handoff.requested_at,
                latestGuardrailCode: conversationEvents[0]?.ruleCode ?? null,
                startedAt: conversation.started_at,
                status: conversation.status,
                summary: normalizeHandoffSummary(
                    handoff.summary_snapshot,
                    conversation.language,
                ),
            })];
        });
    }

    /**
     * getConversation
     * ----------------
     * Loads one tenant-scoped team detail with transcript, citations, redacted guardrails, and final summary.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Conversation Detail
     */
    public async getConversation(
        organizationId: string,
        conversationId: string,
    ): Promise<TeamConversationDetail | null>
    {
        const inbox = await this.listInbox(organizationId, true);
        const base = inbox.find((item) => item.conversationId === conversationId);

        if (base === undefined)
        {
            return null;
        }

        const client = createServiceClient(this.bindings);
        const { data: messageData, error: messageError } = await client
            .from("messages")
            .select("id, sender_type, sender_user_id, text, decision, created_at")
            .eq("organization_id", organizationId)
            .eq("conversation_id", conversationId)
            .order("created_at")
            .order("id")
            .limit(500);

        if (messageError !== null)
        {
            throw new ApiError(503, "CONVERSATION_UNAVAILABLE", "The conversation could not be loaded.");
        }

        const rows = (messageData ?? []).map((row: unknown) => teamMessageRowSchema.parse(row));
        const citations = await this.conversations.loadCitations(
            organizationId,
            rows.map((row) => row.id),
        );
        const messages = rows.map((row): TeamMessage => teamMessageSchema.parse({
            citations: citations.get(row.id) ?? [],
            createdAt: row.created_at,
            decision: row.decision,
            messageId: row.id,
            senderType: row.sender_type,
            senderUserId: row.sender_user_id,
            text: row.text,
        }));
        const guardrailEvents = await this.listGuardrailEvents(
            organizationId,
            conversationId,
        );
        const { data: summaryData, error: summaryError } = await client
            .from("conversation_summaries")
            .select("id, summary, primary_intent, intent_level, outcome, customer_facts, follow_up_actions, suggested_script, created_at")
            .eq("organization_id", organizationId)
            .eq("conversation_id", conversationId)
            .eq("is_incremental", false)
            .order("version", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (summaryError !== null)
        {
            throw new ApiError(503, "CONVERSATION_UNAVAILABLE", "The conversation summary could not be loaded.");
        }

        const summaryRecord = summaryData === null
            ? null
            : (() =>
            {
                const row = summaryRowSchema.parse(summaryData);
                return conversationSummarySchema.parse({
                    createdAt: row.created_at,
                    customerFacts: row.customer_facts,
                    followUpActions: row.follow_up_actions,
                    id: row.id,
                    intentLevel: row.intent_level,
                    outcome: row.outcome,
                    primaryIntent: row.primary_intent,
                    suggestedScript: row.suggested_script,
                    summary: row.summary,
                });
            })();

        return teamConversationDetailSchema.parse({
            ...base,
            guardrailEvents,
            messages,
            summaryRecord,
        });
    }

    /**
     * claim
     * ----------------
     * Atomically claims an unowned handoff for the authenticated member and transitions the conversation to human control.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Takeover
     */
    public async claim(
        identity: MemberIdentity,
        conversationId: string,
        requestId: string,
    ): Promise<ClaimConversationResponse>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client.rpc("claim_team_conversation", {
            p_actor_user_id: identity.userId,
            p_conversation_id: conversationId,
            p_organization_id: identity.organizationId,
            p_request_id: requestId,
        });

        if (error !== null || data === null || data.length !== 1)
        {
            throw new ApiError(409, "HANDOFF_CLAIM_FAILED", "The handoff is no longer available to claim.");
        }

        const row = claimedRowSchema.parse(data[0]);

        return claimConversationResponseSchema.parse({
            acceptedAt: row.accepted_at,
            acceptedBy: row.accepted_by,
            conversationId,
            status: row.status,
        });
    }

    /**
     * sendHumanMessage
     * ----------------
     * Persists one idempotent human message only for the member who owns the active handoff.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Human Messaging
     */
    public async sendHumanMessage(
        identity: MemberIdentity,
        conversationId: string,
        clientMessageId: string,
        text: string,
        requestId: string,
    ): Promise<SendHumanMessageResponse>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client.rpc("send_team_human_message", {
            p_actor_user_id: identity.userId,
            p_client_message_id: clientMessageId,
            p_conversation_id: conversationId,
            p_organization_id: identity.organizationId,
            p_request_id: requestId,
            p_text: text,
        });

        if (error !== null || data === null || data.length !== 1)
        {
            throw new ApiError(409, "HUMAN_MESSAGE_NOT_ACCEPTED", "The human message cannot be sent in the current state.");
        }

        const row = humanMessageRowSchema.parse(data[0]);

        return sendHumanMessageResponseSchema.parse({
            created: row.created,
            message: {
                citations: [],
                createdAt: row.created_at,
                decision: "human",
                messageId: row.message_id,
                senderType: "human",
                senderUserId: identity.userId,
                text,
            },
        });
    }

    /**
     * close
     * ----------------
     * Closes one member-owned human conversation and returns whether this request performed the transition.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Conversation Closure
     */
    public async close(
        identity: MemberIdentity,
        conversationId: string,
        requestId: string,
    ): Promise<{ created: boolean; language: ConversationLanguage }>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client.rpc("close_team_conversation", {
            p_actor_user_id: identity.userId,
            p_conversation_id: conversationId,
            p_organization_id: identity.organizationId,
            p_request_id: requestId,
        });

        if (error !== null || data === null || data.length !== 1)
        {
            throw new ApiError(409, "CONVERSATION_CLOSE_FAILED", "The conversation cannot be closed in the current state.");
        }

        const row = closeConversationRowSchema.parse(data[0]);
        return {
            created: row.created,
            language: row.language,
        };
    }

    /**
     * markFinalizationQueued
     * ----------------
     * Records successful Queue publication after closure so failures remain safely retryable.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Conversation Finalization
     */
    public async markFinalizationQueued(
        organizationId: string,
        conversationId: string,
    ): Promise<void>
    {
        const client = createServiceClient(this.bindings);
        const { error } = await client.rpc("mark_conversation_finalization_queued", {
            p_conversation_id: conversationId,
            p_organization_id: organizationId,
        });

        if (error !== null)
        {
            throw new ApiError(503, "FINALIZATION_QUEUE_MARK_FAILED", "The finalization queue state could not be recorded.");
        }
    }

    /**
     * loadFinalizationAggregate
     * ----------------
     * Reconciles the Queue payload against the authoritative closed conversation and loads a bounded transcript.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Conversation Finalization
     */
    public async loadFinalizationAggregate(
        organizationId: string,
        conversationId: string,
    ): Promise<FinalizationAggregate>
    {
        const client = createServiceClient(this.bindings);
        const { data: conversationData, error: conversationError } = await client
            .from("conversations")
            .select("id, organization_id, status, language")
            .eq("id", conversationId)
            .maybeSingle();

        if (conversationError !== null || conversationData === null)
        {
            throw new ApiError(404, "FINALIZATION_CONVERSATION_NOT_FOUND", "The finalization conversation was not found.");
        }

        const conversation = finalizationConversationRowSchema.parse(conversationData);

        if (conversation.organization_id !== organizationId)
        {
            throw new ApiError(403, "FINALIZATION_TENANT_MISMATCH", "The finalization tenant did not match the conversation.");
        }

        const { data: existingSummary, error: summaryError } = await client
            .from("conversation_summaries")
            .select("id")
            .eq("organization_id", conversation.organization_id)
            .eq("conversation_id", conversation.id)
            .eq("is_incremental", false)
            .limit(1)
            .maybeSingle();

        if (summaryError !== null)
        {
            throw new ApiError(503, "FINALIZATION_STATUS_FAILED", "The finalization status could not be loaded.");
        }

        if (existingSummary !== null)
        {
            return {
                alreadyFinalized: true,
                conversationId: conversation.id,
                language: conversation.language,
                messages: [],
                organizationId: conversation.organization_id,
            };
        }

        const { data: messageData, error: messageError } = await client
            .from("messages")
            .select("id, sender_type, text")
            .eq("organization_id", conversation.organization_id)
            .eq("conversation_id", conversation.id)
            .order("created_at")
            .order("id")
            .limit(500);

        if (messageError !== null)
        {
            throw new ApiError(503, "FINALIZATION_TRANSCRIPT_FAILED", "The finalization transcript could not be loaded.");
        }

        const messages = (messageData ?? []).map((value: unknown) =>
        {
            const row = z.object({
                id: z.uuid(),
                sender_type: z.enum(["customer", "ai", "human", "system"]),
                text: z.string(),
            }).parse(value);

            return {
                id: row.id,
                senderType: row.sender_type,
                text: row.text,
            };
        });

        return {
            alreadyFinalized: false,
            conversationId: conversation.id,
            language: conversation.language,
            messages,
            organizationId: conversation.organization_id,
        };
    }

    /**
     * completeFinalization
     * ----------------
     * Atomically persists the validated final summary and its complete auxiliary-model audit record.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Conversation Finalization
     */
    public async completeFinalization(
        aggregate: FinalizationAggregate,
        finalization: ConversationFinalization,
        provider: string,
        model: string,
        inputTokens: number | null,
        outputTokens: number | null,
        latencyMs: number,
        requestId: string,
    ): Promise<void>
    {
        const client = createServiceClient(this.bindings);
        const { error } = await client.rpc("complete_conversation_finalization", {
            p_conversation_id: aggregate.conversationId,
            p_finalization: finalization,
            p_input_tokens: inputTokens,
            p_latency_ms: latencyMs,
            p_model: model,
            p_organization_id: aggregate.organizationId,
            p_output_tokens: outputTokens,
            p_prompt_version: finalizationPromptVersion,
            p_provider: provider,
            p_request_id: requestId,
        });

        if (error !== null)
        {
            throw new ApiError(503, "FINALIZATION_PERSISTENCE_FAILED", "The conversation summary could not be saved.");
        }
    }
}
