import { describe, expect, it } from "vitest";

import { parsePublicEnvironment } from "./public-environment";

describe("parsePublicEnvironment", () =>
{
    it("supports an intentionally unconfigured local shell", () =>
    {
        const result = parsePublicEnvironment({
            VITE_API_BASE_URL: "",
            VITE_SUPABASE_ANON_KEY: "",
            VITE_SUPABASE_URL: "",
        });

        expect(result.VITE_API_BASE_URL).toBeUndefined();
        expect(result.VITE_SUPABASE_URL).toBeUndefined();
    });

    it("rejects malformed public URLs", () =>
    {
        expect(() =>
        {
            parsePublicEnvironment({
                VITE_SUPABASE_ANON_KEY: "test-key",
                VITE_SUPABASE_URL: "not-a-url",
            });
        }).toThrow();
    });
});
