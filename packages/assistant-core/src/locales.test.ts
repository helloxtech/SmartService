import { describe, expect, it } from "vitest";

import { isSupportedLocale } from "./locales";

describe("isSupportedLocale", () =>
{
    it("accepts the two locked demo languages", () =>
    {
        expect(isSupportedLocale("zh-CN")).toBe(true);
        expect(isSupportedLocale("en")).toBe(true);
        expect(isSupportedLocale("multi")).toBe(false);
    });
});
