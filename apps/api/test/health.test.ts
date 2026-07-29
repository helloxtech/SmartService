import { healthResponseSchema } from "@smartservice/contracts";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import type { SmartServiceBindings } from "../src/types";

describe("health endpoint", () =>
{
    it(
        "runs inside the Workers runtime and returns the validated contract",
        async () =>
        {
            const response = await exports.default.fetch("https://smartservice.test/health", {
                headers: {
                    "x-request-id": "health-test-request",
                },
            });
            const body: unknown = await response.json();
            const health = healthResponseSchema.parse(body);

            expect(response.status).toBe(200);
            expect(response.headers.get("x-request-id")).toBe("health-test-request");
            expect(health.environment).toBe("development");
            expect(health.requestId).toBe("health-test-request");
        },
        10_000,
    );

    it("returns a bounded JSON error for an unknown API route", async () =>
    {
        const response = await exports.default.fetch("https://smartservice.test/api/unknown");
        const body: unknown = await response.json();

        expect(response.status).toBe(404);
        expect(body).toMatchObject({
            error: {
                code: "NOT_FOUND",
            },
        });
    });

    it("serves browser-safe Supabase configuration from runtime bindings", async () =>
    {
        const app = createApp();
        const response = await app.fetch(
            new Request("https://smartservice.test/api/public-config"),
            {
                ENVIRONMENT: "development",
                SUPABASE_ANON_KEY: "public-anon-key",
                SUPABASE_URL: "https://example.supabase.co",
                VERSION: "0.10.0",
            } as SmartServiceBindings,
        );
        const body: unknown = await response.json();

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(body).toEqual({
            supabaseAnonKey: "public-anon-key",
            supabaseUrl: "https://example.supabase.co",
        });
    });
});
