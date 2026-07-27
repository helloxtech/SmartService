import { describe, expect, it } from "vitest";

import {
    DeterministicRagAnswerProvider,
    RagValidationError,
    validateGroundedAnswer,
    type RetrievedEvidence,
} from "./rag";

const evidence: RetrievedEvidence[] = [{
    chunkId: "40000000-0000-4000-a000-000000000001",
    combinedScore: 0.91,
    content: "NF-500 specifications. Maximum flow | 300 litres per minute.",
    sourceLocator: {
        pageStart: 4,
        title: "NF-Series Product Manual",
    },
}];

describe("grounded RAG", () =>
{
    it("answers a fixture question only with a retrieved supporting citation", async () =>
    {
        const provider = new DeterministicRagAnswerProvider();
        const result = await provider.generate({
            evidence,
            language: "en",
            question: "What is the maximum flow rate of the NF-500?",
            recentMessages: [],
        });
        const answer = result.answer;

        expect(answer.decision).toBe("answer");
        expect(answer.answer).toContain("300 litres per minute");
        expect(answer.citationChunkIds).toEqual([evidence[0]?.chunkId]);
        expect(validateGroundedAnswer(answer, evidence)).toEqual(answer);
    });

    it("hands off rather than guessing when retrieved evidence does not support the question", async () =>
    {
        const provider = new DeterministicRagAnswerProvider();
        const result = await provider.generate({
            evidence,
            language: "zh-CN",
            question: "产品有没有 ATEX 认证？",
            recentMessages: [],
        });
        const answer = result.answer;

        expect(answer).toMatchObject({
            citationChunkIds: [],
            decision: "handoff",
            handoffReason: "missing_knowledge",
        });
    });

    it("returns an exact approved manual answer only for its matching original question", async () =>
    {
        const provider = new DeterministicRagAnswerProvider();
        const manualEvidence: RetrievedEvidence[] = [{
            chunkId: "40000000-0000-4000-a000-000000000003",
            combinedScore: 0.99,
            content: "Question: What is the diagnostic coverage window?\n\nAnswer: The approved diagnostic coverage window is 14 days.\n\nSource note: Approved by the demo product lead.",
            sourceLocator: {
                section: "Approved manual answer",
                title: "Diagnostic coverage",
            },
        }];
        const matching = await provider.generate({
            evidence: manualEvidence,
            language: "en",
            question: "What is the diagnostic coverage window?",
            recentMessages: [],
        });
        const different = await provider.generate({
            evidence: manualEvidence,
            language: "en",
            question: "What is the delivery time?",
            recentMessages: [],
        });

        expect(matching.answer).toMatchObject({
            answer: "The approved diagnostic coverage window is 14 days.",
            citationChunkIds: [manualEvidence[0]?.chunkId],
            decision: "answer",
        });
        expect(different.answer.decision).toBe("handoff");
    });

    it("rejects a structurally valid citation outside the retrieval set", () =>
    {
        expect(() => validateGroundedAnswer({
            answer: "Unsupported",
            citationChunkIds: ["40000000-0000-4000-a000-000000000002"],
            confidence: 0.9,
            decision: "answer",
            handoffReason: null,
            normalizedQuestion: "unsupported",
        }, evidence)).toThrow(RagValidationError);
    });
});
