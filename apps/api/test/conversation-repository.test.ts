import { describe, expect, it } from "vitest";

import {
    collapsePublicCitations,
    resolvePersistedConversationDecision,
} from "../src/conversation-repository";

describe("conversation repository decision compatibility", () =>
{
    it("rehydrates only the explicit acknowledgement storage marker", () =>
    {
        expect(resolvePersistedConversationDecision(
            "clarify",
            { handoffReason: "conversation_acknowledgement" },
        )).toBe("acknowledge");
        expect(resolvePersistedConversationDecision(
            "clarify",
            { handoffReason: "system_error" },
        )).toBe("clarify");
        expect(resolvePersistedConversationDecision(
            "handoff",
            { handoffReason: "conversation_acknowledgement" },
        )).toBe("handoff");
        expect(resolvePersistedConversationDecision(null, {})).toBeNull();
    });
});

describe("public citation presentation", () =>
{
    it("collapses repeated page chunks while preserving unique excerpts", () =>
    {
        const citations = collapsePublicCitations([{
            citationId: "50000000-0000-4000-a000-000000000001",
            label: "About, section 1",
            sourceType: "url",
            sourceUrl: "https://example.test/about/#scope",
            supportingExcerpt: "The organization operates across two regions.",
        }, {
            citationId: "50000000-0000-4000-a000-000000000002",
            label: "About, section 2",
            sourceType: "url",
            sourceUrl: "https://EXAMPLE.test/about/",
            supportingExcerpt: "Its services cover residential and commercial customers.",
        }, {
            citationId: "50000000-0000-4000-a000-000000000003",
            label: "Locations",
            sourceType: "url",
            sourceUrl: "https://example.test/locations",
            supportingExcerpt: "Three locations are listed.",
        }]);

        expect(citations).toHaveLength(2);
        expect(citations[0]?.citationId)
            .toBe("50000000-0000-4000-a000-000000000001");
        expect(citations[0]?.supportingExcerpt).toContain("operates across two regions");
        expect(citations[0]?.supportingExcerpt).toContain("residential and commercial");
        expect(citations[1]?.label).toBe("Locations");
    });
});
