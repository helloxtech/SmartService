import { afterEach, describe, expect, it, vi } from "vitest";

import { requestStructuredOutput } from "../src/openai-structured-output";

afterEach(() =>
{
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("requestStructuredOutput", () =>
{
    it("sends a bounded reasoning budget and parses a strict output text item", async () =>
    {
        const infoMock = vi.spyOn(console, "info").mockImplementation(() => undefined);
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            output: [{
                content: [{
                    text: JSON.stringify({ ok: true }),
                    type: "output_text",
                }],
                type: "message",
            }],
            status: "completed",
            usage: {
                input_tokens: 20,
                output_tokens: 40,
                output_tokens_details: {
                    reasoning_tokens: 24,
                },
            },
        }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        const result = await requestStructuredOutput({
            apiKey: "unit-test-placeholder",
            description: "A test object.",
            errorCode: "TEST_PROVIDER_FAILED",
            errorMessage: "The test provider failed.",
            eventName: "test.provider.failed",
            maxOutputTokens: 2_500,
            model: "gpt-5-mini",
            name: "test_object",
            prompt: {
                system: "Return the schema.",
                user: "Return true.",
            },
            promptVersion: "test-v1",
            reasoningEffort: "low",
            schema: {
                additionalProperties: false,
                properties: {
                    ok: { type: "boolean" },
                },
                required: ["ok"],
                type: "object",
            },
            timeoutMs: 5_000,
        });
        const request = fetchMock.mock.calls[0];
        const body = JSON.parse(String(request?.[1]?.body)) as Record<string, unknown>;

        expect(body).toMatchObject({
            max_output_tokens: 2_500,
            reasoning: {
                effort: "low",
            },
            store: false,
        });
        expect(result).toEqual({
            inputTokens: 20,
            outputTokens: 40,
            value: { ok: true },
        });
        expect(infoMock).toHaveBeenCalledWith(expect.stringContaining(
            '"event":"structured_output.succeeded"',
        ));
    });

    it("honors a one-attempt customer-turn budget without replaying a failed request", async () =>
    {
        const fetchMock = vi.fn().mockRejectedValue(new Error("temporary provider failure"));
        vi.stubGlobal("fetch", fetchMock);
        vi.spyOn(console, "error").mockImplementation(() => undefined);

        await expect(requestStructuredOutput({
            apiKey: "unit-test-placeholder",
            description: "A test object.",
            errorCode: "TEST_PROVIDER_FAILED",
            errorMessage: "The test provider failed.",
            eventName: "test.provider.failed",
            maxAttempts: 1,
            maxOutputTokens: 200,
            model: "gpt-5-nano",
            name: "test_object",
            prompt: {
                system: "Return the schema.",
                user: "Return true.",
            },
            promptVersion: "test-v1",
            schema: {
                additionalProperties: false,
                properties: {
                    ok: { type: "boolean" },
                },
                required: ["ok"],
                type: "object",
            },
            timeoutMs: 1_000,
            totalTimeoutMs: 1_000,
        })).rejects.toMatchObject({
            code: "TEST_PROVIDER_FAILED",
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
