import { describe, expect, it } from "vitest";
import type { ReportEvent } from "@shifa/contracts";
import { eventsForSymptom, scopeSymptomEvents, symptomSeverityPoints, symptomTimelineGroups } from "./symptom-model";

/**
 * event
 * ----------------
 * Builds a minimal report event fixture for symptom visualisation model tests.
 *
 * October 29, 2026: Created by Forrest Zhang for Shifa symptom visualisation
 */
function event(id: string, timestamp: string, type: ReportEvent["type"], title: string, severity?: number): ReportEvent
{
    return { id, timestamp, type, title, detail: `${title} detail`, source: "Patient record", ...(severity === undefined ? {} : { severity }) };
}

describe("symptom visualisation model", () =>
{
    it("clips using the report timezone rather than the browser date", () =>
    {
        const scoped = scopeSymptomEvents([
            event("west", "2026-10-02T06:30:00Z", "note", "Local Oct 1"),
            event("inside", "2026-10-02T07:30:00Z", "note", "Local Oct 2"),
            event("after", "2026-10-03T07:30:00Z", "note", "Local Oct 3"),
        ], "2026-10-02", "2026-10-02", "America/Vancouver");
        expect(scoped.map((item) => item.id)).toEqual(["inside"]);
    });

    it("keeps zero severity and leaves absent severity absent", () =>
    {
        const points = symptomSeverityPoints([
            event("zero", "2026-10-02T12:00:00Z", "symptom", "No pain", 0),
            event("missing", "2026-10-02T13:00:00Z", "symptom", "Severity not recorded"),
        ], "2026-10-02", "2026-10-02", "UTC");
        expect(points).toHaveLength(1);
        expect(points[0]?.severity).toBe(0);
    });

    it("preserves all same-day events in their type group and count", () =>
    {
        const groups = symptomTimelineGroups([
            event("medicine-1", "2026-10-02T08:00:00Z", "medication", "Morning medication"),
            event("medicine-2", "2026-10-02T20:00:00Z", "medication", "Evening medication"),
            event("visit", "2026-10-02T15:00:00Z", "visit", "Clinic visit"),
        ], "2026-10-02", "2026-10-02", "UTC");
        expect(groups).toHaveLength(2);
        expect(groups[0]).toMatchObject({ day: "2026-10-02", type: "medication" });
        expect(groups[0]?.events.map((item) => item.id)).toEqual(["medicine-1", "medicine-2"]);
        expect(groups[1]?.events.map((item) => item.id)).toEqual(["visit"]);
    });
});

it("keeps a symptom timeline free of unrelated symptoms and unassigned records", () =>
{
    const stamp = "2026-10-02T12:00:00Z";
    const events = [
        { ...event("head", stamp, "symptom", "Headache", 3), concernId: "head" },
        { ...event("knee", stamp, "symptom", "Knee discomfort", 5), concernId: "knee" },
        event("unassigned", stamp, "symptom", "Unassigned symptom", 2),
        { ...event("outside", stamp, "symptom", "Concern not shared", 1), concernId: "not-shared" },
        event("med", stamp, "medication", "Recorded medication"),
    ];
    expect(eventsForSymptom(events, ["head", "knee"], "head").map((item) => item.id)).toEqual(["head"]);
    expect(eventsForSymptom(events, ["head", "knee"], undefined).map((item) => item.id)).toEqual(["unassigned", "outside", "med"]);
    expect(events).toHaveLength(5);
});
