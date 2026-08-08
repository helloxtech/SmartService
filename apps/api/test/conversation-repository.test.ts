import { describe, expect, it } from "vitest";

import { resolvePersistedConversationDecision } from "../src/conversation-repository";

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
