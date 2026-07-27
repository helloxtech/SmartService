import { describe, expect, it } from "vitest";

import { healthResponseSchema } from "./system";

describe("healthResponseSchema", () =>
{
    it("accepts the public health contract", () =>
    {
        const result = healthResponseSchema.safeParse({
            environment: "test",
            requestId: "request-1",
            service: "smartservice-api",
            status: "ok",
            timestamp: "2026-07-26T20:00:00.000Z",
            version: "0.1.0",
        });

        expect(result.success).toBe(true);
    });
});
