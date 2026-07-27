import { describe, expect, it } from "vitest";

import { createRuntimeServices } from "../src/services";
import type { SmartServiceBindings } from "../src/types";

describe("runtime services", () =>
{
    it("fails closed when deterministic ingestion providers are selected in production", () =>
    {
        expect(() => createRuntimeServices({
            ENVIRONMENT: "production",
            INGESTION_PROVIDER_MODE: "mock",
        } as SmartServiceBindings)).toThrowError(
            expect.objectContaining({
                code: "MOCK_MODE_FORBIDDEN",
                status: 503,
            }),
        );
    });
});
