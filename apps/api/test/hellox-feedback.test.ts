import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import {
    exchangeFeedbackIdentity,
    type HelloXFeedbackDependencies,
} from "../src/hellox-feedback-routes";
import type { SmartServiceBindings } from "../src/types";

const identitySessionToken = `hxf_session_${"a".repeat(64)}`;
const identitySessionExpiry = "2026-08-01T20:00:00.000Z";

describe("HelloX Feedback identity session", () =>
{
    it("returns only the short-lived token after same-origin host authentication", async () =>
    {
        const authenticate = vi.fn<HelloXFeedbackDependencies["authenticate"]>(async () => ({
            email: "agent@smartservice.ca",
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
                email: "agent@smartservice.ca",
                userId: "22222222-2222-4222-8222-222222222222",
            }),
            expect.any(Object),
        );
    });

    it("sends account email only through the verified server identity exchange", async () =>
    {
        const fetchMock = vi.fn<typeof fetch>(async () => new Response(
            JSON.stringify({
                expiresAt: identitySessionExpiry,
                token: identitySessionToken,
            }),
            { status: 201 },
        ));
        vi.stubGlobal("fetch", fetchMock);

        await expect(exchangeFeedbackIdentity({
            email: "agent@smartservice.ca",
            organizationId: "11111111-1111-4111-8111-111111111111",
            role: "agent",
            userId: "22222222-2222-4222-8222-222222222222",
        }, {
            HELLOX_FEEDBACK_SERVER_KEY: `hxf_server_${"b".repeat(64)}`,
            VERSION: "0.10.0",
        } as SmartServiceBindings)).resolves.toEqual({
            expiresAt: identitySessionExpiry,
            token: identitySessionToken,
        });

        const request = fetchMock.mock.calls[0];
        expect(request?.[0]).toBe(
            "https://delivery.hellox.ca/api/feedback/v1/sessions",
        );
        expect(JSON.parse(String(request?.[1]?.body))).toEqual({
            email: "agent@smartservice.ca",
            issuer: "smartservice-supabase",
            origin: "https://smartservice.ca",
            subject: "22222222-2222-4222-8222-222222222222",
        });
        expect(String(request?.[1]?.body)).not.toContain("hxf_server_");
        vi.unstubAllGlobals();
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
