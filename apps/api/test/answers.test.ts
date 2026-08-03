import { afterEach, describe, expect, it, vi } from "vitest";

import {
    createRagAnswerProvider,
    OpenAiRagAnswerProvider,
    WorkersAiRagAnswerProvider,
} from "../src/answers";
import type { SmartServiceBindings } from "../src/types";

afterEach(() =>
{
    vi.restoreAllMocks();
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
        expect(result.model).toBe("gpt-5-mini");
        expect(result.outputTokens).toBe(35);
        expect(result.provider).toBe("openai");
        expect(requestBody.store).toBe(false);
        expect(requestBody.text.format).toMatchObject({
            strict: true,
            type: "json_schema",
        });
    });
});

describe("Workers AI RAG answer provider", () =>
{
    it("uses Cloudflare-hosted GLM in non-thinking JSON Schema mode without content logging", async () =>
    {
        const runMock = vi.fn().mockResolvedValue({
            choices: [{
                finish_reason: "stop",
                message: {
                    content: JSON.stringify(createGroundedAnswer()),
                    refusal: null,
                    role: "assistant",
                },
            }],
            created: 1,
            id: "workers-ai-test",
            model: "@cf/zai-org/glm-4.7-flash",
            object: "chat.completion",
            usage: {
                completion_tokens: 29,
                prompt_tokens: 96,
                total_tokens: 125,
            },
        });
        const provider = new WorkersAiRagAnswerProvider({
            AI: {
                run: runMock,
            } as unknown as Ai,
            WORKERS_AI_GATEWAY_ID: "default",
        } as SmartServiceBindings);
        const result = await provider.generate(createGenerationInput());
        const [model, request, options] = runMock.mock.calls[0] as [
            string,
            Record<string, unknown>,
            {
                gateway: Record<string, unknown>;
                tags: string[];
            },
        ];

        expect(model).toBe("@cf/zai-org/glm-4.7-flash");
        expect(request).toMatchObject({
            chat_template_kwargs: {
                enable_thinking: false,
            },
            max_completion_tokens: 1_800,
            response_format: {
                json_schema: {
                    strict: true,
                },
                type: "json_schema",
            },
            store: false,
            temperature: 0,
        });
        expect(options.gateway).toMatchObject({
            collectLog: false,
            id: "default",
        });
        expect(options.tags).toEqual(["smartservice", "rag-answer"]);
        expect(result).toMatchObject({
            inputTokens: 96,
            model: "@cf/zai-org/glm-4.7-flash",
            outputTokens: 29,
            provider: "cloudflare-workers-ai",
        });
    });

    it("retries GLM once after a schema-invalid primary response", async () =>
    {
        const runMock = vi.fn()
            .mockResolvedValueOnce({
                choices: [{
                    finish_reason: "stop",
                    message: {
                        content: JSON.stringify({ answer: "Incomplete" }),
                    },
                }],
            })
            .mockResolvedValueOnce({
                choices: [{
                    finish_reason: "stop",
                    message: {
                        content: JSON.stringify(createGroundedAnswer()),
                    },
                }],
            });
        const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const provider = new WorkersAiRagAnswerProvider({
            AI: {
                run: runMock,
            } as unknown as Ai,
            WORKERS_AI_GATEWAY_ID: "default",
        } as SmartServiceBindings);
        const result = await provider.generate(createGenerationInput());

        expect(runMock).toHaveBeenCalledTimes(2);
        expect(result.provider).toBe("cloudflare-workers-ai");
        expect(warnMock).toHaveBeenCalledWith(expect.stringContaining(
            '"event":"workers_ai.answer.retry"',
        ));
    });

    it("falls back to OpenAI when GLM cites evidence outside the exact retrieval set", async () =>
    {
        const runMock = vi.fn().mockResolvedValue({
            choices: [{
                finish_reason: "stop",
                message: {
                    content: JSON.stringify(createGroundedAnswer(
                        "40000000-0000-4000-a000-000000000099",
                    )),
                },
            }],
            created: 1,
            id: "workers-ai-invalid-citation",
            model: "@cf/zai-org/glm-4.7-flash",
            object: "chat.completion",
            usage: {
                completion_tokens: 20,
                prompt_tokens: 90,
                total_tokens: 110,
            },
        });
        const fetchMock = vi.fn().mockResolvedValue(createOpenAiResponse());
        vi.stubGlobal("fetch", fetchMock);
        const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const provider = createRagAnswerProvider({
            AI: {
                run: runMock,
            } as unknown as Ai,
            CHAT_FALLBACK_PROVIDER: "openai",
            CHAT_PRIMARY_PROVIDER: "workers-ai",
            CHAT_PROVIDER_MODE: "live",
            OPENAI_API_KEY: "unit-test-key",
            OPENAI_CHAT_MODEL: "gpt-5-mini",
        } as SmartServiceBindings);
        const result = await provider.generate(createGenerationInput());

        expect(runMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
            model: "gpt-5-mini",
            provider: "openai",
        });
        expect(result.answer.citationChunkIds).toEqual([
            "40000000-0000-4000-a000-000000000001",
        ]);
        expect(warnMock).toHaveBeenCalledWith(expect.stringContaining(
            '"event":"rag.answer.fallback"',
        ));
    });

    it("falls back to OpenAI when the Workers AI provider request fails", async () =>
    {
        const runMock = vi.fn().mockRejectedValue(new Error("Workers AI unavailable"));
        const fetchMock = vi.fn().mockResolvedValue(createOpenAiResponse());
        vi.stubGlobal("fetch", fetchMock);
        const errorMock = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const provider = createRagAnswerProvider({
            AI: {
                run: runMock,
            } as unknown as Ai,
            CHAT_FALLBACK_PROVIDER: "openai",
            CHAT_PRIMARY_PROVIDER: "workers-ai",
            CHAT_PROVIDER_MODE: "live",
            OPENAI_API_KEY: "unit-test-key",
            OPENAI_CHAT_MODEL: "gpt-5-mini",
        } as SmartServiceBindings);
        const result = await provider.generate(createGenerationInput());

        expect(runMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
            model: "gpt-5-mini",
            provider: "openai",
        });
        expect(errorMock).toHaveBeenCalledWith(expect.stringContaining(
            '"event":"workers_ai.structured_output.failed"',
        ));
        expect(warnMock).toHaveBeenCalledWith(expect.stringContaining(
            '"event":"rag.answer.fallback"',
        ));
    });

    it("returns only the Workers AI result when fallback is disabled", async () =>
    {
        const runMock = vi.fn().mockResolvedValue({
            choices: [{
                finish_reason: "stop",
                message: {
                    content: JSON.stringify(createGroundedAnswer()),
                },
            }],
            created: 1,
            id: "workers-ai-primary-only",
            model: "@cf/zai-org/glm-4.7-flash",
            object: "chat.completion",
            usage: {
                completion_tokens: 21,
                prompt_tokens: 91,
                total_tokens: 112,
            },
        });
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const provider = createRagAnswerProvider({
            AI: {
                run: runMock,
            } as unknown as Ai,
            CHAT_FALLBACK_PROVIDER: "none",
            CHAT_PRIMARY_PROVIDER: "workers-ai",
            CHAT_PROVIDER_MODE: "live",
            OPENAI_API_KEY: "unit-test-key",
            OPENAI_CHAT_MODEL: "gpt-5-mini",
        } as SmartServiceBindings);
        const result = await provider.generate(createGenerationInput());

        expect(runMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            model: "@cf/zai-org/glm-4.7-flash",
            provider: "cloudflare-workers-ai",
        });
    });

    it("fails closed without calling OpenAI when Workers AI fails and fallback is disabled", async () =>
    {
        const runMock = vi.fn().mockRejectedValue(new Error("Workers AI unavailable"));
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const errorMock = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const provider = createRagAnswerProvider({
            AI: {
                run: runMock,
            } as unknown as Ai,
            CHAT_FALLBACK_PROVIDER: "none",
            CHAT_PRIMARY_PROVIDER: "workers-ai",
            CHAT_PROVIDER_MODE: "live",
            OPENAI_API_KEY: "unit-test-key",
            OPENAI_CHAT_MODEL: "gpt-5-mini",
        } as SmartServiceBindings);

        await expect(provider.generate(createGenerationInput())).rejects.toMatchObject({
            code: "WORKERS_AI_PROVIDER_FAILED",
        });
        expect(runMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(errorMock).toHaveBeenCalledWith(expect.stringContaining(
            '"event":"workers_ai.structured_output.failed"',
        ));
    });
});

