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
});
