import {
    cleanup,
    render,
    screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import { mergeChatMessages } from "./lib/public-chat-messages";
import { PublicChat } from "./public-chat";

const conversationId = "20000000-0000-4000-a000-000000000001";
const freshConversationId = "20000000-0000-4000-a000-000000000002";
const messageId = "30000000-0000-4000-a000-000000000001";
const citationId = "50000000-0000-4000-a000-000000000001";

/**
 * createDeferredResponse
 * ----------------
 * Creates a test-controlled response promise so the pending-composer state can be asserted before the simulated server reply resolves.
 *
 * August 06, 2026: Created by Forrest Zhang for Admissions Owner Voice Policy
 */
function createDeferredResponse(): {
    promise: Promise<Response>;
    resolve: (response: Response) => void;
}
{
    let resolve!: (response: Response) => void;
    const promise = new Promise<Response>((nextResolve) =>
    {
        resolve = nextResolve;
    });

    return {
        promise,
        resolve,
    };
}

beforeEach(() =>
{
    sessionStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("PublicChat", () =>
{
    it("deduplicates a persisted AI message received from polling and send completion", () =>
    {
        const message = {
            citations: [],
            id: messageId,
            sender: "ai" as const,
            text: "We offer approved music courses.",
        };

        expect(mergeChatMessages([message], [message])).toEqual([message]);
        expect(mergeChatMessages([], [message, message])).toEqual([message]);
    });

    it("starts a scoped session, sends a bilingual question, and opens its evidence excerpt", async () =>
    {
        const fetchMock = vi.fn(async (
            input: RequestInfo | URL,
            init?: RequestInit,
        ): Promise<Response> =>
        {
            const url = String(input);

            if (url.endsWith("/api/v1/public/conversations"))
            {
                return new Response(JSON.stringify({
                    conversationId,
                    conversationToken: "x".repeat(32),
                    displayName: "Smart Service",
                    expiresAt: "2099-07-26T22:00:00.000Z",
                    welcomeMessage: "Hello! You’ve reached Smart Service Admissions. How can I help with courses, enrolment, or the school?",
                }), {
                    headers: {
                        "content-type": "application/json",
                    },
                    status: 201,
                });
            }

            if (url.includes(`/conversations/${conversationId}/messages`) && init?.method === "POST")
            {
                return new Response(JSON.stringify({
                    answer: "NF-500 的有限保修期是 36 months。",
                    citations: [{
                        citationId,
                        label: "NF-Series Product Manual, p. 4",
                        sourceType: "pdf",
                        sourceUrl: null,
                        supportingExcerpt: "NF-500 limited warranty: 36 months from shipment date.",
                    }],
                    decision: "answer",
                    handoff: null,
                    messageId,
                }), {
                    headers: {
                        "content-type": "application/json",
                    },
                    status: 200,
                });
            }

            if (url.includes(`/conversations/${conversationId}/messages`))
            {
                return new Response(null, {
                    headers: {
                        etag: 'W/"fixture"',
                    },
                    status: 304,
                });
            }

            throw new Error(`Unexpected fixture request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();
        render(<PublicChat />);

        await screen.findByText("Local demo verification is ready.");
        expect(screen.queryByRole("button", { name: /Ask an admissions manager/u }))
            .not.toBeInTheDocument();
        await user.type(
            screen.getByLabelText(/Ask Smart Service Admissions/u),
            "NF-500 的保修期多久？",
        );
        await user.click(screen.getByRole("button", { name: /Send message/u }));

        expect(await screen.findByText(/36 months/u)).toBeInTheDocument();
        await user.click(screen.getByRole("button", {
            name: /Source 1.*NF-Series Product Manual/u,
        }));
        expect(screen.getByText(
            "NF-500 limited warranty: 36 months from shipment date.",
        )).toBeInTheDocument();
        expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("chunkId");
    });

    it("clears and locks the composer while a school answer is being confirmed", async () =>
    {
        const pendingMessage = createDeferredResponse();
        const fetchMock = vi.fn(async (
            input: RequestInfo | URL,
            init?: RequestInit,
        ): Promise<Response> =>
        {
            const url = String(input);

            if (url.endsWith("/api/v1/public/conversations"))
            {
                return new Response(JSON.stringify({
                    conversationId,
                    conversationToken: "x".repeat(32),
                    displayName: "Smart Service",
                    expiresAt: "2099-07-26T22:00:00.000Z",
                    welcomeMessage: "Hello! You’ve reached Smart Service Admissions. How can I help with courses, enrolment, or the school?",
                }), {
                    headers: {
                        "content-type": "application/json",
                    },
                    status: 201,
                });
            }

            if (url.includes(`/conversations/${conversationId}/messages`) && init?.method === "POST")
            {
                return pendingMessage.promise;
            }

            if (url.includes(`/conversations/${conversationId}/messages`))
            {
                return new Response(null, {
                    headers: {
                        etag: 'W/"fixture"',
                    },
                    status: 304,
                });
            }

            throw new Error(`Unexpected fixture request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();
        render(<PublicChat />);

        const composer = screen.getByLabelText(/Ask Smart Service Admissions/u);
        await user.type(composer, "Can I study online?");
        await user.click(screen.getByRole("button", { name: /Send message/u }));

        expect(composer).toHaveValue("");
        expect(composer).toBeDisabled();
        expect(composer).toHaveAttribute("aria-busy", "true");
        expect(screen.getByRole("status")).toHaveTextContent("Confirming that for you…");

        pendingMessage.resolve(new Response(JSON.stringify({
            answer: "I cannot confirm the online teaching mode yet.",
            citations: [],
            decision: "clarify",
            handoff: null,
            messageId,
        }), {
            headers: {
                "content-type": "application/json",
            },
            status: 200,
        }));

        expect(await screen.findByText("I cannot confirm the online teaching mode yet."))
            .toBeInTheDocument();
        expect(composer).toBeEnabled();
    });

    it("offers admissions-manager follow-up after the first incomplete answer and transfers only after the customer selects it", async () =>
    {
        let clarificationCount = 0;
        const fetchMock = vi.fn(async (
            input: RequestInfo | URL,
            init?: RequestInit,
        ): Promise<Response> =>
        {
            const url = String(input);

            if (url.endsWith("/api/v1/public/conversations"))
            {
                return new Response(JSON.stringify({
                    conversationId,
                    conversationToken: "x".repeat(32),
                    displayName: "Smart Service",
                    expiresAt: "2099-07-26T22:00:00.000Z",
                    welcomeMessage: "Hello! You’ve reached Smart Service Admissions. How can I help with courses, enrolment, or the school?",
                }), {
                    headers: {
                        "content-type": "application/json",
                    },
                    status: 201,
                });
            }

            if (url.endsWith("/request-handoff"))
            {
                return new Response(JSON.stringify({
                    handoff: {
                        reason: "customer_requested",
                        status: "handoff_requested",
                    },
                    messageId: "30000000-0000-4000-a000-000000000099",
                }), {
                    headers: {
                        "content-type": "application/json",
                    },
                    status: 202,
                });
            }

            if (url.includes(`/conversations/${conversationId}/messages`) && init?.method === "POST")
            {
                clarificationCount += 1;
                return new Response(JSON.stringify({
                    answer: `Clarification ${clarificationCount}`,
                    citations: [],
                    decision: "clarify",
                    handoff: null,
                    messageId: `30000000-0000-4000-a000-${String(clarificationCount).padStart(12, "0")}`,
                }), {
                    headers: {
                        "content-type": "application/json",
                    },
                    status: 200,
                });
            }

            if (url.includes(`/conversations/${conversationId}/messages`))
            {
                return new Response(null, {
                    headers: {
                        etag: 'W/"fixture"',
                    },
                    status: 304,
                });
            }

            throw new Error(`Unexpected fixture request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();
        render(<PublicChat />);

        await screen.findByText("Local demo verification is ready.");
        await user.type(screen.getByLabelText(/Ask Smart Service Admissions/u), "First unclear question");
        await user.click(screen.getByRole("button", { name: /Send message/u }));
        await screen.findByText("Clarification 1");
        expect(screen.getByRole("button", { name: /Ask an admissions manager/u }))
            .toBeInTheDocument();
        expect(screen.queryByText("Waiting for an admissions manager"))
            .not.toBeInTheDocument();
        expect(fetchMock.mock.calls.filter(([request]) => String(request).endsWith("/request-handoff")))
            .toHaveLength(0);

        await user.click(screen.getByRole("button", { name: /Ask an admissions manager/u }));
        expect(await screen.findByText("Your request has been sent to an admissions manager, who will continue with your enquiry."))
            .toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Ask an admissions manager/u }))
            .not.toBeInTheDocument();
    });

    it("keeps customer messaging open while waiting for an unclaimed human handoff", async () =>
    {
        sessionStorage.setItem("smartservice.publicConversation.v1", JSON.stringify({
            conversationId,
            conversationToken: "x".repeat(32),
            displayName: "Smart Service",
            expiresAt: "2099-07-26T22:00:00.000Z",
            welcomeMessage: "Hello! You’ve reached Smart Service Admissions. How can I help with courses, enrolment, or the school?",
        }));
        const fetchMock = vi.fn(async (
            input: RequestInfo | URL,
            init?: RequestInit,
        ): Promise<Response> =>
        {
            const url = String(input);

            if (url.includes(`/conversations/${conversationId}/messages`) && init?.method === "POST")
            {
                return new Response(JSON.stringify({
                    answer: "Your update has been sent to the admissions manager.",
                    citations: [],
                    decision: "human",
                    handoff: null,
                    messageId: "30000000-0000-4000-a000-000000000088",
                }), {
                    headers: {
                        "content-type": "application/json",
                    },
                    status: 200,
                });
            }

            if (url.includes(`/conversations/${conversationId}/messages`))
            {
                return new Response(JSON.stringify({
                    messages: [],
                    nextCursor: null,
                    status: "handoff_requested",
                }), {
                    headers: {
                        "content-type": "application/json",
                        etag: 'W/"pending-handoff"',
                    },
                    status: 200,
                });
            }

            throw new Error(`Unexpected fixture request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();
        render(<PublicChat />);

        expect(await screen.findByText("Waiting for an admissions manager"))
            .toBeInTheDocument();
        const composer = screen.getByLabelText(/Ask Smart Service Admissions/u);
        expect(composer).toBeEnabled();

        await user.type(composer, "I can share my preferred model.");
        await user.click(screen.getByRole("button", { name: /Send message/u }));

        expect(await screen.findByText("I can share my preferred model."))
            .toBeInTheDocument();
        expect(screen.queryByText("Admissions manager connected"))
            .not.toBeInTheDocument();
        expect(screen.queryByText("Your update has been sent to the admissions manager."))
            .not.toBeInTheDocument();
    });

    it("starts a fresh conversation from restored handoff history without deleting the retained conversation", async () =>
    {
        sessionStorage.setItem("smartservice.publicConversation.v1", JSON.stringify({
            conversationId,
            conversationToken: "x".repeat(32),
            displayName: "Smart Service",
            expiresAt: "2099-07-26T22:00:00.000Z",
            welcomeMessage: "Hello! You’ve reached Smart Service Admissions. How can I help with courses, enrolment, or the school?",
        }));
        const confirmMock = vi.fn()
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);
        vi.stubGlobal("confirm", confirmMock);
        const fetchMock = vi.fn(async (
            input: RequestInfo | URL,
            init?: RequestInit,
        ): Promise<Response> =>
        {
            const url = String(input);

            if (url.endsWith("/api/v1/public/conversations"))
            {
                return new Response(JSON.stringify({
                    conversationId: freshConversationId,
                    conversationToken: "y".repeat(32),
                    displayName: "Smart Service",
                    expiresAt: "2099-07-26T23:00:00.000Z",
                    welcomeMessage: "Hello! You’ve reached Smart Service Admissions. How can I help with courses, enrolment, or the school?",
                }), {
                    headers: {
                        "content-type": "application/json",
                    },
                    status: 201,
                });
            }

            if (
                url.includes(`/conversations/${freshConversationId}/messages`)
                && init?.method === "POST"
            )
            {
                return new Response(JSON.stringify({
                    answer: "This is a fresh admissions conversation.",
                    citations: [],
                    decision: "clarify",
                    handoff: null,
                    messageId: "30000000-0000-4000-a000-000000000077",
                }), {
                    headers: {
                        "content-type": "application/json",
                    },
                    status: 200,
                });
            }

            if (url.includes(`/conversations/${freshConversationId}/messages`))
            {
                return new Response(null, {
                    headers: {
                        etag: 'W/"fresh-conversation"',
                    },
                    status: 304,
                });
            }

            if (url.includes(`/conversations/${conversationId}/messages`))
            {
                return new Response(JSON.stringify({
                    messages: [],
                    nextCursor: null,
                    status: "handoff_requested",
                }), {
                    headers: {
                        "content-type": "application/json",
                        etag: 'W/"pending-handoff"',
                    },
                    status: 200,
                });
            }

            throw new Error(`Unexpected fixture request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();
        render(<PublicChat />);

        expect(await screen.findByText("Waiting for an admissions manager"))
            .toBeInTheDocument();
        const newConversation = screen.getByRole("button", { name: "New conversation" });

        await user.click(newConversation);
        expect(confirmMock).toHaveBeenCalledWith(
            "Start a new conversation? This conversation will remain available to support, but it will no longer appear in this browser tab.",
        );
        expect(sessionStorage.getItem("smartservice.publicConversation.v1"))
            .not.toBeNull();
        expect(screen.getByText("Waiting for an admissions manager"))
            .toBeInTheDocument();

        await user.click(newConversation);
        expect(await screen.findByText("Local demo verification is ready."))
            .toBeInTheDocument();
        expect(sessionStorage.getItem("smartservice.publicConversation.v1"))
            .toBeNull();
        expect(screen.queryByText("Waiting for an admissions manager"))
            .not.toBeInTheDocument();

        await user.type(
            screen.getByLabelText(/Ask Smart Service Admissions/u),
            "Start fresh",
        );
        await user.click(screen.getByRole("button", { name: /Send message/u }));

        expect(await screen.findByText("This is a fresh admissions conversation."))
            .toBeInTheDocument();
        expect(JSON.parse(
            sessionStorage.getItem("smartservice.publicConversation.v1") ?? "{}",
        )).toMatchObject({
            conversationId: freshConversationId,
        });
        expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"))
            .toBe(false);
    });
});
