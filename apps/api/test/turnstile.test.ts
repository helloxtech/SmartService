import { afterEach, describe, expect, it, vi } from "vitest";

import {
    CloudflareTurnstileVerifier,
    MockTurnstileVerifier,
} from "../src/turnstile";
import type { SmartServiceBindings } from "../src/types";

afterEach(() =>
{
    vi.unstubAllGlobals();
});

describe("Turnstile verification", () =>
{
    it("accepts only the explicit local fixture token in mock mode", async () =>
    {
        const verifier = new MockTurnstileVerifier();

        await expect(verifier.verify(
            "local-demo-turnstile",
            null,
            crypto.randomUUID(),
        )).resolves.toBeUndefined();
        await expect(verifier.verify(
            "forged-token",
            null,
            crypto.randomUUID(),
        )).rejects.toMatchObject({
            code: "TURNSTILE_INVALID",
            status: 403,
        });
    });

    it("requires a successful action and configured hostname from Siteverify", async () =>
    {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            action: "smartservice_chat",
            hostname: "demo.smartservice.test",
            success: true,
        }), {
            headers: {
                "content-type": "application/json",
            },
            status: 200,
        }));
        vi.stubGlobal("fetch", fetchMock);
        const verifier = new CloudflareTurnstileVerifier({
            TURNSTILE_EXPECTED_HOSTNAME: "demo.smartservice.test",
            TURNSTILE_SECRET_KEY: "server-only-test-secret",
        } as SmartServiceBindings);

        await expect(verifier.verify(
            "provider-token",
            "198.51.100.10",
            crypto.randomUUID(),
        )).resolves.toBeUndefined();
        expect(fetchMock).toHaveBeenCalledOnce();
    });
});
