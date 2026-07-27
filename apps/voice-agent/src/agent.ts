import {
    defineAgent,
    voice,
    type AgentDefinition,
    type JobContext,
} from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";

import type { VoiceAgentConfiguration } from "./config";
import { VoiceInternalApiClient } from "./internal-api";
import { readVoiceSessionId } from "./metadata";

/**
 * persistFinalTranscript
 * ----------------
 * Persists one final non-empty STT event by ID without writing transcript content to process logs.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
async function persistFinalTranscript(
    api: VoiceInternalApiClient,
    voiceSessionId: string,
    language: "zh-CN" | "en",
    transcript: string,
): Promise<void>
{
    const text = transcript.trim();

    if (text.length === 0)
    {
        return;
    }

    await api.recordTranscript(
        voiceSessionId,
        crypto.randomUUID(),
        text,
        language,
        new Date().toISOString(),
    );
}

/**
 * runVoiceJob
 * ----------------
 * Connects early, loads the server-authoritative session, starts Nova-3 streaming STT, and reports Ready before microphone activation.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
async function runVoiceJob(
    context: JobContext<unknown>,
    configuration: VoiceAgentConfiguration,
): Promise<void>
{
    const voiceSessionId = readVoiceSessionId(context.job.metadata);
    const api = new VoiceInternalApiClient(configuration);

    await api.updateStatus(voiceSessionId, "warming");
    await context.connect();

    try
    {
        const sessionConfiguration = await api.getConfiguration(voiceSessionId);
        const stt = new deepgram.STT({
            apiKey: configuration.DEEPGRAM_API_KEY,
            interimResults: true,
            keyterm: ["NovaFlow", "NF-200", "NF-500"],
            language: sessionConfiguration.language,
            model: "nova-3",
            noDelay: true,
            punctuate: true,
            smartFormat: true,
        });
        const session = new voice.AgentSession({
            stt,
            turnHandling: {
                turnDetection: "stt",
            },
        });
        const agent = new voice.Agent({
            instructions: sessionConfiguration.language === "zh-CN"
                ? "准确听取客户的中文问题。此阶段只转录，不生成答案。"
                : "Listen accurately to the customer's English question. Transcribe only at this stage.",
        });

        session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (event) =>
        {
            if (event.isFinal)
            {
                void persistFinalTranscript(
                    api,
                    voiceSessionId,
                    sessionConfiguration.language,
                    event.transcript,
                );
            }
        });

        await session.start({
            agent,
            record: {
                audio: false,
                logs: true,
                traces: true,
                transcript: false,
            },
            room: context.room,
        });
        await api.updateStatus(voiceSessionId, "ready");
    }
    catch (error: unknown)
    {
        await api.updateStatus(
            voiceSessionId,
            "failed",
            error instanceof Error ? error.name.slice(0, 120) : "VOICE_AGENT_FAILED",
        );
        throw error;
    }
}

/**
 * createVoiceAgent
 * ----------------
 * Builds the named LiveKit Agent entrypoint around one validated immutable process configuration.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
export function createVoiceAgent(
    configuration: VoiceAgentConfiguration,
): AgentDefinition<Record<string, unknown>>
{
    return defineAgent({
        /**
         * entry
         * ----------------
         * Delegates one LiveKit job to the tenant-safe voice-session runner.
         *
         * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
         */
        entry: async (context) =>
        {
            await runVoiceJob(context, configuration);
        },
    });
}
