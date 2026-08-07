import { z } from "zod";

import {
    conversationLanguageSchema,
    conversationStatusSchema,
    publicCitationSchema,
} from "./conversation";

export const guardrailSeveritySchema = z.enum([
    "low",
    "medium",
    "high",
    "critical",
]);

export const guardrailRuleTypeSchema = z.enum([
    "price",
    "delivery",
    "competitor",
    "security",
    "unsupported_claim",
    "safety",
    "custom",
]);

export const guardrailRuleSchema = z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/u),
    createdAt: z.iso.datetime({ offset: true }),
    description: z.string().min(1).max(2000),
    enabled: z.boolean(),
    id: z.uuid(),
    name: z.string().min(1).max(160),
    ruleType: guardrailRuleTypeSchema,
    safeResponse: z.string().min(1).max(4000),
    severity: guardrailSeveritySchema,
    updatedAt: z.iso.datetime({ offset: true }),
});

export const createGuardrailRuleRequestSchema = z.object({
    code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,79}$/u),
    description: z.string().trim().min(1).max(2000),
    enabled: z.boolean().default(true),
    name: z.string().trim().min(1).max(160),
    ruleType: guardrailRuleTypeSchema,
    safeResponse: z.string().trim().min(1).max(4000),
    severity: guardrailSeveritySchema,
});

export const updateGuardrailRuleRequestSchema = createGuardrailRuleRequestSchema
    .omit({
        code: true,
    })
    .partial()
    .refine((value) => Object.keys(value).length > 0, {
        message: "At least one guardrail rule field is required.",
    });

export const guardrailRuleListResponseSchema = z.object({
    rules: z.array(guardrailRuleSchema).max(200),
});

export const guardrailViolationSchema = z.object({
    reason: z.string().min(1).max(500),
    ruleCode: z.string().min(1).max(80),
    severity: guardrailSeveritySchema,
});

export const guardrailEvaluationSchema = z.object({
    allowed: z.boolean(),
    requestHandoff: z.boolean(),
    safeResponse: z.string().min(1).max(600).nullable(),
    violations: z.array(guardrailViolationSchema).max(20),
}).superRefine((value, context) =>
{
    if (!value.allowed && value.violations.length === 0)
    {
        context.addIssue({
            code: "custom",
            message: "A blocked guardrail evaluation requires at least one violation.",
            path: ["violations"],
        });
    }

    if (!value.allowed && value.safeResponse === null)
    {
        context.addIssue({
            code: "custom",
            message: "A blocked guardrail evaluation requires a safe response.",
            path: ["safeResponse"],
        });
    }

    if (!value.allowed && !value.requestHandoff)
    {
        context.addIssue({
            code: "custom",
            message: "A blocked guardrail evaluation must request handoff.",
            path: ["requestHandoff"],
        });
    }

    if (
        value.allowed
        && (
            value.violations.length > 0
            || value.safeResponse !== null
            || value.requestHandoff
        )
    )
    {
        context.addIssue({
            code: "custom",
            message: "An allowed guardrail evaluation cannot contain blocking output.",
        });
    }
});

export const guardrailEventSchema = z.object({
    blockedCandidate: z.string().max(20000).nullable().optional(),
    conversationId: z.uuid(),
    createdAt: z.iso.datetime({ offset: true }),
    customerMessageId: z.uuid().nullable(),
    id: z.uuid(),
    reason: z.string().min(1).max(4000),
    ruleCode: z.string().min(1).max(80),
    ruleId: z.uuid().nullable(),
    severity: guardrailSeveritySchema,
});

export const guardrailEventListResponseSchema = z.object({
    events: z.array(guardrailEventSchema.omit({
        blockedCandidate: true,
    })).max(200),
});

export const guardrailCandidateResponseSchema = z.object({
    blockedCandidate: z.string().max(20000).nullable(),
    eventId: z.uuid(),
});

export const customerCardSchema = z.object({
    channel: z.enum(["text", "voice"]),
    company: z.string().max(200).nullable(),
    email: z.string().max(320).nullable(),
    language: conversationLanguageSchema,
    name: z.string().max(160).nullable(),
    phone: z.string().max(80).nullable(),
});

export const voiceServerLatencySchema = z.object({
    maxMs: z.number().int().nonnegative().nullable(),
    p50Ms: z.number().int().nonnegative().nullable(),
    p95Ms: z.number().int().nonnegative().nullable(),
    sampleSize: z.number().int().nonnegative(),
});

export const teamVoiceSessionSchema = z.object({
    createdAt: z.iso.datetime({ offset: true }),
    endedAt: z.iso.datetime({ offset: true }).nullable(),
    errorCode: z.string().max(120).nullable(),
    provider: z.enum(["livekit", "mock"]),
    readyAt: z.iso.datetime({ offset: true }).nullable(),
    serverAssistantLatency: voiceServerLatencySchema,
    startedAt: z.iso.datetime({ offset: true }).nullable(),
    status: z.enum(["warming", "ready", "active", "handoff", "closed", "failed"]),
    voiceSessionId: z.uuid(),
    warmupMs: z.number().int().nonnegative().nullable(),
});

export const handoffSummarySchema = z.object({
    confirmedFacts: z.array(z.string().max(500)).max(20),
    conversationSummary: z.string().min(1).max(4000),
    currentIntent: z.string().min(1).max(240),
    customerQuestion: z.string().min(1).max(4000),
    nextStep: z.string().min(1).max(1000),
    suggestedReply: z.string().min(1).max(1200),
    triggerReason: z.string().min(1).max(1000),
});

