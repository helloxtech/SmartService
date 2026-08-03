import type { GuardrailRule } from "@smartservice/contracts";
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import {
    OpenAiConversationFinalizer,
    OpenAiGuardrailSupervisor,
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
    vi.unstubAllGlobals();
});

describe("OpenAI auxiliary adapters", () =>
{
    it("accepts only enabled tenant rule codes from strict guardrail output", async () =>
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
            usage: {
                input_tokens: 80,
                output_tokens: 20,
            },
        }), {
            status: 200,
        })));
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
            "这个问题需要工作人员进一步确认，我已帮您转接人工客服。",
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
