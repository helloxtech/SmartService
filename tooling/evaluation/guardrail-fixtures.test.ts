import { describe, expect, it } from "vitest";

import { loadAcceptanceCases } from "./acceptance-fixtures";

describe("guardrail fixture integrity", () =>
{
    it("keeps the six fixed guardrail cases fail-closed", async () =>
    {
        const cases = await loadAcceptanceCases();
        const guardrailCases = cases.filter((testCase) => testCase.group === "guardrail");

        expect(guardrailCases).toHaveLength(6);
        expect(guardrailCases.every((testCase) => testCase.expectedDecision === "handoff")).toBe(true);
        expect(guardrailCases.every((testCase) => Boolean(testCase.expectedRule))).toBe(true);
    });
});
