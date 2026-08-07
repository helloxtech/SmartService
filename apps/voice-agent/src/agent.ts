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
        maxDelay: 1_000,
        minDelay: 500,
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
        enabled: false,
        maxRetries: 0,
        maxSpeechDuration: 10_000,
        preemptiveTts: false,
    },
} as const;

export const VOICE_PROGRESS_CUE_DELAY_MS = 1_200;

export const VOICE_STT_SETTINGS = {
    interimResults: true,
    model: "nova-3",
    noDelay: true,
    punctuate: true,
    smartFormat: true,
} as const;

export const VOICE_TTS_SETTINGS = {
    applyTextNormalization: "auto",
    enableLogging: false,
    model: "eleven_flash_v2_5",
    syncAlignment: true,
} as const;

export type VoiceSpeechPurpose = "approved_answer" | "ephemeral";

/**
 * buildVoiceSpeechOptions
 * ----------------
 * Keeps approved answers in Agent context while excluding greetings, progress cues, and failures from the customer conversation record.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService Human-Like Voice Experience
 */
export function buildVoiceSpeechOptions(purpose: VoiceSpeechPurpose): {
    addToChatCtx: boolean;
    allowInterruptions: true;
}
{
    return {
        addToChatCtx: purpose === "approved_answer",
        allowInterruptions: true,
    };
}

/**
 * buildVoiceGreeting
 * ----------------
 * Returns one tenant-neutral opening that speaks as the company's customer-service team without claiming a human identity or querying knowledge.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService Human-Like Voice Experience
 */
export function buildVoiceGreeting(language: "zh-CN" | "en"): string
{
    return language === "zh-CN"
        ? "您好，感谢您联系我们。请问今天有什么可以帮您？"
        : "Hi, thanks for reaching out. How can I help you today?";
}

/**
 * buildVoiceProgressSpeech
 * ----------------
 * Returns one brief non-factual service acknowledgement for turns whose approved answer is still being prepared.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService Human-Like Voice Experience
 */
export function buildVoiceProgressSpeech(language: "zh-CN" | "en"): string
{
    return language === "zh-CN"
        ? "好的，我帮您确认一下。"
        : "Of course. Let me check that for you.";
}

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
        ? "抱歉，语音连接暂时不可用。您可以继续使用文字客服。"
        : "Sorry, this voice connection is unavailable right now. You can continue with text customer service.";
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

interface VoiceSpeechHandle
{
    waitForPlayout(): Promise<void>;
}

interface VoiceTurnCoordinatorOptions
{
    api: Pick<VoiceInternalApiClient, "completeTurn" | "updateStatus">;
    language: "zh-CN" | "en";
    say(text: string, purpose: VoiceSpeechPurpose): VoiceSpeechHandle;
    shutdown(reason: string): void;
    voiceSessionId: string;
}

export class VoiceTurnCoordinator
{
    private activeController: AbortController | null = null;
    private activeProgressTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * VoiceTurnCoordinator
     * ----------------
     * Coordinates one final STT turn with the shared server assistant and schedules only its approved speech for TTS.
     *
     * August 07, 2026: Created by Forrest Zhang for SmartService Mobile Voice Turn Completion
     */
    public constructor(private readonly options: VoiceTurnCoordinatorOptions)
    {
    }

    /**
     * abortActiveTurn
     * ----------------
     * Cancels an in-flight server turn when newer customer speech supersedes it or the room is shutting down.
     *
     * August 07, 2026: Created by Forrest Zhang for SmartService Mobile Voice Turn Completion
     */
    public abortActiveTurn(): void
    {
        this.activeController?.abort();

        if (this.activeProgressTimer !== null)
        {
            clearTimeout(this.activeProgressTimer);
            this.activeProgressTimer = null;
        }
    }

