import { describe, expect, it, vi } from "vitest";

import { readVoiceAgentConfiguration } from "./config";
import { normalizeVoiceSpeech } from "./agent";
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
