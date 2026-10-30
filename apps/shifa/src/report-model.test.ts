import { reportSchema, type ReportReading } from "@shifa/contracts";
import { demoReport } from "./demo";
import { describe, expect, it } from "vitest";
import { chartReadings, localDay, dayBoundary, filteredReport } from "./report-model";

const reading = (
    id: string,
    timestamp: string,
    value: number,
    secondaryValue?: number,
): ReportReading => ({
    id,
    metricId: "bp",
    timestamp,
    value,
    ...(secondaryValue === undefined ? {} : { secondaryValue }),
    source: "Home monitor",
});

describe("Shifa report display model", () => 
{
    it("keeps missing days absent and averages paired BP readings without deduplication", () => 
    {
        const points = chartReadings(
            [
                reading("a", "2026-10-10T08:00:00-07:00", 130, 82),
                reading("b", "2026-10-10T20:00:00-07:00", 120, 78),
            ],
            "day",
            "America/Vancouver",
            "mean",
        );
        expect(points).toHaveLength(1);
        expect(points[0]?.value).toBe(125);
        expect(points[0]?.secondaryValue).toBe(80);
    });
    it("uses a metric sum only when the metric declares sum", () => 
    {
        const points = chartReadings(
            [
                reading("a", "2026-10-10T08:00:00-07:00", 2),
                reading("b", "2026-10-10T20:00:00-07:00", 3),
            ],
            "day",
            "America/Vancouver",
            "sum",
        );
        expect(points[0]?.value).toBe(5);
    });
    it("derives day keys in the report timezone", () => 
    {
        expect(localDay("2026-10-11T06:30:00Z", "America/Vancouver")).toBe(
            "2026-10-10",
        );
    });
});

describe("report scope and calendar boundaries", () => 
{
    it("sorts latest values and preserves sample counts across ISO week boundaries", () => 
    {
        const points = chartReadings([
            reading("b", "2026-01-02T18:00:00Z", 20),
            reading("a", "2025-12-31T18:00:00Z", 10),
        ], "week", "America/Vancouver", "latest");
        expect(points).toHaveLength(1);
        expect(points[0]?.value).toBe(20);
        expect(points[0]?.periodStart).toBe("2025-12-29");
        expect(points[0]?.periodEnd).toBe("2026-01-04");
        expect(points[0]?.timestamp).toBe("2025-12-29T08:00:00.000Z");
        expect(points[0]?.context).toContain("n=2");
    });
});

it("resolves Vancouver DST midnights and shared scope accurately", () => 
{
    expect(new Date(dayBoundary("2026-11-01", "America/Vancouver")).toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(new Date(dayBoundary("2026-11-02", "America/Vancouver")).toISOString()).toBe("2026-11-02T08:00:00.000Z");
    const scoped = filteredReport(demoReport,"2026-10-01","2026-10-07","all","Before breakfast");
    expect(scoped.readings.length).toBeGreaterThan(0);
    expect(scoped.readings.every((item) => item.context === "Before breakfast")).toBe(true);
    expect(scoped.events.every((item) => localDay(item.timestamp, demoReport.timezone) >= "2026-10-01" && localDay(item.timestamp, demoReport.timezone) <= "2026-10-07")).toBe(true);
    expect(demoReport.metrics.length).toBe(24);
});

it("sorts absolute instants across different recorded UTC offsets", () =>
{
    const points = chartReadings([reading("later", "2026-10-10T08:00:00-07:00", 130), reading("earlier", "2026-10-10T10:00:00Z", 120)], "day", "UTC", "latest");
    expect(points[0]?.value).toBe(130);
});
it("rejects unsupported timezones before a report reaches the dashboard", () =>
{
    expect(reportSchema.safeParse({ ...demoReport, timezone: "invalid/not-a-zone" }).success).toBe(false);
});
