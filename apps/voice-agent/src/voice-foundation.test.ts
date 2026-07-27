import { describe, expect, it, vi } from "vitest";

import { readVoiceAgentConfiguration } from "./config";
import {
    buildVoiceFailureSpeech,
    normalizeVoiceSpeech,
    VOICE_TURN_SETTINGS,
} from "./agent";
import { VoiceInternalApiClient } from "./internal-api";
import { readVoiceSessionId } from "./metadata";

const voiceSessionId = "11111111-1111-4111-8111-111111111111";

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

    it("normalizes product models and units without adding internal identifiers", () =>
    {
        expect(normalizeVoiceSpeech(
            "NF-500 supports 300 L/min at 20°C.",
            "en",
        )).toBe("N F 500 supports 300 litres per minute at 20 degrees Celsius.");
    });

    it("locks multilingual adaptive interruption and guardrail-safe preemptive generation", () =>
    {
        expect(VOICE_TURN_SETTINGS).toMatchObject({
            endpointing: {
                maxDelay: 1_500,
                minDelay: 300,
                mode: "dynamic",
            },
            interruption: {
                falseInterruptionTimeout: 2_000,
                minDuration: 500,
                mode: "adaptive",
                resumeFalseInterruption: true,
            },
            preemptiveGeneration: {
                enabled: true,
                preemptiveTts: false,
            },
        });
    });

    it("uses fixed bilingual provider-failure speech without upstream error content", () =>
    {
        expect(buildVoiceFailureSpeech("zh-CN")).toContain("文字客服");
        expect(buildVoiceFailureSpeech("en")).toContain("continue by text");
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
