import { evaluateDeterministicGuardrails } from "../../packages/assistant-core/src/index";
import type { GuardrailRule } from "../../packages/contracts/src/index";
import { describe, expect, it } from "vitest";

import { loadAcceptanceCases } from "./acceptance-fixtures";

const ruleTypeByCode: Record<string, GuardrailRule["ruleType"]> = {
    NO_COMPETITOR_JUDGMENT: "competitor",
    NO_DELIVERY_COMMITMENT: "delivery",
    NO_PRICE_COMMITMENT: "price",
    NO_SYSTEM_DISCLOSURE: "security",
    NO_UNSUPPORTED_CLAIM: "unsupported_claim",
    SAFETY_ESCALATION: "safety",
};

describe("guardrail acceptance evaluation", () =>
{
    it("blocks every fixed case with its expected rule and safe handoff", async () =>
    {
        const cases = await loadAcceptanceCases();
        const guardrailCases = cases.filter((testCase) => testCase.group === "guardrail");
        const rules = guardrailCases.map((testCase, index): GuardrailRule =>
        {
            const code = testCase.expectedRule ?? "";
            const ruleType = ruleTypeByCode[code];

            if (ruleType === undefined)
            {
                throw new Error(`The fixed rule ${code} has no deterministic type.`);
            }

            return {
                code,
                createdAt: "2026-07-26T12:00:00.000Z",
                description: `Fixed acceptance rule ${code}`,
                enabled: true,
                id: `10000000-0000-4000-a000-${(index + 1).toString().padStart(12, "0")}`,
                name: code.replaceAll("_", " "),
                ruleType,
                safeResponse: "This request requires safe human review.",
                severity: "high",
                updatedAt: "2026-07-26T12:00:00.000Z",
            };
        });

        expect(guardrailCases).toHaveLength(6);

        for (const testCase of guardrailCases)
        {
            const evaluation = evaluateDeterministicGuardrails({
                candidateAnswer: null,
                language: testCase.language === "zh-CN" ? "zh-CN" : "en",
                rules,
                userMessage: testCase.question,
            });

            expect(testCase.expectedDecision).toBe("handoff");
            expect(evaluation.allowed, testCase.id).toBe(false);
            expect(evaluation.requestHandoff, testCase.id).toBe(true);
            expect(evaluation.safeResponse, testCase.id).not.toBeNull();
            expect(
                evaluation.violations.map((violation) => violation.ruleCode),
                testCase.id,
            ).toContain(testCase.expectedRule);
        }
    });
});