    /**
     * handleFinalTurn
     * ----------------
     * Sends one completed customer utterance through the shared grounded assistant, schedules approved TTS, and fails closed without logging transcript content.
     *
     * August 07, 2026: Created by Forrest Zhang for SmartService Mobile Voice Turn Completion
     */
    public async handleFinalTurn(text: string): Promise<void>
    {
        const normalizedText = text.trim();

        if (normalizedText.length === 0)
        {
            return;
        }

        this.abortActiveTurn();
        const controller = new AbortController();
        const startedAt = Date.now();
        this.activeController = controller;
        const progressTimer = setTimeout(() =>
        {
            if (
                controller.signal.aborted
                || this.activeController !== controller
            )
            {
                return;
            }

            if (this.activeProgressTimer === progressTimer)
            {
                this.activeProgressTimer = null;
            }

            try
            {
                this.options.say(
                    buildVoiceProgressSpeech(this.options.language),
                    "ephemeral",
                );
                console.info(JSON.stringify({
                    elapsedMs: Date.now() - startedAt,
                    event: "voice.turn.progress_scheduled",
                    voiceSessionId: this.options.voiceSessionId,
                }));
            }
            catch
            {
                console.warn(JSON.stringify({
                    errorCode: "VOICE_PROGRESS_SPEECH_UNAVAILABLE",
                    event: "voice.turn.progress_skipped",
                    voiceSessionId: this.options.voiceSessionId,
                }));
            }
        }, VOICE_PROGRESS_CUE_DELAY_MS);
        this.activeProgressTimer = progressTimer;
        console.info(JSON.stringify({
            event: "voice.turn.finalized",
            transcriptLength: normalizedText.length,
            voiceSessionId: this.options.voiceSessionId,
        }));

        try
        {
            const result = await this.options.api.completeTurn(
                this.options.voiceSessionId,
                crypto.randomUUID(),
                normalizedText,
                new Date().toISOString(),
                controller.signal,
            );

            if (controller.signal.aborted)
            {
                return;
            }

            if (this.activeProgressTimer === progressTimer)
            {
                clearTimeout(progressTimer);
                this.activeProgressTimer = null;
            }

            const speechHandle = this.options.say(normalizeVoiceSpeech(
                result.spokenText,
                this.options.language,
            ), "approved_answer");
            console.info(JSON.stringify({
                decision: result.decision,
                elapsedMs: Date.now() - startedAt,
                event: "voice.turn.speech_scheduled",
                voiceSessionId: this.options.voiceSessionId,
            }));
            void speechHandle.waitForPlayout().then(
                () =>
                {
                    console.info(JSON.stringify({
                        event: "voice.turn.playout_completed",
                        voiceSessionId: this.options.voiceSessionId,
                    }));

                    if (result.decision === "handoff")
                    {
                        this.options.shutdown("voice_handoff");
                    }
                },
                () =>
                {
                    console.error(JSON.stringify({
                        errorCode: "VOICE_PLAYOUT_FAILED",
                        event: "voice.turn.playout_failed",
                        voiceSessionId: this.options.voiceSessionId,
                    }));

                    if (result.decision === "handoff")
                    {
                        this.options.shutdown("voice_handoff");
                    }
                },
            );
        }
        catch (error: unknown)
        {
            if (controller.signal.aborted)
            {
                console.info(JSON.stringify({
                    event: "voice.turn.superseded",
                    voiceSessionId: this.options.voiceSessionId,
                }));
                return;
            }

            try
            {
                await this.options.api.updateStatus(
                    this.options.voiceSessionId,
                    "failed",
                    "VOICE_TURN_SERVICE_UNAVAILABLE",
                );
            }
            catch
            {
                // The fixed failure speech below remains safe when status reporting is unavailable.
            }

            console.error(JSON.stringify({
                errorCode: error instanceof DOMException && error.name === "TimeoutError"
                    ? "VOICE_TURN_TIMEOUT"
                    : "VOICE_TURN_SERVICE_UNAVAILABLE",
                event: "voice.turn.failed_closed",
                voiceSessionId: this.options.voiceSessionId,
            }));

            try
            {
                const speechHandle = this.options.say(buildVoiceFailureSpeech(
                    this.options.language,
                ), "ephemeral");
                void speechHandle.waitForPlayout().then(
                    () =>
                    {
                        this.options.shutdown("voice_service_failure");
                    },
                    () =>
                    {
                        this.options.shutdown("voice_service_failure");
                    },
                );
            }
            catch
            {
                this.options.shutdown("voice_service_failure");
            }
        }
        finally
        {
            if (this.activeProgressTimer === progressTimer)
            {
                clearTimeout(progressTimer);
                this.activeProgressTimer = null;
            }

            if (this.activeController === controller)
            {
                this.activeController = null;
            }
        }
    }
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
            ...VOICE_STT_SETTINGS,
            apiKey: configuration.DEEPGRAM_API_KEY,
            language: sessionConfiguration.language,
        });
        const tts = new elevenlabs.TTS({
            apiKey: configuration.ELEVENLABS_API_KEY,
            ...VOICE_TTS_SETTINGS,
            language: sessionConfiguration.language === "zh-CN" ? "zh" : "en",
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
        const turnCoordinator = new VoiceTurnCoordinator({
            api,
            language: sessionConfiguration.language,
            say(text, purpose)
            {
                return session.say(text, buildVoiceSpeechOptions(purpose));
            },
            shutdown(reason)
            {
                context.shutdown(reason);
            },
            voiceSessionId,
        });
        const agent = voice.Agent.create({
            instructions: sessionConfiguration.language === "zh-CN"
                ? "准确听取客户的中文问题，只朗读服务器批准的简短回答。"
                : "Listen accurately and speak only the short server-approved answer.",
            /**
             * onUserTurnCompleted
             * ----------------
             * Runs the shared grounded assistant exactly once after LiveKit commits the customer's final semantic turn.
             *
             * August 07, 2026: Updated by Forrest Zhang for SmartService Mobile Voice Turn Completion
             */
            async onUserTurnCompleted(_agentContext, _chatContext, newMessage)
            {
                const text = newMessage.textContent?.trim();

                if (text === undefined || text.length === 0)
                {
                    return;
                }

                await turnCoordinator.handleFinalTurn(text);
            },
        });

        session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (event) =>
        {
            if (!event.isFinal && event.transcript.trim().length > 0)
            {
                turnCoordinator.abortActiveTurn();
            }
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
            if (event.metrics.type === "eou_metrics")
            {
                console.info(JSON.stringify({
                    event: "voice.runtime_metric",
                    metric: event.metrics.type,
                    endOfUtteranceDelayMs: event.metrics.endOfUtteranceDelayMs,
                    onUserTurnCompletedDelayMs: event.metrics.onUserTurnCompletedDelayMs,
                    transcriptionDelayMs: event.metrics.transcriptionDelayMs,
                    voiceSessionId,
                }));
            }
            else if (event.metrics.type === "tts_metrics")
            {
                console.info(JSON.stringify({
                    audioDurationMs: event.metrics.audioDurationMs,
                    cancelled: event.metrics.cancelled,
                    durationMs: event.metrics.durationMs,
                    event: "voice.runtime_metric",
                    metric: event.metrics.type,
                    speechId: event.metrics.speechId ?? null,
                    ttfbMs: event.metrics.ttfbMs,
                    voiceSessionId,
                }));
            }
            else if (
                event.metrics.type === "eot_inference_metrics"
                || event.metrics.type === "interruption_metrics"
            )
            {
                console.info(JSON.stringify({
                    detectionDelay: event.metrics.detectionDelay,
                    event: "voice.runtime_metric",
                    metric: event.metrics.type,
                    predictionDuration: event.metrics.predictionDuration,
                    totalDuration: event.metrics.totalDuration,
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
            turnCoordinator.abortActiveTurn();
        });
        const readyAt = Date.now();
        await api.updateStatus(voiceSessionId, "ready");
        const greetingHandle = session.say(
            buildVoiceGreeting(sessionConfiguration.language),
            buildVoiceSpeechOptions("ephemeral"),
        );
        console.info(JSON.stringify({
            event: "voice.session.greeting_scheduled",
            readyToScheduleMs: Date.now() - readyAt,
            voiceSessionId,
        }));
        void greetingHandle.waitForPlayout().then(
            () =>
            {
                console.info(JSON.stringify({
                    event: "voice.session.greeting_playout_completed",
                    voiceSessionId,
                }));
            },
            () =>
            {
                console.warn(JSON.stringify({
                    errorCode: "VOICE_GREETING_PLAYOUT_FAILED",
                    event: "voice.session.greeting_playout_failed",
                    voiceSessionId,
                }));
            },
        );
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
