import { z } from "zod";

import { knowledgeSourceTypeSchema } from "./knowledge";

export const conversationLanguageSchema = z.enum(["zh-CN", "en"]);
export const conversationDecisionSchema = z.enum(["answer", "clarify", "handoff"]);
export const conversationStatusSchema = z.enum([
    "active_ai",
    "resolved_ai",
    "handoff_requested",
    "active_human",
    "closed",
]);
export const handoffReasonSchema = z.enum([
    "missing_knowledge",
    "conflicting_knowledge",
    "guardrail",
    "customer_requested",
    "system_error",
]);

export const customerProfileSchema = z.object({
    company: z.string().trim().min(1).max(200).optional(),
    email: z.email().max(320).optional(),
    language: conversationLanguageSchema.default("zh-CN"),
    name: z.string().trim().min(1).max(160).optional(),
    phone: z.string().trim().min(1).max(80).optional(),
}).default({
    language: "zh-CN",
});

export const createPublicConversationRequestSchema = z.object({
    channel: z.enum(["text", "voice"]),
    customer: customerProfileSchema,
    publicKey: z.string().trim().min(8).max(200),
    turnstileToken: z.string().min(1).max(2048),
});

export const createPublicConversationResponseSchema = z.object({
    conversationId: z.uuid(),
    conversationToken: z.string().min(32),
    displayName: z.string().min(1).max(120),
    expiresAt: z.iso.datetime({ offset: true }),
    welcomeMessage: z.string().min(1).max(500),
});

export const sendPublicMessageRequestSchema = z.object({
    clientMessageId: z.uuid(),
    text: z.string().trim().min(1).max(5000),
});

export const publicCitationSchema = z.object({
    citationId: z.uuid(),
    label: z.string().min(1).max(240),
    sourceType: knowledgeSourceTypeSchema,
    sourceUrl: z.url().nullable(),
    supportingExcerpt: z.string().min(1).max(2000),
});

export const publicHandoffSchema = z.object({
    reason: handoffReasonSchema,
    status: z.literal("handoff_requested"),
});

export const sendPublicMessageResponseSchema = z.object({
    answer: z.string().min(1).max(1600),
    citations: z.array(publicCitationSchema).max(5),
    decision: conversationDecisionSchema,
    handoff: publicHandoffSchema.nullable(),
    messageId: z.uuid(),
}).superRefine((value, context) =>
{
    if (value.decision === "answer" && value.citations.length === 0)
    {
        context.addIssue({
            code: "custom",
            message: "Grounded answers require at least one citation.",
            path: ["citations"],
        });
    }

    if (value.decision === "handoff" && value.handoff === null)
    {
        context.addIssue({
            code: "custom",
            message: "Handoff decisions require handoff details.",
            path: ["handoff"],
        });
    }
});

export const publicMessageSchema = z.object({
    citations: z.array(publicCitationSchema).max(5),
    createdAt: z.iso.datetime({ offset: true }),
    decision: conversationDecisionSchema.or(z.literal("human")).nullable(),
    messageId: z.uuid(),
    senderType: z.enum(["ai", "human", "system"]),
    text: z.string().min(1).max(20000),
});

export const publicMessageListResponseSchema = z.object({
    messages: z.array(publicMessageSchema).max(100),
    nextCursor: z.string().min(1).max(500).nullable(),
    status: conversationStatusSchema,
});

export const requestPublicHandoffResponseSchema = z.object({
    handoff: publicHandoffSchema,
    messageId: z.uuid(),
});

export const conversationTokenClaimsSchema = z.object({
    exp: z.number().int().positive(),
    nonce: z.uuid(),
    org: z.uuid(),
    scope: z.array(z.enum(["conversation:read", "conversation:write"]))
        .min(1)
        .max(2),
    sub: z.uuid(),
});

export const ragAnswerSchema = z.object({
    answer: z.string().min(1).max(1600),
    citationChunkIds: z.array(z.uuid()).max(5),
    confidence: z.number().min(0).max(1),
    decision: conversationDecisionSchema,
    handoffReason: handoffReasonSchema.nullable(),
    normalizedQuestion: z.string().min(1).max(500),
});

export type ConversationDecision = z.infer<typeof conversationDecisionSchema>;
export type ConversationLanguage = z.infer<typeof conversationLanguageSchema>;
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;
export type ConversationTokenClaims = z.infer<typeof conversationTokenClaimsSchema>;
export type CreatePublicConversationRequest = z.infer<typeof createPublicConversationRequestSchema>;
export type CreatePublicConversationResponse = z.infer<typeof createPublicConversationResponseSchema>;
export type HandoffReason = z.infer<typeof handoffReasonSchema>;
export type PublicCitation = z.infer<typeof publicCitationSchema>;
export type PublicMessage = z.infer<typeof publicMessageSchema>;
export type PublicMessageListResponse = z.infer<typeof publicMessageListResponseSchema>;
export type RagAnswer = z.infer<typeof ragAnswerSchema>;
export type RequestPublicHandoffResponse = z.infer<typeof requestPublicHandoffResponseSchema>;
export type SendPublicMessageRequest = z.infer<typeof sendPublicMessageRequestSchema>;
export type SendPublicMessageResponse = z.infer<typeof sendPublicMessageResponseSchema>;
