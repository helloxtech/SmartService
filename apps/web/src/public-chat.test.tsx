import {
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
                    displayName: "NovaFlow",
                    expiresAt: "2099-07-26T22:00:00.000Z",
                    welcomeMessage: "您好，欢迎联系 NovaFlow。",
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
        await user.type(
            screen.getByLabelText("Ask NovaFlow support"),
            "NF-500 的保修期多久？",
        );
        await user.click(screen.getByRole("button", { name: "Send message" }));

        expect(await screen.findByText(/36 months/u)).toBeInTheDocument();
        await user.click(screen.getByRole("button", {
            name: /Source 1: NF-Series Product Manual/u,
        }));
        expect(screen.getByText(
            "NF-500 limited warranty: 36 months from shipment date.",
        )).toBeInTheDocument();
        expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("chunkId");
    });
});
