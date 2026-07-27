import { describe, expect, it } from "vitest";

import { loadAcceptanceCases } from "./acceptance-fixtures";

describe("P0 acceptance fixture integrity", () =>
{
    it("keeps the frozen in-scope and out-of-scope case counts", async () =>
    {
        const cases = await loadAcceptanceCases();
        const inScopeCases = cases.filter((testCase) => testCase.group === "in_scope");
        const outOfScopeCases = cases.filter((testCase) => testCase.group === "out_of_scope");

        expect(inScopeCases).toHaveLength(12);
        expect(outOfScopeCases).toHaveLength(8);
        expect(inScopeCases.every((testCase) => testCase.expectedDecision === "answer")).toBe(true);
        expect(outOfScopeCases.every((testCase) => testCase.expectedDecision === "handoff")).toBe(true);
    });

    it("keeps every fixed case identifier unique", async () =>
    {
        const cases = await loadAcceptanceCases();
        const ids = cases.map((testCase) => testCase.id);

        expect(new Set(ids).size).toBe(ids.length);
    });
});
