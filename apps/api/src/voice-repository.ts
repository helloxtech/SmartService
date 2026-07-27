import { voiceSessionConfigurationSchema } from "@smartservice/contracts";
import type {
    ConversationLanguage,
    VoiceSessionConfiguration,
    VoiceSessionStatus,
} from "@smartservice/contracts";
import { z } from "zod";

import type { SupabaseConversationRepository } from "./conversation-repository";
import { ApiError } from "./errors";
import { createServiceClient } from "./supabase";
import type { SmartServiceBindings } from "./types";

const createdVoiceSessionRowSchema = z.object({
    created: z.boolean(),
    voice_session_id: z.uuid(),
});

const voiceSessionRowSchema = z.object({
    conversation_id: z.uuid(),
    organization_id: z.uuid(),
    status: z.enum(["warming", "ready", "active", "handoff", "closed", "failed"]),
    conversations: z.object({
        language: z.enum(["zh-CN", "en"]),
    }),
});

export class SupabaseVoiceRepository
{
    /**
     * SupabaseVoiceRepository
     * ----------------
     * Creates the service-role voice-session adapter while reusing the conversation repository for transcript persistence.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public constructor(
        private readonly bindings: SmartServiceBindings,
        private readonly conversations: SupabaseConversationRepository,
    )
    {
    }

    /**
     * createSession
     * ----------------
     * Creates or replays one tenant-bound voice session through the database's guarded service-only function.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public async createSession(
        organizationId: string,
        conversationId: string,
        roomName: string,
        participantIdentity: string,
        provider: "livekit" | "mock",
        requestId: string,
    ): Promise<{ created: boolean; voiceSessionId: string }>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client.rpc("create_voice_session", {
            p_conversation_id: conversationId,
            p_organization_id: organizationId,
            p_participant_identity: participantIdentity,
            p_provider: provider,
            p_request_id: requestId,
            p_room_name: roomName,
        });

        if (error !== null || data === null || data.length !== 1)
        {
            throw new ApiError(409, "VOICE_SESSION_NOT_AVAILABLE", "Voice service is not available for this conversation.");
        }

        const row = createdVoiceSessionRowSchema.parse(data[0]);
        return {
            created: row.created,
            voiceSessionId: row.voice_session_id,
        };
    }

    /**
     * getSession
     * ----------------
     * Loads the minimum voice-agent configuration without returning customer details or provider credentials.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public async getSession(voiceSessionId: string): Promise<VoiceSessionConfiguration | null>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client
            .from("voice_sessions")
            .select("organization_id, conversation_id, status, conversations!inner(language)")
            .eq("id", voiceSessionId)
            .maybeSingle();

        if (error !== null)
        {
            throw new ApiError(503, "VOICE_SESSION_LOOKUP_FAILED", "The voice session could not be loaded.");
        }

        if (data === null)
        {
            return null;
        }

        const row = voiceSessionRowSchema.parse(data);
        return voiceSessionConfigurationSchema.parse({
            conversationId: row.conversation_id,
            language: row.conversations.language,
            organizationId: row.organization_id,
            status: row.status,
            voiceSessionId,
        });
    }

    /**
     * recordTranscript
     * ----------------
     * Persists one final STT transcript as an idempotent customer message in the session's exact tenant conversation.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public async recordTranscript(
        session: VoiceSessionConfiguration,
        clientMessageId: string,
        text: string,
        language: ConversationLanguage,
    ): Promise<{ created: boolean; messageId: string }>
    {
        const message = await this.conversations.recordCustomerMessage(
            session.organizationId,
            session.conversationId,
            clientMessageId,
            text,
            language,
        );

        return {
            created: message.created,
            messageId: message.id,
        };
    }

    /**
     * updateStatus
     * ----------------
     * Applies one validated voice lifecycle transition timestamp and audit record through the service-only function.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public async updateStatus(
        voiceSessionId: string,
        status: VoiceSessionStatus,
        errorCode: string | null,
        requestId: string,
    ): Promise<void>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client.rpc("update_voice_session_status", {
            p_error_code: errorCode,
            p_request_id: requestId,
            p_status: status,
            p_voice_session_id: voiceSessionId,
        });

        if (error !== null || data !== true)
        {
            throw new ApiError(404, "VOICE_SESSION_NOT_FOUND", "The voice session does not exist.");
        }
    }
}
