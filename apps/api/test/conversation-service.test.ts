import {
    describe,
    expect,
    it,
} from "vitest";

import { isExplicitHandoffRequest } from "../src/conversation-service";

describe("explicit customer handoff intent", () =>
{
    it.each([
        "我要人工",
        "请转人工客服",
        "请客服专员跟进",
        "I need a human agent",
        "Please connect me with a support specialist",
        "Connect me to a representative",
        "I want to talk with a real person",
    ])("recognizes %s", (message) =>
    {
        expect(isExplicitHandoffRequest(message)).toBe(true);
    });

    it.each([
        "What are your support hours?",
        "A human sales representative must confirm the price.",
        "请介绍人工智能客服的功能。",
    ])("does not escalate an ordinary mention in %s", (message) =>
    {
        expect(isExplicitHandoffRequest(message)).toBe(false);
    });
});
