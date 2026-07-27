import { z } from "zod";

import { ApiError } from "./errors";
import type { SmartServiceBindings } from "./types";

const turnstileResponseSchema = z.object({
    action: z.string().optional(),
    "error-codes": z.array(z.string()).optional(),
    hostname: z.string().optional(),
    success: z.boolean(),
});

export interface TurnstileVerifier
{
    verify(token: string, remoteIp: string | null, idempotencyKey: string): Promise<void>;
}

/**
 * waitForRetry
 * ----------------
 * Applies a short bounded delay before the single permitted Turnstile transport retry.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
 */
async function waitForRetry(): Promise<void>
{
    await new Promise<void>((resolve) =>
    {
        setTimeout(resolve, 250);
    });
}

export class MockTurnstileVerifier implements TurnstileVerifier
{
    /**
     * verify
     * ----------------
     * Accepts only the explicit local-development token and never performs a provider call.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
     */
    public async verify(
        token: string,
        remoteIp: string | null,
        idempotencyKey: string,
    ): Promise<void>
    {
        void remoteIp;
        void idempotencyKey;

        if (token !== "local-demo-turnstile")
        {
            throw new ApiError(403, "TURNSTILE_INVALID", "Human verification was not accepted.");
        }
    }
}

export class CloudflareTurnstileVerifier implements TurnstileVerifier
{
    /**
     * CloudflareTurnstileVerifier
     * ----------------
     * Creates a server-side Turnstile Siteverify adapter from private Worker configuration.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
     */
    public constructor(private readonly bindings: SmartServiceBindings)
    {
    }

    /**
     * verify
     * ----------------
     * Validates a single-use Turnstile token with a timeout, one idempotent retry, and optional hostname binding.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
     */
    public async verify(
        token: string,
        remoteIp: string | null,
        idempotencyKey: string,
    ): Promise<void>
    {
        const secret = this.bindings.TURNSTILE_SECRET_KEY;

        if (secret === undefined || secret.length === 0)
        {
            throw new ApiError(503, "TURNSTILE_CONFIGURATION_MISSING", "Human verification is unavailable.");
        }

        for (let attempt = 1; attempt <= 2; attempt += 1)
        {
            const body = new FormData();
            body.set("idempotency_key", idempotencyKey);
            body.set("response", token);
            body.set("secret", secret);

            if (remoteIp !== null)
            {
                body.set("remoteip", remoteIp);
            }

            try
            {
                const response = await fetch(
                    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                    {
                        body,
                        method: "POST",
                        signal: AbortSignal.timeout(8_000),
                    },
                );

                if (!response.ok)
                {
                    if (attempt < 2 && response.status >= 500)
                    {
                        await waitForRetry();
                        continue;
                    }

                    break;
                }

                const result = turnstileResponseSchema.parse(await response.json());
                const expectedHostname = this.bindings.TURNSTILE_EXPECTED_HOSTNAME;

                if (
                    result.success
                    && result.action === "smartservice_chat"
                    && (
                        expectedHostname === undefined
                        || result.hostname === expectedHostname
                    )
                )
                {
                    return;
                }

                throw new ApiError(403, "TURNSTILE_INVALID", "Human verification was not accepted.");
            }
            catch (error: unknown)
            {
                if (error instanceof ApiError)
                {
                    throw error;
                }

                if (attempt < 2)
                {
                    await waitForRetry();
                    continue;
                }
            }
        }

        throw new ApiError(502, "TURNSTILE_UNAVAILABLE", "Human verification could not be completed.");
    }
}

/**
 * createTurnstileVerifier
 * ----------------
 * Selects live mandatory server validation or the explicit nonproduction fixture boundary.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
 */
export function createTurnstileVerifier(bindings: SmartServiceBindings): TurnstileVerifier
{
    return bindings.TURNSTILE_PROVIDER_MODE === "live"
        ? new CloudflareTurnstileVerifier(bindings)
        : new MockTurnstileVerifier();
}
