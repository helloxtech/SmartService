import type { Session } from "@supabase/supabase-js";
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import { submitWebsite } from "./knowledge-api";

const session = {
    access_token: "fixture-access-token",
    user: {
        id: "10000000-0000-4000-a000-000000000001",
    },
} as unknown as Session;

afterEach(() =>
{
    vi.unstubAllGlobals();
});

describe("knowledge intake API", () =>
{
    it("uses a new idempotency scope for each deliberate website submission", async () =>
    {
        const fetchMock = vi.fn(async (
            _input: RequestInfo | URL,
            _init?: RequestInit,
        ): Promise<Response> =>
        {
            void _input;
            void _init;

            return new Response(JSON.stringify({
                jobId: "20000000-0000-4000-a000-000000000001",
                sourceId: "30000000-0000-4000-a000-000000000001",
                status: "uploaded",
            }), {
                headers: {
                    "content-type": "application/json",
                },
                status: 202,
            });
        });
        vi.stubGlobal("fetch", fetchMock);

        const input = {
            maxDepth: 2,
            maxPages: 10,
            url: "https://example.com/",
        };
        await submitWebsite(session, input);
        await submitWebsite(session, input);

        const idempotencyKeys = fetchMock.mock.calls.map((call) =>
        {
            return new Headers(call[1]?.headers).get("idempotency-key");
        });

        expect(idempotencyKeys[0]).toMatch(/^[a-f0-9]{64}$/u);
        expect(idempotencyKeys[1]).toMatch(/^[a-f0-9]{64}$/u);
        expect(idempotencyKeys[1]).not.toBe(idempotencyKeys[0]);
    });
});
