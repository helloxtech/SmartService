import type { ReportEvent } from "@shifa/contracts";
import { localDay } from "./report-model";

export const symptomTimelineTypes = ["medication", "test", "visit", "treatment", "note"] as const;
export type SymptomTimelineType = typeof symptomTimelineTypes[number];
export type SymptomSeverityPoint = { id: string; timestamp: string; day: string; severity: number; event: ReportEvent };
export type SymptomTimelineGroup = { day: string; type: SymptomTimelineType; events: ReportEvent[] };

/**
 * scopeSymptomEvents
 * ----------------
 * Clips provided symptom-history events to the inclusive report-local date window
 * and keeps their absolute timestamp ordering. The component repeats this check
 * even though the dashboard normally supplies already scoped events.
 *
 * October 29, 2026: Created by Forrest Zhang for Shifa symptom visualisation
 */
export function scopeSymptomEvents(events: ReportEvent[], start: string, end: string, timezone: string): ReportEvent[]
{
    return events.filter((event) =>
    {
        const day = localDay(event.timestamp, timezone);
        return day >= start && day <= end;
    }).toSorted((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

/**
 * symptomSeverityPoints
 * ----------------
 * Extracts recorded symptom severity values without filling missing values or
 * averaging multiple symptom updates. A severity of zero is a valid record.
 *
 * October 29, 2026: Created by Forrest Zhang for Shifa symptom visualisation
 */
export function symptomSeverityPoints(events: ReportEvent[], start: string, end: string, timezone: string): SymptomSeverityPoint[]
{
    return scopeSymptomEvents(events, start, end, timezone).flatMap((event) =>
    {
        if (event.type !== "symptom" || event.severity === undefined) return [];
        return [{ id: event.id, timestamp: event.timestamp, day: localDay(event.timestamp, timezone), severity: event.severity, event }];
    });
}

/**
 * isTimelineType
 * ----------------
 * Narrows an event category to a lower-chart timeline lane.
 *
 * October 29, 2026: Created by Forrest Zhang for Shifa symptom visualisation
 */
export function isTimelineType(type: ReportEvent["type"]): type is SymptomTimelineType
{
    return symptomTimelineTypes.some((item) => item === type);
}

/**
 * symptomTimelineGroups
 * ----------------
 * Groups non-symptom events by their report-local day and lane while retaining
 * every source event for counts, click handling, and truthful tooltips.
 *
 * October 29, 2026: Created by Forrest Zhang for Shifa symptom visualisation
 */
export function symptomTimelineGroups(events: ReportEvent[], start: string, end: string, timezone: string): SymptomTimelineGroup[]
{
    const grouped = new Map<string, SymptomTimelineGroup>();
    for (const event of scopeSymptomEvents(events, start, end, timezone))
    {
        if (!isTimelineType(event.type)) continue;
        const day = localDay(event.timestamp, timezone);
        const key = `${day}:${event.type}`;
        const group = grouped.get(key);
        if (group) group.events.push(event);
        else grouped.set(key, { day, type: event.type, events: [event] });
    }
    return [...grouped.values()].toSorted((left, right) => left.day.localeCompare(right.day) || symptomTimelineTypes.indexOf(left.type) - symptomTimelineTypes.indexOf(right.type));
}

/**
 * eventsForSymptom
 * ----------------
 * Keeps only events explicitly linked to the focused concern, with a path for
 * symptoms whose concern is absent from the shared snapshot.
 * October 29, 2026: Created by Forrest Zhang for doctor visit review
 */
export function eventsForSymptom(events: ReportEvent[], knownIds: string[], activeId: string | undefined): ReportEvent[]
{
    const ids = new Set(knownIds);
    return events.filter((event) =>
    {
        const unassigned = !event.concernId || !ids.has(event.concernId);
        return activeId ? event.concernId === activeId : unassigned;
    });
}
