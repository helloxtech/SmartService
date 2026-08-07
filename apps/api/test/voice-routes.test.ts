import {
    createVoiceTokenResponseSchema,
    endVoiceSessionResponseSchema,
} from "@smartservice/contracts";
import {
    describe,
    expect,
    it,
    vi,
} from "vitest";

import { createApp } from "../src/app";
import { buildVoiceSpokenText } from "../src/voice-service";
import type {
    RuntimeServices,
    SmartServiceBindings,
    VoiceService,
} from "../src/types";

const conversationId = "20000000-0000-4000-a000-000000000001";
const voiceSessionId = "60000000-0000-4000-a000-000000000001";

/**
 * createVoiceService
 * ----------------
 * Creates a zero-network voice-service double for public and internal route contract tests.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
function createVoiceService(): VoiceService
{
    return {
        completeTurn: vi.fn().mockResolvedValue({
            answer: "NF-500 的最大流量是每分钟 300 升。",
            citations: [],
            decision: "answer",
            handoff: null,
            messageId: "30000000-0000-4000-a000-000000000001",
            spokenText: "NF-500 的最大流量是每分钟 300 升。",
        }),
        createToken: vi.fn().mockResolvedValue({
            agentName: "smartservice-voice-agent",
            expiresAt: "2099-07-27T08:10:00.000Z",
            provider: "mock",
            roomName: "ss-day6-fixture",
            token: "mock.local-token.signature",
            url: "https://mock-livekit.smartservice.local",
            voiceSessionId,
        }),
        endSession: vi.fn().mockResolvedValue({
            status: "closed",
            voiceSessionId,
        }),
        getConfiguration: vi.fn().mockResolvedValue({
            conversationId,
            language: "zh-CN",
            organizationId: "00000000-0000-4000-a000-000000000001",
            status: "warming",
            voiceSessionId,
        }),
        recordTranscript: vi.fn().mockResolvedValue({
            created: true,
            messageId: "30000000-0000-4000-a000-000000000001",
        }),
        updateStatus: vi.fn().mockResolvedValue(undefined),
    };
}

/**
 * requestVoiceApp
 * ----------------
 * Dispatches one request through the Worker with only the isolated voice double reachable.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
async function requestVoiceApp(
    voiceService: VoiceService,
    path: string,
    init?: RequestInit,
): Promise<Response>
{
    const app = createApp(() => ({
        voice: voiceService,
    } as RuntimeServices));

    return app.request(
        `https://smartservice.test${path}`,
        init,
        {} as SmartServiceBindings,
    );
}

describe("voice routes", () =>
{
    it("limits spoken output and removes URLs, UUIDs, and JSON delimiters", () =>
    {
        const spoken = buildVoiceSpokenText(
            "NF-500 details are documented at https://example.test/source. Reference 30000000-0000-4000-a000-000000000001. {\"internal\":true} Third sentence must be omitted.",
            "en",
        );

        expect(spoken).not.toMatch(/https?:|30000000|\{|\}/u);
        expect(spoken).not.toContain("Third sentence");
    });

    it("issues a no-store short-lived room token from a validated conversation ID", async () =>
    {
        const voice = createVoiceService();
        const response = await requestVoiceApp(
            voice,
            "/api/v1/public/voice/token",
            {
                body: JSON.stringify({
                    conversationId,
                }),
                headers: {
                    authorization: "Bearer fixture-conversation-token",
                    "content-type": "application/json",
                },
                method: "POST",
            },
        );
        const payload: unknown = await response.json();

        expect(response.status).toBe(201);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(createVoiceTokenResponseSchema.parse(payload).voiceSessionId)
            .toBe(voiceSessionId);
    });

    it("validates internal status input before the service boundary", async () =>
    {
        const voice = createVoiceService();
        const response = await requestVoiceApp(
            voice,
            `/api/v1/internal/voice/sessions/${voiceSessionId}/status`,
            {
                body: JSON.stringify({
                    errorCode: null,
                    status: "not-a-state",
                }),
                headers: {
                    authorization: "Bearer internal-fixture-token",
                    "content-type": "application/json",
                },
                method: "POST",
            },
        );

        expect(response.status).toBe(422);
        expect(voice.updateStatus).not.toHaveBeenCalled();
    });

    it("persists a customer-ended voice session through the public bearer-scoped route", async () =>
    {
        const voice = createVoiceService();
        const response = await requestVoiceApp(
            voice,
            `/api/v1/public/voice/sessions/${voiceSessionId}/end`,
            {
                body: JSON.stringify({
                    conversationId,
                }),
                headers: {
                    authorization: "Bearer fixture-conversation-token",
                    "content-type": "application/json",
                },
                method: "POST",
            },
        );
        const payload: unknown = await response.json();

        expect(response.status).toBe(200);
        expect(endVoiceSessionResponseSchema.parse(payload).status).toBe("closed");
        expect(voice.endSession).toHaveBeenCalledOnce();
    });
});
