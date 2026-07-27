import {
    recordVoiceTranscriptResponseSchema,
    voiceSessionConfigurationSchema,
    type ConversationLanguage,
    type VoiceSessionConfiguration,
    type VoiceSessionStatus,
} from "@smartservice/contracts";

import type { VoiceAgentConfiguration } from "./config";

export class VoiceInternalApiClient
{
    /**
     * VoiceInternalApiClient
     * ----------------
     * Creates the bounded, server-authenticated Agent client without exposing its service credential to logs or room metadata.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public constructor(
        private readonly configuration: Pick<
            VoiceAgentConfiguration,
            "VOICE_INTERNAL_API_BASE_URL" | "VOICE_INTERNAL_SERVICE_TOKEN"
        >,
        private readonly fetcher: typeof fetch = fetch,
    )
    {
    }

    /**
     * getConfiguration
     * ----------------
     * Loads the minimum tenant-bound session configuration by opaque voice-session ID.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public async getConfiguration(
        voiceSessionId: string,
    ): Promise<VoiceSessionConfiguration>
    {
        return voiceSessionConfigurationSchema.parse(
            await this.request(`/api/v1/internal/voice/sessions/${voiceSessionId}/config`, {
                method: "GET",
            }),
        );
    }

    /**
     * recordTranscript
     * ----------------
     * Persists one final STT utterance with an idempotency UUID and explicit session language.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public async recordTranscript(
        voiceSessionId: string,
        clientMessageId: string,
        text: string,
        language: ConversationLanguage,
        transcribedAt: string,
    ): Promise<void>
    {
        recordVoiceTranscriptResponseSchema.parse(
            await this.request(
                `/api/v1/internal/voice/sessions/${voiceSessionId}/transcripts`,
                {
                    body: JSON.stringify({
                        clientMessageId,
                        language,
                        text,
                        transcribedAt,
                    }),
                    method: "POST",
                },
            ),
        );
    }

    /**
     * updateStatus
     * ----------------
     * Persists one Agent-owned lifecycle state without accepting organization or conversation identity from the process.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public async updateStatus(
        voiceSessionId: string,
        status: VoiceSessionStatus,
        errorCode: string | null = null,
    ): Promise<void>
    {
        await this.request(`/api/v1/internal/voice/sessions/${voiceSessionId}/status`, {
            body: JSON.stringify({
                errorCode,
                status,
            }),
            method: "POST",
        }, false);
    }

    /**
     * request
     * ----------------
     * Performs an authenticated JSON request with a twelve-second timeout and one bounded retry for transient upstream failures.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    private async request(
        path: string,
        init: RequestInit,
        expectJson = true,
    ): Promise<unknown>
    {
        const url = new URL(path, this.configuration.VOICE_INTERNAL_API_BASE_URL);

        for (let attempt = 0; attempt < 2; attempt += 1)
        {
            const response = await this.fetcher(url, {
                ...init,
                headers: {
                    authorization: `Bearer ${this.configuration.VOICE_INTERNAL_SERVICE_TOKEN}`,
                    "content-type": "application/json",
                },
                signal: AbortSignal.timeout(12_000),
            });

            if (response.ok)
            {
                return expectJson ? response.json() : undefined;
            }

            if (response.status < 500 || attempt === 1)
            {
                throw new Error(`Voice internal API request failed with status ${response.status}.`);
            }
        }

        throw new Error("Voice internal API request failed.");
    }
}
