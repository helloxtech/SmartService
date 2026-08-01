import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { HelloXFeedbackDependencies } from "../src/hellox-feedback-routes";
import type { SmartServiceBindings } from "../src/types";

const identitySessionToken = `hxf_session_${"a".repeat(64)}`;
const identitySessionExpiry = "2026-08-01T20:00:00.000Z";

describe("HelloX Feedback identity session", () =>
{
    it("returns only the short-lived token after same-origin host authentication", async () =>
    {
        const authenticate = vi.fn<HelloXFeedbackDependencies["authenticate"]>(async () => ({
            organizationId: "11111111-1111-4111-8111-111111111111",
            role: "agent",
            userId: "22222222-2222-4222-8222-222222222222",
        }));
        const exchange = vi.fn<HelloXFeedbackDependencies["exchange"]>(async () => ({
            expiresAt: identitySessionExpiry,
            token: identitySessionToken,
        }));
        const app = createApp(undefined, { authenticate, exchange });
        const response = await app.fetch(
            new Request("https://smartservice.test/api/hellox-feedback/session", {
                headers: {
                    authorization: "Bearer verified-supabase-session",
                    origin: "https://smartservice.test",
                },
                method: "POST",
            }),
            {
                ENVIRONMENT: "development",
                VERSION: "0.10.0",
            } as SmartServiceBindings,
        );

        expect(response.status).toBe(201);
        expect(response.headers.get("cache-control")).toBe("no-store");
        await expect(response.json()).resolves.toEqual({
            expiresAt: identitySessionExpiry,
            token: identitySessionToken,
        });
        expect(authenticate).toHaveBeenCalledOnce();
        expect(exchange).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: "22222222-2222-4222-8222-222222222222",
            }),
            expect.any(Object),
        );
    });

    it("rejects a cross-origin identity-session request before authentication", async () =>
    {
        const authenticate = vi.fn<HelloXFeedbackDependencies["authenticate"]>();
        const exchange = vi.fn<HelloXFeedbackDependencies["exchange"]>();
        const app = createApp(undefined, { authenticate, exchange });
        const response = await app.fetch(
            new Request("https://smartservice.test/api/hellox-feedback/session", {
                headers: {
                    origin: "https://attacker.example",
                },
                method: "POST",
            }),
            {
                ENVIRONMENT: "development",
                VERSION: "0.10.0",
            } as SmartServiceBindings,
        );
        const body: unknown = await response.json();

        expect(response.status).toBe(403);
        expect(body).toMatchObject({
            error: {
                code: "FEEDBACK_ORIGIN_REJECTED",
            },
        });
        expect(authenticate).not.toHaveBeenCalled();
        expect(exchange).not.toHaveBeenCalled();
    });
});
