import {
    defineAgent,
    voice,
    type AgentDefinition,
    type JobContext,
} from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";

import type { VoiceAgentConfiguration } from "./config";
import { VoiceInternalApiClient } from "./internal-api";
import { readVoiceSessionId } from "./metadata";

/**
 * normalizeVoiceSpeech
 * ----------------
 * Expands product-model separators and common units before TTS while preserving the approved answer's meaning.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 7 Voice RAG and TTS
 */
export function normalizeVoiceSpeech(
    text: string,
    language: "zh-CN" | "en",
): string
{
    return text
        .replace(/\b([A-Z]{1,4})-(\d{2,6})\b/gu, (_match, letters: string, digits: string) =>
        {
            return `${letters.split("").join(" ")} ${digits}`;
        })
        .replace(/\bL\/min\b/giu, language === "zh-CN" ? "升每分钟" : "litres per minute")
        .replace(/°C/gu, language === "zh-CN" ? "摄氏度" : " degrees Celsius")
        .replace(/\s+/gu, " ")
        .trim();
}

/**
 * completeAndSpeak
 * ----------------
 * Sends one final non-empty transcript through shared server guardrails, then speaks only the approved bounded text.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 7 Voice RAG and TTS
 */
async function completeAndSpeak(
    api: VoiceInternalApiClient,
    session: voice.AgentSession,
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

    const result = await api.completeTurn(
        voiceSessionId,
        crypto.randomUUID(),
        text,
        new Date().toISOString(),
    );
    session.say(
        normalizeVoiceSpeech(result.spokenText, language),
        {
            addToChatCtx: true,
            allowInterruptions: true,
        },
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
        const tts = new elevenlabs.TTS({
            apiKey: configuration.ELEVENLABS_API_KEY,
            applyTextNormalization: "on",
            enableLogging: false,
            language: sessionConfiguration.language === "zh-CN" ? "zh" : "en",
            model: "eleven_flash_v2_5",
            syncAlignment: true,
            voiceId: configuration.ELEVENLABS_VOICE_ID,
        });
        const session = new voice.AgentSession({
            stt,
            tts,
            turnHandling: {
                turnDetection: "manual",
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
                void completeAndSpeak(
                    api,
                    session,
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
