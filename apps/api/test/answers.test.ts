import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAiRagAnswerProvider } from "../src/answers";
import type { SmartServiceBindings } from "../src/types";

afterEach(() =>
{
    vi.unstubAllGlobals();
});

describe("OpenAI RAG answer provider", () =>
{
    it("uses the Responses API strict text format and parses token usage", async () =>
    {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            output: [{
                content: [{
                    text: JSON.stringify({
                        answer: "The maximum flow is 300 litres per minute.",
                        citationChunkIds: ["40000000-0000-4000-a000-000000000001"],
                        confidence: 0.94,
                        decision: "answer",
                        handoffReason: null,
                        normalizedQuestion: "maximum flow nf-500",
                    }),
                    type: "output_text",
                }],
                type: "message",
            }],
            usage: {
                input_tokens: 120,
                output_tokens: 35,
            },
        }), {
            headers: {
                "content-type": "application/json",
            },
            status: 200,
        }));
        vi.stubGlobal("fetch", fetchMock);
        const provider = new OpenAiRagAnswerProvider({
            OPENAI_API_KEY: "unit-test-key",
            OPENAI_CHAT_MODEL: "gpt-5-mini",
        } as SmartServiceBindings);
        const result = await provider.generate({
            evidence: [{
                chunkId: "40000000-0000-4000-a000-000000000001",
                combinedScore: 0.9,
                content: "NF-500 maximum flow is 300 litres per minute.",
                sourceLocator: {
                    title: "Manual",
                },
            }],
            language: "en",
            question: "What is the NF-500 maximum flow?",
            recentMessages: [],
        });
        const requestBody = JSON.parse(
            zodFetchBody(fetchMock.mock.calls[0]?.[1]),
        ) as {
            store: boolean;
            text: {
                format: {
                    strict: boolean;
                    type: string;
                };
            };
        };

        expect(result.answer.decision).toBe("answer");
        expect(result.inputTokens).toBe(120);
        expect(result.outputTokens).toBe(35);
        expect(requestBody.store).toBe(false);
        expect(requestBody.text.format).toMatchObject({
            strict: true,
            type: "json_schema",
        });
    });
});

/**
 * zodFetchBody
 * ----------------
 * Narrows a mocked fetch init body to the JSON string used by the provider request.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
 */
function zodFetchBody(init: RequestInit | undefined): string
{
    if (typeof init?.body !== "string")
    {
        throw new Error("Expected a JSON request body.");
    }

    return init.body;
}
