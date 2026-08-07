import { describe, expect, it } from "vitest";

import {
    ragAnswerSchema,
    sendPublicMessageResponseSchema,
} from "./conversation";

describe("conversation contracts", () =>
{
    it("requires an evidence citation for an answer at the public response boundary", () =>
    {
        const result = sendPublicMessageResponseSchema.safeParse({
            answer: "The warranty is 36 months.",
            citations: [],
            decision: "answer",
            handoff: null,
            messageId: "30000000-0000-4000-a000-000000000001",
        });

        expect(result.success).toBe(false);
    });

    it("accepts the locked Structured Output shape before server post-validation", () =>
    {
        const result = ragAnswerSchema.parse({
            answer: "I do not have approved evidence for that answer.",
            citationChunkIds: [],
            confidence: 0.1,
            decision: "handoff",
            handoffReason: "missing_knowledge",
            normalizedQuestion: "atex certification",
        });

        expect(result.decision).toBe("handoff");
    });

    it("accepts a human-routed customer update without requiring citations", () =>
    {
        const result = sendPublicMessageResponseSchema.parse({
            answer: "Your update has been sent to human support.",
            citations: [],
            decision: "human",
            handoff: null,
            messageId: "30000000-0000-4000-a000-000000000002",
        });

        expect(result.decision).toBe("human");
    });

    it("accepts a citation-free conversational acknowledgement without offering handoff", () =>
    {
        const result = sendPublicMessageResponseSchema.parse({
            answer: "Yes, I can hear you. How can I help?",
            citations: [],
            decision: "acknowledge",
            handoff: null,
            messageId: "30000000-0000-4000-a000-000000000003",
        });

        expect(result.decision).toBe("acknowledge");
    });

    it("rejects citations on a conversational acknowledgement", () =>
    {
        const result = sendPublicMessageResponseSchema.safeParse({
            answer: "Hello.",
            citations: [{
                citationId: "40000000-0000-4000-a000-000000000001",
                label: "Unrelated source",
                sourceType: "url",
                sourceUrl: "https://example.test",
                supportingExcerpt: "Unrelated content.",
            }],
            decision: "acknowledge",
            handoff: null,
            messageId: "30000000-0000-4000-a000-000000000004",
        });

        expect(result.success).toBe(false);
    });
});
