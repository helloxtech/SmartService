import { describe, expect, it } from "vitest";
import { isValidDay, moveWindow, normalizeWindow, positionForDay, windowFromPositions } from "./date-window";

describe("date window", () =>
{
    const first = "2026-01-01";
    const last = "2026-01-10";

    it("clamps and orders invalid boundaries", () =>
    {
        expect(normalizeWindow({ start: "2025-12-01", end: "2026-12-01" }, first, last)).toEqual({ start: first, end: last });
        expect(normalizeWindow({ start: "2026-01-08", end: "2026-01-03" }, first, last)).toEqual({ start: "2026-01-03", end: "2026-01-08" });
    });

    it("preserves range length when moving until a boundary", () =>
    {
        expect(moveWindow({ start: "2026-01-03", end: "2026-01-05" }, 20, first, last)).toEqual({ start: "2026-01-08", end: last });
        expect(moveWindow({ start: "2026-01-03", end: "2026-01-05" }, -20, first, last)).toEqual({ start: first, end: "2026-01-03" });
    });

    it("keeps a single-day snapshot valid", () =>
    {
        expect(windowFromPositions(0.2, 0.9, first, first)).toEqual({ start: first, end: first });
        expect(positionForDay(first, first, first)).toBe(0);
    });

    it("accepts only real ISO calendar days", () =>
    {
        expect(isValidDay("2026-02-28")).toBe(true);
        expect(isValidDay("2026-02-31")).toBe(false);
        expect(isValidDay("")).toBe(false);
    });
});
