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

    it("fails closed when one split knowledge provider remains deterministic in production", () =>
    {
        expect(() => createRuntimeServices({
            AUXILIARY_PROVIDER_MODE: "live",
            CHAT_PROVIDER_MODE: "live",
            CRAWL_PROVIDER_MODE: "live",
            EMBEDDING_PROVIDER_MODE: "mock",
            ENVIRONMENT: "production",
            INGESTION_PROVIDER_MODE: "live",
            TURNSTILE_PROVIDER_MODE: "live",
            UPLOAD_PROVIDER_MODE: "live",
            VOICE_PROVIDER_MODE: "live",
        } as SmartServiceBindings)).toThrowError(
            expect.objectContaining({
                code: "MOCK_MODE_FORBIDDEN",
                status: 503,
            }),
        );
    });
});
