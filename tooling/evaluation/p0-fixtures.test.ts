import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
    DeterministicRagAnswerProvider,
    validateGroundedAnswer,
    type RetrievedEvidence,
} from "../../packages/assistant-core/src/index";
import { describe, expect, it } from "vitest";

import { loadAcceptanceCases } from "./acceptance-fixtures";

/**
 * loadApprovedFixtureEvidence
 * ----------------
 * Loads the two fictional approved knowledge files as stable zero-cost evidence for the deterministic P0 evaluator.
 *
 * July 26, 2026: Updated by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
 */
async function loadApprovedFixtureEvidence(): Promise<RetrievedEvidence[]>
{
    const manualUrl = new URL(
        "../../docs/spec/fixtures/knowledge/demo_company_product_manual.md",
        import.meta.url,
    );
    const faqUrl = new URL(
        "../../docs/spec/fixtures/knowledge/demo_company_faq.md",
        import.meta.url,
    );
    const [manual, faq] = await Promise.all([
        readFile(fileURLToPath(manualUrl), "utf8"),
        readFile(fileURLToPath(faqUrl), "utf8"),
    ]);

    return [
        {
            chunkId: "40000000-0000-4000-a000-000000000001",
            combinedScore: 1,
            content: manual,
            sourceLocator: {
                kind: "manual",
                title: "NovaFlow NF-Series Product Manual",
            },
        },
        {
            chunkId: "40000000-0000-4000-a000-000000000002",
            combinedScore: 1,
            content: faq,
            sourceLocator: {
                kind: "manual",
                title: "NovaFlow Industrial Systems FAQ",
            },
        },
    ];
}

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

    it("passes all twelve grounded cases with retrieval-set citations and expected facts", async () =>
    {
        const cases = await loadAcceptanceCases();
        const evidence = await loadApprovedFixtureEvidence();
        const provider = new DeterministicRagAnswerProvider();
        const inScopeCases = cases.filter((testCase) => testCase.group === "in_scope");

        for (const testCase of inScopeCases)
        {
            const generated = await provider.generate({
                evidence,
                language: testCase.language === "en" ? "en" : "zh-CN",
                question: testCase.question,
                recentMessages: [],
            });
            const answer = validateGroundedAnswer(generated.answer, evidence);
            const normalizedAnswer = answer.answer.toLocaleLowerCase();

            expect(answer.decision, testCase.id).toBe("answer");
            expect(answer.citationChunkIds.length, testCase.id).toBeGreaterThanOrEqual(1);

            for (const expectedFact of testCase.expectedFacts ?? [])
            {
                expect(normalizedAnswer, testCase.id)
                    .toContain(expectedFact.toLocaleLowerCase());
            }
        }
    });

    it("hands off all eight fixed out-of-scope cases without citations or guessed facts", async () =>
    {
        const cases = await loadAcceptanceCases();
        const evidence = await loadApprovedFixtureEvidence();
        const provider = new DeterministicRagAnswerProvider();
        const outOfScopeCases = cases.filter((testCase) => testCase.group === "out_of_scope");

        for (const testCase of outOfScopeCases)
        {
            const generated = await provider.generate({
                evidence,
                language: testCase.language === "en" ? "en" : "zh-CN",
                question: testCase.question,
                recentMessages: [],
            });
            const answer = validateGroundedAnswer(generated.answer, evidence);

            expect(answer.decision, testCase.id).toBe("handoff");
            expect(answer.handoffReason, testCase.id).toBe("missing_knowledge");
            expect(answer.citationChunkIds, testCase.id).toEqual([]);
        }
    });
});