export const teamConversationListItemSchema = z.object({
    acceptedAt: z.iso.datetime({ offset: true }).nullable(),
    acceptedBy: z.uuid().nullable(),
    conversationId: z.uuid(),
    customer: customerCardSchema,
    guardrailCount: z.number().int().nonnegative(),
    handoffReason: z.string().min(1).max(2000).nullable(),
    handoffRequestedAt: z.iso.datetime({ offset: true }).nullable(),
    latestActivityAt: z.iso.datetime({ offset: true }),
    latestGuardrailCode: z.string().max(80).nullable(),
    preview: z.string().min(1).max(4000).nullable(),
    startedAt: z.iso.datetime({ offset: true }),
    status: conversationStatusSchema,
    summary: handoffSummarySchema.nullable(),
    voiceSessionStatus: z.enum([
        "warming",
        "ready",
        "active",
        "handoff",
        "closed",
        "failed",
    ]).nullable(),
});

export const teamConversationListResponseSchema = z.object({
    conversations: z.array(teamConversationListItemSchema).max(200),
});

export const teamMessageSchema = z.object({
    citations: z.array(publicCitationSchema).max(5),
    createdAt: z.iso.datetime({ offset: true }),
    decision: z.enum(["acknowledge", "answer", "clarify", "handoff", "human"]).nullable(),
    messageId: z.uuid(),
    senderType: z.enum(["customer", "ai", "human", "system"]),
    senderUserId: z.uuid().nullable(),
    text: z.string().min(1).max(20000),
});

export const finalizationTicketSchema = z.object({
    rationale: z.string().min(1).max(500),
    type: z.enum(["inquiry", "complaint", "after_sales", "other"]),
    urgency: z.enum(["low", "normal", "high", "critical"]),
});

export const customerFactSchema = z.object({
    key: z.string().min(1).max(100),
    sourceMessageId: z.uuid().nullable(),
    value: z.string().min(1).max(300),
});

export const conversationFinalizationSchema = z.object({
    customerFacts: z.array(customerFactSchema).max(20),
    followUpActions: z.array(z.string().min(1).max(300)).max(10),
    intentLevel: z.enum(["low", "medium", "high", "unknown"]),
    outcome: z.enum([
        "resolved_ai",
        "resolved_human",
        "unresolved",
        "follow_up_required",
    ]),
    primaryIntent: z.string().min(1).max(200),
    suggestedScript: z.string().min(1).max(1200),
    summary: z.string().min(1).max(2000),
    ticket: finalizationTicketSchema.nullable(),
});

export const conversationSummarySchema = conversationFinalizationSchema
    .omit({
        ticket: true,
    })
    .extend({
        createdAt: z.iso.datetime({ offset: true }),
        id: z.uuid(),
    });

export const teamConversationDetailSchema = teamConversationListItemSchema.extend({
    guardrailEvents: z.array(guardrailEventSchema.omit({
        blockedCandidate: true,
    })).max(200),
    messages: z.array(teamMessageSchema).max(500),
    summaryRecord: conversationSummarySchema.nullable(),
    voiceSession: teamVoiceSessionSchema.nullable(),
});

export const claimConversationResponseSchema = z.object({
    acceptedAt: z.iso.datetime({ offset: true }),
    acceptedBy: z.uuid(),
    conversationId: z.uuid(),
    status: z.literal("active_human"),
});

export const sendHumanMessageRequestSchema = z.object({
    clientMessageId: z.uuid(),
    text: z.string().trim().min(1).max(5000),
});

export const sendHumanMessageResponseSchema = z.object({
    created: z.boolean(),
    message: teamMessageSchema,
});

export const closeConversationResponseSchema = z.object({
    conversationId: z.uuid(),
    finalizationQueued: z.boolean(),
    status: z.literal("closed"),
});

export const conversationFinalizeMessageSchema = z.object({
    conversationId: z.uuid(),
    includeTicketClassification: z.literal(false),
    organizationId: z.uuid(),
    type: z.literal("conversation.finalize"),
    version: z.literal(1),
});

export type ClaimConversationResponse = z.infer<typeof claimConversationResponseSchema>;
export type CloseConversationResponse = z.infer<typeof closeConversationResponseSchema>;
export type ConversationFinalization = z.infer<typeof conversationFinalizationSchema>;
export type ConversationFinalizeMessage = z.infer<typeof conversationFinalizeMessageSchema>;
export type CreateGuardrailRuleRequest = z.infer<typeof createGuardrailRuleRequestSchema>;
export type GuardrailEvaluation = z.infer<typeof guardrailEvaluationSchema>;
export type GuardrailEvent = z.infer<typeof guardrailEventSchema>;
export type GuardrailRule = z.infer<typeof guardrailRuleSchema>;
export type GuardrailSeverity = z.infer<typeof guardrailSeveritySchema>;
export type GuardrailViolation = z.infer<typeof guardrailViolationSchema>;
export type HandoffSummary = z.infer<typeof handoffSummarySchema>;
export type SendHumanMessageRequest = z.infer<typeof sendHumanMessageRequestSchema>;
export type SendHumanMessageResponse = z.infer<typeof sendHumanMessageResponseSchema>;
export type TeamConversationDetail = z.infer<typeof teamConversationDetailSchema>;
export type TeamConversationListItem = z.infer<typeof teamConversationListItemSchema>;
export type TeamMessage = z.infer<typeof teamMessageSchema>;
export type UpdateGuardrailRuleRequest = z.infer<typeof updateGuardrailRuleRequestSchema>;
