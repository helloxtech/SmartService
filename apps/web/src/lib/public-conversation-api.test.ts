import { z } from "zod";
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import { createPublicConversationWithFallback } from "./public-conversation-api";

const createConversationRequestSchema = z.object({
    publicKey: z.string(),
});

afterEach(() =>
{
    vi.unstubAllGlobals();
});

describe("public conversation API", () =>
{
    it("retries the legacy demo key only when hosted Supabase has not received the XFlow key yet", async () =>
    {
        const attemptedKeys: string[] = [];
        const fetchMock = vi.fn(async (
            _input: RequestInfo | URL,
            init?: RequestInit,
        ): Promise<Response> =>
        {
            if (typeof init?.body !== "string")
            {
                throw new Error("Fixture expected a serialized JSON request body.");
            }

            const rawBody: unknown = JSON.parse(init.body);
            const request = createConversationRequestSchema.parse(rawBody);
            attemptedKeys.push(request.publicKey);

            if (request.publicKey === "xflow-public-demo")
            {
                return new Response(JSON.stringify({
                    error: {
                        code: "WIDGET_NOT_FOUND",
                        message: "The customer service widget is not available.",
                    },
                }), {
                    headers: {
                        "content-type": "application/json",
                    },
                    status: 404,
                });
            }

            return new Response(JSON.stringify({
                conversationId: "20000000-0000-4000-a000-000000000001",
                conversationToken: "x".repeat(32),
                displayName: "NovaFlow",
                expiresAt: "2099-07-30T22:00:00.000Z",
                welcomeMessage: "您好，欢迎联系 NovaFlow。",
            }), {
                headers: {
                    "content-type": "application/json",
                },
                status: 201,
            });
        });
        vi.stubGlobal("fetch", fetchMock);

        const result = await createPublicConversationWithFallback(
            ["xflow-public-demo", "novaflow-public-demo"],
            "zh-CN",
            "local-demo-turnstile",
        );

        expect(result.displayName).toBe("XFlow");
        expect(result.welcomeMessage).toBe("您好，欢迎联系 XFlow。");
        expect(attemptedKeys).toEqual([
            "xflow-public-demo",
            "novaflow-public-demo",
        ]);
    });

    it("does not hide non-migration public conversation failures", async () =>
    {
        const fetchMock = vi.fn(async (): Promise<Response> =>
        {
            return new Response(JSON.stringify({
                error: {
                    code: "TURNSTILE_FAILED",
                    message: "Human verification failed.",
                },
            }), {
                headers: {
                    "content-type": "application/json",
                },
                status: 403,
            });
        });
        vi.stubGlobal("fetch", fetchMock);

        await expect(createPublicConversationWithFallback(
            ["xflow-public-demo", "novaflow-public-demo"],
            "zh-CN",
            "local-demo-turnstile",
        )).rejects.toThrow("Human verification failed.");

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
