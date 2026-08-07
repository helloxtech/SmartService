import {
    completeVoiceTurnResponseSchema,
    recordVoiceTranscriptResponseSchema,
    voiceSessionConfigurationSchema,
    type ConversationLanguage,
    type CompleteVoiceTurnResponse,
    type VoiceSessionConfiguration,
    type VoiceSessionStatus,
} from "@smartservice/contracts";

import type { VoiceAgentConfiguration } from "./config";

export const VOICE_INTERNAL_API_TIMEOUT_MS = 12_000;
export const VOICE_TURN_REQUEST_TIMEOUT_MS = 9_000;

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
     * completeTurn
     * ----------------
     * Sends one final STT utterance through the shared server-side RAG and guardrail path and receives only approved public answer fields.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 7 Shared Voice Assistant Core
     */
    public async completeTurn(
        voiceSessionId: string,
        clientMessageId: string,
        text: string,
        transcribedAt: string,
        signal?: AbortSignal,
    ): Promise<CompleteVoiceTurnResponse>
    {
        return completeVoiceTurnResponseSchema.parse(
            await this.request(
                `/api/v1/internal/voice/sessions/${voiceSessionId}/turns`,
                {
                    body: JSON.stringify({
                        clientMessageId,
                        text,
                        transcribedAt,
                    }),
                    method: "POST",
                },
                true,
                signal,
                VOICE_TURN_REQUEST_TIMEOUT_MS,
            ),
        );
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
     * Performs an authenticated JSON request with one total deadline shared across the initial attempt and one transient-server retry.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    private async request(
        path: string,
        init: RequestInit,
        expectJson = true,
        signal?: AbortSignal,
        timeoutMs = VOICE_INTERNAL_API_TIMEOUT_MS,
    ): Promise<unknown>
    {
        const url = new URL(path, this.configuration.VOICE_INTERNAL_API_BASE_URL);
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const requestSignal = signal === undefined
            ? timeoutSignal
            : AbortSignal.any([
                signal,
                timeoutSignal,
            ]);

        for (let attempt = 0; attempt < 2; attempt += 1)
        {
            const response = await this.fetcher(url, {
                ...init,
                headers: {
                    authorization: `Bearer ${this.configuration.VOICE_INTERNAL_SERVICE_TOKEN}`,
                    "content-type": "application/json",
                },
                signal: requestSignal,
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
