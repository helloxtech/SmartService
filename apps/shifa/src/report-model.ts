import type { HealthReport, ReportMetric, ReportReading } from "@shifa/contracts";
export type Aggregate = "raw" | "day" | "week";
export type ChartReading = ReportReading & { periodStart?: string; periodEnd?: string; sampleCount?: number };

/**
 * localDay
 * ----------------
 * Returns a calendar date in the patient's report timezone.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export function localDay(iso: string, timezone: string): string
{
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/**
 * shiftDay
 * ----------------
 * Shifts calendar dates without the browser's timezone or DST changing the day.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export function shiftDay(day: string, offset: number): string
{
    const date = new Date(`${day}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
}

/**
 * chartReadings
 * ----------------
 * Aggregates chronological observations with explicit sample counts and no filled gaps.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export function chartReadings(readings: ReportReading[], aggregation: Aggregate, timezone: string, mode: ReportMetric["aggregation"]): ChartReading[]
{
    const sorted = readings.toSorted((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    if (aggregation === "raw") return sorted;
    const groups = new Map<string, ReportReading[]>();
    for (const reading of sorted)
    {
        const day = localDay(reading.timestamp, timezone);
        const mondayOffset = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
        const key = aggregation === "week" ? shiftDay(day, -mondayOffset) : day;
        groups.set(key, [...(groups.get(key) ?? []), reading]);
    }
    return [...groups.entries()].flatMap(([periodStart, group]) =>
    {
        const last = group.at(-1);
        if (!last) return [];
        const secondaries = group.flatMap((item) => item.secondaryValue === undefined ? [] : [item.secondaryValue]);
        const value = mode === "latest" ? last.value : group.reduce((sum, item) => sum + item.value, 0) / (mode === "sum" ? 1 : group.length);
        return [{ ...last, value, timestamp: new Date(dayBoundary(periodStart, timezone)).toISOString(), periodStart, periodEnd: aggregation === "week" ? shiftDay(periodStart, 6) : periodStart, sampleCount: group.length,
            ...(secondaries.length ? { secondaryValue: mode === "latest" ? last.secondaryValue : secondaries.reduce((sum, item) => sum + item, 0) / (mode === "sum" ? 1 : secondaries.length) } : {}),
            source: new Set(group.map((item) => item.source)).size === 1 ? last.source : "Multiple sources",
            context: `${aggregation} · ${mode} · n=${group.length}`,
        }];
    });
}

/**
 * filteredReport
 * ----------------
 * Applies the same date and source scope to all visualisations and events.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export function filteredReport(report: HealthReport, start: string, end: string, source: string, context: string): HealthReport
{
    return { ...report,
        readings: report.readings.filter((item) =>
        {
            const day = localDay(item.timestamp, report.timezone);
            return day >= start && day <= end && (source === "all" || source === item.source) && (context === "all" || context === item.context);
        }).toSorted((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)),
        events: report.events.filter((item) =>
        {
            const day = localDay(item.timestamp, report.timezone);
            return day >= start && day <= end && (source === "all" || source === item.source);
        }).toSorted((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)),
    };
}

/**
 * dayBoundary
 * ----------------
 * Resolves patient-local midnight across DST without using browser-local dates.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export function dayBoundary(day: string, timezone: string): number
{
    const target = Date.parse(`${day}T00:00:00Z`);
    let guess = target;
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    for (let pass = 0; pass < 3; pass++)
    {
        const parts = Object.fromEntries(formatter.formatToParts(guess).map((part) => [part.type, part.value]));
        const localAsUTC = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
        guess += target - localAsUTC;
    }
    return guess;
}
