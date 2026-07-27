import { describe, expect, it } from "vitest";

import {
    calculateStandardPages,
    countCjkCharacters,
    countEnglishWords,
    estimateTokenCount,
} from "./standard-pages";

describe("standard page calculation", () =>
{
    it("uses the locked CJK and English capacity definitions", () =>
    {
        const cjk = "泵".repeat(800);
        const english = Array.from({ length: 500 }, () => "pump").join(" ");

        expect(countCjkCharacters(cjk)).toBe(800);
        expect(countEnglishWords(english)).toBe(500);
        expect(calculateStandardPages(cjk)).toBe(1);
        expect(calculateStandardPages(english)).toBe(1);
        expect(calculateStandardPages(`${cjk} ${english}`)).toBe(2);
    });

    it("keeps a nonempty punctuation-only document above zero", () =>
    {
        expect(calculateStandardPages("---")).toBe(0.01);
        expect(calculateStandardPages("")).toBe(0);
        expect(estimateTokenCount("NF-500 operating limit")).toBeGreaterThan(0);
    });
});
