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

import { PublicChat } from "./public-chat";

const conversationId = "20000000-0000-4000-a000-000000000001";
const messageId = "30000000-0000-4000-a000-000000000001";
const citationId = "50000000-0000-4000-a000-000000000001";

beforeEach(() =>
{
    sessionStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() =>
{
    cleanup();
    vi.unstubAllGlobals();
});

describe("PublicChat", () =>
{
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
                    displayName: "XFlow",
                    expiresAt: "2099-07-26T22:00:00.000Z",
                    welcomeMessage: "您好，欢迎联系 XFlow。",
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
        expect(screen.queryByRole("button", { name: /Need human help/u }))
            .not.toBeInTheDocument();
        await user.type(
            screen.getByLabelText(/Ask XFlow support/u),
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

    it("offers human help only after repeated clarification and completes the requested handoff", async () =>
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
                    displayName: "XFlow",
                    expiresAt: "2099-07-26T22:00:00.000Z",
                    welcomeMessage: "您好，欢迎联系 XFlow。",
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
        await user.type(screen.getByLabelText(/Ask XFlow support/u), "First unclear question");
        await user.click(screen.getByRole("button", { name: /Send message/u }));
        await screen.findByText("Clarification 1");
        expect(screen.queryByRole("button", { name: /Need human help/u }))
            .not.toBeInTheDocument();

        await user.type(screen.getByLabelText(/Ask XFlow support/u), "Second unclear question");
        await user.click(screen.getByRole("button", { name: /Send message/u }));
        await screen.findByText("Clarification 2");

        await user.click(screen.getByRole("button", { name: /Need human help/u }));
        expect(await screen.findByText("Your request was received. A human support specialist will take over this conversation."))
            .toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Need human help/u }))
            .not.toBeInTheDocument();
    });

    it("keeps customer messaging open while waiting for an unclaimed human handoff", async () =>
    {
        sessionStorage.setItem("smartservice.publicConversation.v1", JSON.stringify({
            conversationId,
            conversationToken: "x".repeat(32),
            displayName: "XFlow",
            expiresAt: "2099-07-26T22:00:00.000Z",
            welcomeMessage: "您好，欢迎联系 XFlow。",
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
                    answer: "Your update has been sent to human support.",
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

        expect(await screen.findByText("Waiting for human support"))
            .toBeInTheDocument();
        const composer = screen.getByLabelText(/Ask XFlow support/u);
        expect(composer).toBeEnabled();

        await user.type(composer, "I can share my preferred model.");
        await user.click(screen.getByRole("button", { name: /Send message/u }));

        expect(await screen.findByText("I can share my preferred model."))
            .toBeInTheDocument();
        expect(screen.queryByText("Human support connected"))
            .not.toBeInTheDocument();
        expect(screen.queryByText("Your update has been sent to human support."))
            .not.toBeInTheDocument();
    });
});
