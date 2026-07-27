import {
    cleanup,
    render,
    screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import type {
    VoiceRoomCallbacks,
    VoiceRoomConnector,
} from "./lib/voice-room";
import { VoiceExperience } from "./voice-experience";

const conversationId = "20000000-0000-4000-a000-000000000001";
const voiceSessionId = "60000000-0000-4000-a000-000000000001";

afterEach(() =>
{
    cleanup();
    vi.unstubAllGlobals();
});

/**
 * createFetchMock
 * ----------------
 * Creates the two-call voice startup fixture and rejects any request outside the explicit click flow.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
function createFetchMock(
    includeAnswer = false,
): ReturnType<typeof vi.fn<typeof fetch>>
{
    return vi.fn<typeof fetch>(async (input) =>
    {
        const url = String(input);

        if (url.endsWith("/api/v1/public/conversations"))
        {
            return new Response(JSON.stringify({
                conversationId,
                conversationToken: "x".repeat(32),
                displayName: "NovaFlow",
                expiresAt: "2099-07-27T08:00:00.000Z",
                welcomeMessage: "您好，欢迎联系 NovaFlow。",
            }), {
                headers: {
                    "content-type": "application/json",
                },
                status: 201,
            });
        }

        if (url.endsWith("/api/v1/public/voice/token"))
        {
            return new Response(JSON.stringify({
                agentName: "smartservice-voice-agent",
                expiresAt: "2099-07-27T08:10:00.000Z",
                provider: "mock",
                roomName: `ss-demo-${conversationId}`,
                token: "mock.local-token.signature",
                url: "https://mock-livekit.smartservice.local",
                voiceSessionId,
            }), {
                headers: {
                    "content-type": "application/json",
                },
                status: 201,
            });
        }

        if (url.includes(`/api/v1/public/conversations/${conversationId}/messages`))
        {
            if (includeAnswer)
            {
                return new Response(JSON.stringify({
                    messages: [{
                        citations: [{
                            citationId: "50000000-0000-4000-a000-000000000001",
                            label: "NF-Series Product Manual, p. 4",
                            sourceType: "pdf",
                            sourceUrl: null,
                            supportingExcerpt: "Maximum flow | 300 litres per minute",
                        }],
                        createdAt: "2026-07-27T08:00:00.000Z",
                        decision: "answer",
                        messageId: "30000000-0000-4000-a000-000000000001",
                        senderType: "ai",
                        text: "NF-500 的最大流量是每分钟 300 升。",
                    }],
                    nextCursor: "voice-answer-cursor",
                    status: "active_ai",
                }), {
                    headers: {
                        "content-type": "application/json",
                        etag: 'W/"voice-answer"',
                    },
                    status: 200,
                });
            }

            return new Response(null, {
                headers: {
                    etag: 'W/"voice-fixture"',
                },
                status: 304,
            });
        }

        throw new Error(`Unexpected request: ${url}`);
    });
}

describe("VoiceExperience", () =>
{
    it("shows the approved answer citation on screen without adding it to transcript text", async () =>
    {
        const fetchMock = createFetchMock(true);
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();
        render(
            <VoiceExperience
                requestMicrophone={vi.fn(async () => undefined)}
            />,
        );

        await user.click(screen.getByRole("button", { name: "Start voice" }));

        expect(await screen.findByText("NF-500 的最大流量是每分钟 300 升。")).toBeInTheDocument();
        expect(screen.getByText("NF-Series Product Manual, p. 4")).toBeInTheDocument();
        expect(screen.getByText(
            "Your transcript will appear here after you speak.",
        )).toBeInTheDocument();
    });

    it("creates no session before click and requests microphone only after Ready", async () =>
    {
        const fetchMock = createFetchMock();
        const requestMicrophone = vi.fn(async () => undefined);
        const connector: VoiceRoomConnector = {
            /**
             * connect
             * ----------------
             * Holds the fixture in warming until the test explicitly emits Ready.
             *
             * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
             */
            async connect(_token, callbacks)
            {
                expect(requestMicrophone).not.toHaveBeenCalled();
                await callbacks.onReady();
                callbacks.onTranscript("请问 NF-500 的最大流量是多少？", true);
                return {
                    /**
                     * disconnect
                     * ----------------
                     * Completes the fixture connection without external media.
                     *
                     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
                     */
                    async disconnect()
                    {
                        callbacks.onDisconnected();
                    },
                };
            },
        };
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();
        render(
            <VoiceExperience
                connector={connector}
                requestMicrophone={requestMicrophone}
            />,
        );

        expect(fetchMock).not.toHaveBeenCalled();
        await user.click(screen.getByRole("button", { name: "Start voice" }));

        expect(await screen.findByText(/Listening now/u)).toBeInTheDocument();
        expect(requestMicrophone).toHaveBeenCalledOnce();
        expect(screen.getByText("请问 NF-500 的最大流量是多少？")).toBeInTheDocument();
    });

    it("shows a friendly text fallback when microphone access is denied", async () =>
    {
        const fetchMock = createFetchMock();
        let callbacks: VoiceRoomCallbacks | null = null;
        const connector: VoiceRoomConnector = {
            /**
             * connect
             * ----------------
             * Emits Ready immediately so the rejected permission fixture exercises the denial state.
             *
             * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
             */
            async connect(_token, receivedCallbacks)
            {
                callbacks = receivedCallbacks;
                await receivedCallbacks.onReady();
                return {
                    /**
                     * disconnect
                     * ----------------
                     * Ends the permission-denial fixture without media resources.
                     *
                     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
                     */
                    async disconnect()
                    {
                        callbacks?.onDisconnected();
                    },
                };
            },
        };
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();
        render(
            <VoiceExperience
                connector={connector}
                requestMicrophone={vi.fn(async () => Promise.reject(new Error("denied")))}
            />,
        );

        await user.click(screen.getByRole("button", { name: "Start voice" }));

        expect(await screen.findByText(/Microphone access was denied/u)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Continue by text" })).toHaveAttribute("href", "/chat");
    });
});
