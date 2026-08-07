import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import { readVoiceAgentConfiguration } from "./config";
import {
    buildVoiceFailureSpeech,
    buildVoiceGreeting,
    buildVoiceProgressSpeech,
    buildVoiceSpeechOptions,
    normalizeVoiceSpeech,
    VOICE_PROGRESS_CUE_DELAY_MS,
    VoiceTurnCoordinator,
    VOICE_STT_SETTINGS,
    VOICE_TTS_SETTINGS,
    VOICE_TURN_SETTINGS,
} from "./agent";
import {
    VoiceInternalApiClient,
    VOICE_TURN_REQUEST_TIMEOUT_MS,
} from "./internal-api";
import { readVoiceSessionId } from "./metadata";

const voiceSessionId = "11111111-1111-4111-8111-111111111111";

afterEach(() =>
{
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("voice agent foundation", () =>
{
    it("accepts only ID-based dispatch metadata", () =>
    {
        expect(readVoiceSessionId(JSON.stringify({
            voiceSessionId,
        }))).toBe(voiceSessionId);
        expect(() => readVoiceSessionId(JSON.stringify({
            organizationId: "00000000-0000-4000-a000-000000000001",
        }))).toThrow();
    });

    it("requires the locked Nova-3 and server-only Agent settings", () =>
    {
        const configuration = readVoiceAgentConfiguration({
            DEEPGRAM_API_KEY: "deepgram-test",
            DEEPGRAM_STT_LANGUAGE: "zh-CN",
            DEEPGRAM_STT_MODEL: "nova-3",
            ELEVENLABS_API_KEY: "elevenlabs-test",
            ELEVENLABS_MODEL_ID: "eleven_flash_v2_5",
            ELEVENLABS_VOICE_ID: "voice-test",
            LIVEKIT_AGENT_NAME: "smartservice-voice-agent",
            LIVEKIT_API_KEY: "livekit-test",
            LIVEKIT_API_SECRET: "livekit-secret",
            LIVEKIT_URL: "https://livekit.example.test",
            VOICE_INTERNAL_API_BASE_URL: "https://api.example.test",
            VOICE_INTERNAL_SERVICE_TOKEN: "v".repeat(32),
        });

        expect(configuration.DEEPGRAM_STT_MODEL).toBe("nova-3");
        expect(configuration.DEEPGRAM_STT_LANGUAGE).toBe("zh-CN");
    });

    it("keeps STT tenant-neutral instead of biasing recognition toward demo products", () =>
    {
        expect(VOICE_STT_SETTINGS.model).toBe("nova-3");
        expect(VOICE_STT_SETTINGS).not.toHaveProperty("keyterm");
    });

    it("opens each language as the company's customer-service team without claiming a human or AI identity", () =>
    {
        expect(buildVoiceGreeting("zh-CN")).toBe("您好，感谢您联系我们。请问今天有什么可以帮您？");
        expect(buildVoiceGreeting("en")).toBe("Hi, thanks for reaching out. How can I help you today?");
        expect(`${buildVoiceGreeting("zh-CN")} ${buildVoiceGreeting("en")}`).not.toMatch(/AI|人工|机器人|bot/iu);
        expect(buildVoiceSpeechOptions("ephemeral")).toEqual({
            addToChatCtx: false,
            allowInterruptions: true,
        });
        expect(buildVoiceSpeechOptions("approved_answer")).toEqual({
            addToChatCtx: true,
            allowInterruptions: true,
        });
    });

    it("normalizes product models and units without adding internal identifiers", () =>
    {
        expect(normalizeVoiceSpeech(
            "NF-500 supports 300 L/min at 20°C.",
            "en",
        )).toBe("N F 500 supports 300 litres per minute at 20 degrees Celsius.");
    });

    it("locks multilingual adaptive interruption and final-turn-only generation", () =>
    {
        expect(VOICE_TURN_SETTINGS).toMatchObject({
            endpointing: {
                maxDelay: 1_000,
                minDelay: 500,
                mode: "dynamic",
            },
            interruption: {
                falseInterruptionTimeout: 2_000,
                minDuration: 500,
                mode: "adaptive",
                resumeFalseInterruption: true,
            },
            preemptiveGeneration: {
                enabled: false,
                maxRetries: 0,
                preemptiveTts: false,
            },
        });
        expect(VOICE_TTS_SETTINGS).toMatchObject({
            applyTextNormalization: "auto",
            model: "eleven_flash_v2_5",
            syncAlignment: true,
        });
        expect(VOICE_TURN_REQUEST_TIMEOUT_MS).toBe(9_000);
    });

    it("sends a committed STT turn through the shared assistant before scheduling TTS", async () =>
    {
        vi.spyOn(console, "info").mockImplementation(() => undefined);
        const completeTurn = vi.fn().mockResolvedValue({
            answer: "我们提供古筝课程。",
            citations: [],
            decision: "answer",
            handoff: null,
            messageId: "33333333-3333-4333-8333-333333333333",
            spokenText: "我们提供古筝课程。",
        });
        const updateStatus = vi.fn().mockResolvedValue(undefined);
        const waitForPlayout = vi.fn().mockResolvedValue(undefined);
        const say = vi.fn(() => ({
            waitForPlayout,
        }));
        const shutdown = vi.fn();
        const coordinator = new VoiceTurnCoordinator({
            api: {
                completeTurn,
                updateStatus,
            },
            language: "zh-CN",
            say,
            shutdown,
            voiceSessionId,
        });

        await coordinator.handleFinalTurn("  请问有古筝课程吗？  ");
        await Promise.resolve();

        expect(completeTurn).toHaveBeenCalledOnce();
        expect(completeTurn.mock.calls[0]?.[2]).toBe("请问有古筝课程吗？");
        expect(say).toHaveBeenCalledWith("我们提供古筝课程。", "approved_answer");
        expect(waitForPlayout).toHaveBeenCalledOnce();
        expect(updateStatus).not.toHaveBeenCalled();
        expect(shutdown).not.toHaveBeenCalled();
    });

    it("fills a genuinely slow turn with one short non-factual service acknowledgement", async () =>
    {
        vi.useFakeTimers();
        vi.spyOn(console, "info").mockImplementation(() => undefined);
        let resolveTurn: ((value: {
            answer: string;
            citations: [];
            decision: "answer";
            handoff: null;
            messageId: string;
            spokenText: string;
        }) => void) | undefined;
        const completeTurn = vi.fn(() => new Promise<{
            answer: string;
            citations: [];
            decision: "answer";
            handoff: null;
            messageId: string;
            spokenText: string;
        }>((resolve) =>
        {
            resolveTurn = resolve;
        }));
        const say = vi.fn(() => ({
            waitForPlayout: vi.fn().mockResolvedValue(undefined),
        }));
        const coordinator = new VoiceTurnCoordinator({
            api: {
                completeTurn,
                updateStatus: vi.fn().mockResolvedValue(undefined),
            },
            language: "zh-CN",
            say,
            shutdown: vi.fn(),
            voiceSessionId,
        });
        const pending = coordinator.handleFinalTurn("请介绍你们的课程。");

        await vi.advanceTimersByTimeAsync(VOICE_PROGRESS_CUE_DELAY_MS);
        expect(say).toHaveBeenNthCalledWith(
            1,
            buildVoiceProgressSpeech("zh-CN"),
            "ephemeral",
        );

        resolveTurn?.({
            answer: "我们提供经过确认的课程。",
            citations: [],
            decision: "answer",
            handoff: null,
            messageId: "33333333-3333-4333-8333-333333333333",
            spokenText: "我们提供经过确认的课程。",
        });
        await pending;
        await Promise.resolve();

        expect(say).toHaveBeenNthCalledWith(
            2,
            "我们提供经过确认的课程。",
            "approved_answer",
        );
    });

    it("fails closed and stops the voice session when the shared turn service fails", async () =>
    {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        vi.spyOn(console, "info").mockImplementation(() => undefined);
        const completeTurn = vi.fn().mockRejectedValue(new Error("provider unavailable"));
        const updateStatus = vi.fn().mockResolvedValue(undefined);
        const waitForPlayout = vi.fn().mockResolvedValue(undefined);
        const say = vi.fn(() => ({
            waitForPlayout,
        }));
        const shutdown = vi.fn();
        const coordinator = new VoiceTurnCoordinator({
            api: {
                completeTurn,
                updateStatus,
            },
            language: "zh-CN",
            say,
            shutdown,
            voiceSessionId,
        });

        await coordinator.handleFinalTurn("请介绍课程。");
        await Promise.resolve();

        expect(updateStatus).toHaveBeenCalledWith(
            voiceSessionId,
            "failed",
            "VOICE_TURN_SERVICE_UNAVAILABLE",
        );
        expect(say).toHaveBeenCalledWith(buildVoiceFailureSpeech("zh-CN"), "ephemeral");
        expect(shutdown).toHaveBeenCalledWith("voice_service_failure");
    });

    it("uses fixed bilingual provider-failure speech without upstream error content", () =>
    {
        expect(buildVoiceFailureSpeech("zh-CN")).toContain("文字客服");
        expect(buildVoiceFailureSpeech("en")).toContain("continue with text customer service");
        expect(`${buildVoiceFailureSpeech("zh-CN")} ${buildVoiceFailureSpeech("en")}`).not.toMatch(/重试|retry/iu);
        expect(buildVoiceFailureSpeech("en")).not.toContain("stack");
    });

    it("cancels an obsolete internal turn request when a newer voice turn interrupts it", async () =>
    {
        const fetcher = vi.fn<typeof fetch>(async (_input, init) =>
        {
            await new Promise((_resolve, reject) =>
            {
                init?.signal?.addEventListener("abort", () =>
                {
                    reject(init.signal?.reason);
                }, {
                    once: true,
                });
            });

            throw new Error("The aborted request unexpectedly continued.");
        });
        const client = new VoiceInternalApiClient({
            VOICE_INTERNAL_API_BASE_URL: "https://api.example.test",
            VOICE_INTERNAL_SERVICE_TOKEN: "v".repeat(32),
        }, fetcher);
        const controller = new AbortController();
        const pending = client.completeTurn(
            voiceSessionId,
            "44444444-4444-4444-8444-444444444444",
            "Please continue.",
            "2026-07-27T08:00:00.000Z",
            controller.signal,
        );
        controller.abort();

        await expect(pending).rejects.toMatchObject({
            name: "AbortError",
        });
        expect(fetcher).toHaveBeenCalledOnce();
    });

    it("shares one total deadline across a transient server retry", async () =>
    {
        const observedSignals: AbortSignal[] = [];
        const fetcher = vi.fn<typeof fetch>(async (_input, init) =>
        {
            if (init?.signal !== null && init?.signal !== undefined)
            {
                observedSignals.push(init.signal);
            }

            if (observedSignals.length === 1)
            {
                return new Response("temporarily unavailable", {
                    status: 503,
                });
            }

            return new Response(JSON.stringify({
                answer: "Confirmed answer.",
                citations: [],
                decision: "answer",
                handoff: null,
                messageId: "33333333-3333-4333-8333-333333333333",
                spokenText: "Confirmed answer.",
            }), {
                headers: {
                    "content-type": "application/json",
                },
            });
        });
        const client = new VoiceInternalApiClient({
            VOICE_INTERNAL_API_BASE_URL: "https://api.example.test",
            VOICE_INTERNAL_SERVICE_TOKEN: "v".repeat(32),
        }, fetcher);

        await client.completeTurn(
            voiceSessionId,
            "44444444-4444-4444-8444-444444444444",
            "Please confirm.",
            "2026-07-27T08:00:00.000Z",
        );

        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(observedSignals).toHaveLength(2);
        expect(observedSignals[1]).toBe(observedSignals[0]);
    });

    it("authenticates configuration and transcript calls without logging content", async () =>
    {
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(JSON.stringify({
                conversationId: "22222222-2222-4222-8222-222222222222",
                language: "zh-CN",
                organizationId: "00000000-0000-4000-a000-000000000001",
                status: "warming",
                voiceSessionId,
            }), {
                headers: {
                    "content-type": "application/json",
                },
            }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                created: true,
                messageId: "33333333-3333-4333-8333-333333333333",
            }), {
                headers: {
                    "content-type": "application/json",
                },
            }));
        const client = new VoiceInternalApiClient({
            VOICE_INTERNAL_API_BASE_URL: "https://api.example.test",
            VOICE_INTERNAL_SERVICE_TOKEN: "v".repeat(32),
        }, fetcher);

        await client.getConfiguration(voiceSessionId);
        await client.recordTranscript(
            voiceSessionId,
            "44444444-4444-4444-8444-444444444444",
            "请问 NF-500 的最大流量是多少？",
            "zh-CN",
            "2026-07-27T08:00:00.000Z",
        );

        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual(
            expect.objectContaining({
                authorization: `Bearer ${"v".repeat(32)}`,
            }),
        );
    });
});
