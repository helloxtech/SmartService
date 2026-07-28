import { healthResponseSchema } from "@smartservice/contracts";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

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
});
