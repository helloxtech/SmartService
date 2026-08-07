import { z } from "zod";

import { conversationLanguageSchema } from "./conversation";
import {
    publicCitationSchema,
    publicHandoffSchema,
} from "./conversation";

export const voiceSessionStatusSchema = z.enum([
    "warming",
    "ready",
    "active",
    "handoff",
    "closed",
    "failed",
]);

export const createVoiceTokenRequestSchema = z.object({
    conversationId: z.uuid(),
});

export const createVoiceTokenResponseSchema = z.object({
    agentName: z.string().min(1).max(120),
    expiresAt: z.iso.datetime({ offset: true }),
    provider: z.enum(["live", "mock"]),
    roomName: z.string().min(1).max(180),
    token: z.string().min(16),
    url: z.string().url(),
    voiceSessionId: z.uuid(),
});

export const endVoiceSessionRequestSchema = z.object({
    conversationId: z.uuid(),
});

export const endVoiceSessionResponseSchema = z.object({
    status: z.enum(["closed", "failed"]),
    voiceSessionId: z.uuid(),
});

export const voiceSessionConfigurationSchema = z.object({
    conversationId: z.uuid(),
    language: conversationLanguageSchema,
    organizationId: z.uuid(),
    status: voiceSessionStatusSchema,
    voiceSessionId: z.uuid(),
});

export const updateVoiceSessionStatusRequestSchema = z.object({
    errorCode: z.string().trim().min(1).max(120).nullable().default(null),
    status: voiceSessionStatusSchema,
});

export const recordVoiceTranscriptRequestSchema = z.object({
    clientMessageId: z.uuid(),
    language: conversationLanguageSchema,
    text: z.string().trim().min(1).max(5000),
    transcribedAt: z.iso.datetime({ offset: true }),
});

export const recordVoiceTranscriptResponseSchema = z.object({
    created: z.boolean(),
    messageId: z.uuid(),
});

export const completeVoiceTurnRequestSchema = z.object({
    clientMessageId: z.uuid(),
    text: z.string().trim().min(1).max(5000),
    transcribedAt: z.iso.datetime({ offset: true }),
});

export const completeVoiceTurnResponseSchema = z.object({
    answer: z.string().min(1).max(1600),
    citations: z.array(publicCitationSchema).max(5),
    decision: z.enum(["answer", "clarify", "handoff"]),
    handoff: publicHandoffSchema.nullable(),
    messageId: z.uuid(),
    spokenText: z.string().min(1).max(500),
});

export type CreateVoiceTokenRequest = z.infer<typeof createVoiceTokenRequestSchema>;
export type CreateVoiceTokenResponse = z.infer<typeof createVoiceTokenResponseSchema>;
export type CompleteVoiceTurnRequest = z.infer<typeof completeVoiceTurnRequestSchema>;
export type CompleteVoiceTurnResponse = z.infer<typeof completeVoiceTurnResponseSchema>;
export type EndVoiceSessionResponse = z.infer<typeof endVoiceSessionResponseSchema>;
export type RecordVoiceTranscriptRequest = z.infer<typeof recordVoiceTranscriptRequestSchema>;
export type RecordVoiceTranscriptResponse = z.infer<typeof recordVoiceTranscriptResponseSchema>;
export type UpdateVoiceSessionStatusRequest = z.infer<typeof updateVoiceSessionStatusRequestSchema>;
export type VoiceSessionConfiguration = z.infer<typeof voiceSessionConfigurationSchema>;
export type VoiceSessionStatus = z.infer<typeof voiceSessionStatusSchema>;