/**
 * createGenerationInput
 * ----------------
 * Builds the exact one-chunk retrieval input shared by live-provider unit tests.
 *
 * August 03, 2026: Created by Forrest Zhang for SmartService Workers AI Cost Optimization
 */
function createGenerationInput()
{
    return {
        evidence: [{
            chunkId: "40000000-0000-4000-a000-000000000001",
            combinedScore: 0.9,
            content: "NF-500 maximum flow is 300 litres per minute.",
            sourceLocator: {
                title: "Manual",
            },
        }],
        language: "en" as const,
        question: "What is the NF-500 maximum flow?",
        recentMessages: [],
    };
}

/**
 * createGroundedAnswer
 * ----------------
 * Builds a structurally valid grounded answer with a configurable citation for fallback testing.
 *
 * August 03, 2026: Created by Forrest Zhang for SmartService Workers AI Cost Optimization
 */
function createGroundedAnswer(
    citationChunkId = "40000000-0000-4000-a000-000000000001",
)
{
    return {
        answer: "The maximum flow is 300 litres per minute.",
        citationChunkIds: [citationChunkId],
        confidence: 0.94,
        decision: "answer",
        handoffReason: null,
        normalizedQuestion: "maximum flow nf-500",
    };
}

/**
 * createOpenAiResponse
 * ----------------
 * Returns a valid OpenAI fallback response with the exact retrieved citation.
 *
 * August 03, 2026: Created by Forrest Zhang for SmartService Workers AI Cost Optimization
 */
function createOpenAiResponse(): Response
{
    return new Response(JSON.stringify({
        output: [{
            content: [{
                text: JSON.stringify(createGroundedAnswer()),
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
    });
}

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
