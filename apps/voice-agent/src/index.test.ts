import { describe, expect, it } from "vitest";

import { voiceAgentScaffold } from "./index";

describe("voice agent scope gate", () =>
{
    it("keeps P1 disabled during the P0 foundation", () =>
    {
        expect(voiceAgentScaffold.enabled).toBe(false);
    });
});
