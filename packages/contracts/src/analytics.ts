import { z } from "zod";

import { publicCitationSchema } from "./conversation";
import { ingestionStatusSchema } from "./knowledge";

export const dashboardSummarySchema = z.object({
    aiContainedConversations: z.number().int().nonnegative(),
    aiContainmentRate: z.number().min(0).max(1),
    from: z.iso.datetime({ offset: true }),
    handedOffConversations: z.number().int().nonnegative(),
    handoffRate: z.number().min(0).max(1),
    openKnowledgeGapCount: z.number().int().nonnegative(),
    to: z.iso.datetime({ offset: true }),
    totalConversations: z.number().int().nonnegative(),
});

export const knowledgeGapStatusSchema = z.enum([
    "open",
    "resolved",
    "ignored",
]);

export const knowledgeGapResolutionSourceSchema = z.object({
    chunkCount: z.number().int().nonnegative(),
    id: z.uuid(),
    name: z.string().min(1).max(240),
    status: ingestionStatusSchema,
});

export const knowledgeGapSchema = z.object({
    createdAt: z.iso.datetime({ offset: true }),
    exampleQuestion: z.string().min(1).max(4000),
    firstConversationId: z.uuid().nullable(),
    id: z.uuid(),
    lastSeenAt: z.iso.datetime({ offset: true }),
    normalizedQuestion: z.string().min(1).max(2000),
    occurrenceCount: z.number().int().positive(),
    reason: z.string().min(1).max(2000),
    resolutionSource: knowledgeGapResolutionSourceSchema.nullable(),
    status: knowledgeGapStatusSchema,
    updatedAt: z.iso.datetime({ offset: true }),
});

export const knowledgeGapListResponseSchema = z.object({
    gaps: z.array(knowledgeGapSchema).max(200),
});

export const resolveKnowledgeGapRequestSchema = z.object({
    answer: z.string().trim().min(1).max(5000),
    sourceNote: z.string().trim().min(1).max(500).optional(),
    title: z.string().trim().min(1).max(240),
});

export const resolveKnowledgeGapResponseSchema = z.object({
    gapId: z.uuid(),
    jobId: z.uuid(),
    sourceId: z.uuid(),
    status: ingestionStatusSchema,
});

export const knowledgeGapActionSchema = z.enum([
    "ignore",
    "reopen",
]);

export const knowledgeGapRetestResponseSchema = z.object({
    answer: z.string().min(1).max(5000),
    citations: z.array(publicCitationSchema).max(5),
    decision: z.enum(["answer", "clarify", "handoff"]),
    gapId: z.uuid(),
    testedAt: z.iso.datetime({ offset: true }),
});

export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
export type KnowledgeGap = z.infer<typeof knowledgeGapSchema>;
export type KnowledgeGapAction = z.infer<typeof knowledgeGapActionSchema>;
export type KnowledgeGapRetestResponse = z.infer<typeof knowledgeGapRetestResponseSchema>;
export type KnowledgeGapStatus = z.infer<typeof knowledgeGapStatusSchema>;
export type ResolveKnowledgeGapRequest = z.infer<typeof resolveKnowledgeGapRequestSchema>;
export type ResolveKnowledgeGapResponse = z.infer<typeof resolveKnowledgeGapResponseSchema>;
