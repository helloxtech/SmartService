import {
    defineAgent,
    inference,
    voice,
    type AgentDefinition,
    type JobContext,
} from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";

import type { VoiceAgentConfiguration } from "./config";
import { VoiceInternalApiClient } from "./internal-api";
import { readVoiceSessionId } from "./metadata";

export const VOICE_TURN_SETTINGS = {
    endpointing: {
        maxDelay: 1_500,
        minDelay: 300,
        mode: "dynamic",
    },
    interruption: {
        backchannelBoundary: [1_000, 1_000] as [number, number],
        discardAudioIfUninterruptible: true,
        enabled: true,
        falseInterruptionTimeout: 2_000,
        minDuration: 500,
        minWords: 0,
        mode: "adaptive",
        resumeFalseInterruption: true,
    },
    preemptiveGeneration: {
        enabled: true,
        maxRetries: 3,
        maxSpeechDuration: 10_000,
        preemptiveTts: false,
    },
} as const;

/**
 * buildVoiceFailureSpeech
 * ----------------
 * Returns the fixed pre-approved provider-failure phrase that is safe to synthesize without reflecting errors or upstream content.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 9 Voice Failure Handling
 */
export function buildVoiceFailureSpeech(language: "zh-CN" | "en"): string
{
    return language === "zh-CN"
        ? "抱歉，语音服务暂时不可用。请稍后重试，或改用文字客服。"
        : "Sorry, voice service is temporarily unavailable. Please retry or continue by text.";
}

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
 * findLatestUserText
 * ----------------
 * Reads the most recent non-empty user message from a LiveKit chat context without accepting assistant or tool content.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 8 Turn and Interruption
 */
export function findLatestUserText(
    chatContext: Parameters<NonNullable<Parameters<typeof voice.Agent.create>[0]["llmNode"]>>[1],
): string | null
{
    for (let index = chatContext.items.length - 1; index >= 0; index -= 1)
    {
        const item = chatContext.items[index];

        if (item?.type === "message" && item.role === "user")
        {
            const text = item.textContent?.trim();

            if (text !== undefined && text.length > 0)
            {
                return text;
            }
        }
    }

    return null;
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
                ...VOICE_TURN_SETTINGS,
                turnDetection: new inference.TurnDetector({
                    version: "v1-mini",
                }),
            },
        });
        let activeTurnController: AbortController | null = null;
        let activeSpeechHandle: ReturnType<voice.AgentSession["say"]> | null = null;
        const agent = voice.Agent.create({
            instructions: sessionConfiguration.language === "zh-CN"
                ? "准确听取客户的中文问题，只朗读服务器批准的简短回答。"
                : "Listen accurately and speak only the short server-approved answer.",
            /**
             * llmNode
             * ----------------
             * Uses LiveKit's turn lifecycle for preemptive generation and cancellation while delegating all answer, citation, and guardrail decisions to the shared server pipeline.
             *
             * July 27, 2026: Created by Forrest Zhang for SmartService Day 8 Turn and Interruption
             */
            async *llmNode(_agentContext, chatContext)
            {
                const text = findLatestUserText(chatContext);

                if (text === null)
                {
                    return;
                }

                activeTurnController?.abort();
                const controller = new AbortController();
                activeTurnController = controller;
                const speechHandle = activeSpeechHandle;

                try
                {
                    const result = await api.completeTurn(
                        voiceSessionId,
                        crypto.randomUUID(),
                        text,
                        new Date().toISOString(),
                        controller.signal,
                    );
                    yield normalizeVoiceSpeech(
                        result.spokenText,
                        sessionConfiguration.language,
                    );

                    if (result.decision === "handoff" && speechHandle !== null)
                    {
                        void speechHandle.waitForPlayout().finally(() =>
                        {
                            context.shutdown("voice_handoff");
                        });
                    }
                }
                catch (error: unknown)
                {
                    if (controller.signal.aborted)
                    {
                        return;
                    }

                    try
                    {
                        await api.updateStatus(
                            voiceSessionId,
                            "failed",
                            "VOICE_TURN_SERVICE_UNAVAILABLE",
                        );
                    }
                    catch
                    {
                        // The fixed fallback below remains safe when status reporting is also unavailable.
                    }

                    console.error(JSON.stringify({
                        errorCode: error instanceof DOMException && error.name === "TimeoutError"
                            ? "VOICE_TURN_TIMEOUT"
                            : "VOICE_TURN_SERVICE_UNAVAILABLE",
                        event: "voice.turn.failed_closed",
                        voiceSessionId,
                    }));
                    yield buildVoiceFailureSpeech(sessionConfiguration.language);

                    if (speechHandle !== null)
                    {
                        void speechHandle.waitForPlayout().finally(() =>
                        {
                            context.shutdown("voice_service_failure");
                        });
                    }
                }
                finally
                {
                    if (activeTurnController === controller)
                    {
                        activeTurnController = null;
                    }
                }
            },
        });

        session.on(voice.AgentSessionEventTypes.SpeechCreated, (event) =>
        {
            activeSpeechHandle = event.speechHandle;
        });
        session.on(voice.AgentSessionEventTypes.AgentFalseInterruption, (event) =>
        {
            console.info(JSON.stringify({
                event: "voice.false_interruption",
                resumed: event.resumed,
                voiceSessionId,
            }));
        });
        session.on(voice.AgentSessionEventTypes.MetricsCollected, (event) =>
        {
            if (
                event.metrics.type === "eot_inference_metrics"
                || event.metrics.type === "interruption_metrics"
                || event.metrics.type === "tts_metrics"
            )
            {
                console.info(JSON.stringify({
                    event: "voice.runtime_metric",
                    metric: event.metrics.type,
                    voiceSessionId,
                }));
            }
        });
        await session.start({
            agent,
            record: {
                audio: false,
                logs: false,
                traces: false,
                transcript: false,
            },
            room: context.room,
        });
        context.addShutdownCallback(async () =>
        {
            activeTurnController?.abort();
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
