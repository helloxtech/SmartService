import type { GuardrailRule } from "@smartservice/contracts";
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import {
    createGuardrailSupervisor,
    OpenAiConversationFinalizer,
    OpenAiGuardrailSupervisor,
    WorkersAiGuardrailSupervisor,
} from "../src/auxiliary-ai";
import type { SmartServiceBindings } from "../src/types";

const rule: GuardrailRule = {
    code: "NO_PRICE_COMMITMENT",
    createdAt: "2026-07-26T12:00:00.000Z",
    description: "Do not quote final prices or discounts.",
    enabled: true,
    id: "10000000-0000-4000-a000-000000000001",
    name: "No price commitment",
    ruleType: "price",
    safeResponse: "A sales specialist can help with final pricing.",
    severity: "high",
    updatedAt: "2026-07-26T12:00:00.000Z",
};

afterEach(() =>
{
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("OpenAI auxiliary adapters", () =>
{
    it("accepts only enabled tenant rule codes from strict guardrail output", async () =>
    {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            output: [{
                content: [{
                    text: JSON.stringify({
                        allowed: false,
                        requestHandoff: true,
                        safeResponse: "A sales specialist can help with final pricing.",
                        violations: [{
                            reason: "The candidate makes a final price commitment.",
                            ruleCode: rule.code,
                            severity: rule.severity,
                        }],
                    }),
                    type: "output_text",
                }],
                type: "message",
            }],
            usage: {
                input_tokens: 80,
                output_tokens: 20,
            },
        }), {
            status: 200,
        }));
        vi.stubGlobal("fetch", fetchMock);
        const provider = new OpenAiGuardrailSupervisor({
            OPENAI_API_KEY: "unit-test-key",
            OPENAI_SUPERVISOR_MODEL: "gpt-5-nano",
        } as SmartServiceBindings);
        const result = await provider.supervise({
            candidateAnswer: "The final price is guaranteed.",
            evidence: [{
                chunkId: "10000000-0000-4000-a000-000000000002",
                content: "The final price is guaranteed.",
            }],
            language: "en",
            rules: [rule],
            userMessage: "Give me the final price.",
        });

        expect(result.evaluation.allowed).toBe(false);
        expect(result.evaluation.violations[0]?.ruleCode).toBe(rule.code);
        expect(result.inputTokens).toBe(80);
        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
            max_output_tokens: 500,
        });
    });

    it("localizes a blocked response to the customer language", async () =>
    {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
            output: [{
                content: [{
                    text: JSON.stringify({
                        allowed: false,
                        requestHandoff: true,
                        safeResponse: "A sales specialist can help with final pricing.",
                        violations: [{
                            reason: "The candidate makes a final price commitment.",
                            ruleCode: rule.code,
                            severity: rule.severity,
                        }],
                    }),
                    type: "output_text",
                }],
                type: "message",
            }],
        }), {
            status: 200,
        })));
        const provider = new OpenAiGuardrailSupervisor({
            OPENAI_API_KEY: "unit-test-key",
            OPENAI_SUPERVISOR_MODEL: "gpt-5-nano",
        } as SmartServiceBindings);
        const result = await provider.supervise({
            candidateAnswer: "我保证最终价格。",
            evidence: [],
            language: "zh-CN",
            rules: [rule],
            userMessage: "请给我最终价格。",
        });

        expect(result.evaluation.safeResponse).toBe(
            "这个问题需要客服专员进一步确认，我已请对方继续跟进。",
        );
    });

    it("keeps ticket classification null in the close-time Structured Output", async () =>
    {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
            output: [{
                content: [{
                    text: JSON.stringify({
                        customerFacts: [],
                        followUpActions: [],
                        intentLevel: "unknown",
                        outcome: "resolved_human",
                        primaryIntent: "Warranty question",
                        suggestedScript: "Please reply if more help is needed.",
                        summary: "A human reviewed the warranty question.",
                        ticket: null,
                    }),
                    type: "output_text",
                }],
                type: "message",
            }],
        }), {
            status: 200,
        })));
        const provider = new OpenAiConversationFinalizer({
            OPENAI_API_KEY: "unit-test-key",
            OPENAI_SUPERVISOR_MODEL: "gpt-5-nano",
        } as SmartServiceBindings);
        const result = await provider.finalize({
            includeTicketClassification: false,
            language: "en",
            messages: [{
                id: "20000000-0000-4000-a000-000000000001",
                senderType: "customer",
                text: "What is the warranty?",
            }],
        });

        expect(result.finalization.ticket).toBeNull();
        expect(result.finalization.primaryIntent).toBe("Warranty question");
    });
});

describe("Workers AI auxiliary adapter", () =>
{
    it("uses the fast Cloudflare model for strict per-turn supervision without OpenAI", async () =>
    {
        const runMock = vi.fn().mockResolvedValue({
            response: {
                allowed: true,
                requestHandoff: false,
                safeResponse: null,
                violations: [],
            },
            usage: {
                completion_tokens: 18,
                prompt_tokens: 210,
            },
        });
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const bindings = {
            AI: {
                run: runMock,
            } as unknown as Ai,
            AUXILIARY_PROVIDER_MODE: "live",
            CHAT_SUPERVISOR_PROVIDER: "workers-ai",
            CHAT_WORKERS_AI_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
            WORKERS_AI_GATEWAY_ID: "default",
        } as SmartServiceBindings;
        const selected = createGuardrailSupervisor(bindings);

        expect(selected).toBeInstanceOf(WorkersAiGuardrailSupervisor);
        const result = await selected.supervise({
            candidateAnswer: "The warranty is one year.",
            evidence: [{
                chunkId: "10000000-0000-4000-a000-000000000002",
                content: "The warranty is one year.",
            }],
            language: "en",
            rules: [rule],
            userMessage: "What is the warranty?",
        });
        const [model, request, options] = runMock.mock.calls[0] as [
            string,
            Record<string, unknown>,
            { tags: string[] },
        ];

        expect(model).toBe("@cf/meta/llama-3.1-8b-instruct-fast");
        expect(request).toMatchObject({
            max_tokens: 500,
            response_format: {
                type: "json_schema",
            },
        });
        expect(options.tags).toEqual(["smartservice", "guardrail-supervisor"]);
        expect(result).toMatchObject({
            evaluation: {
                allowed: true,
            },
            inputTokens: 210,
            outputTokens: 18,
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("fails closed when Cloudflare returns a rule code the tenant did not enable", async () =>
    {
        vi.spyOn(console, "info").mockImplementation(() => undefined);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const runMock = vi.fn().mockResolvedValue({
            response: {
                allowed: false,
                requestHandoff: true,
                safeResponse: "Blocked.",
                violations: [{
                    reason: "An unknown rule was selected.",
                    ruleCode: "UNKNOWN_RULE",
                    severity: "high",
                }],
            },
        });
        const provider = new WorkersAiGuardrailSupervisor({
            AI: {
                run: runMock,
            } as unknown as Ai,
            CHAT_WORKERS_AI_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
        } as SmartServiceBindings);

        await expect(provider.supervise({
            candidateAnswer: "The final price is guaranteed.",
            evidence: [],
            language: "en",
            rules: [rule],
            userMessage: "Give me the final price.",
        })).rejects.toMatchObject({
            code: "GUARDRAIL_RESPONSE_INVALID",
        });
        expect(runMock).toHaveBeenCalledTimes(2);
    });
});
