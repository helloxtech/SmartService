import { describe, expect, it } from "vitest";

import { DeterministicConversationFinalizer } from "./finalization";

describe("conversation finalization", () =>
{
    it("keeps optional ticket scope disabled and does not invent customer facts", async () =>
    {
        const finalizer = new DeterministicConversationFinalizer();
        const result = await finalizer.finalize({
            includeTicketClassification: false,
            language: "en",
            messages: [{
                id: "10000000-0000-4000-a000-000000000001",
                senderType: "customer",
                text: "I need help understanding the NF-500 warranty.",
            }, {
                id: "10000000-0000-4000-a000-000000000002",
                senderType: "human",
                text: "I reviewed the approved warranty information with you.",
            }],
        });

        expect(result.finalization.ticket).toBeNull();
        expect(result.finalization.customerFacts).toEqual([]);
        expect(result.finalization.outcome).toBe("resolved_human");
        expect(result.finalization.primaryIntent).toContain("NF-500 warranty");
    });
});
