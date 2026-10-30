import { describe, expect, it } from "vitest";
import { demoReport } from "./demo";
import { filteredReport, localDay, shiftDay } from "./report-model";

describe("complete public demonstration report", () =>
{
    it("keeps measurement history useful without inventing readings in every recent range", () =>
    {
        const end = localDay(demoReport.period.end, demoReport.timezone);
        const recent = filteredReport(demoReport, shiftDay(end, -6), end, "all", "all");
        for (const metric of demoReport.metrics)
        {
            const history = demoReport.readings.filter((reading) => reading.metricId === metric.id);
            expect(history.length, metric.name).toBeGreaterThan(0);
            if (metric.category === "lab")
            {
                expect(history).toHaveLength(3);
                expect(recent.readings.some((reading) => reading.metricId === metric.id)).toBe(false);
            }
        }
    });
    it("uses distinct finite symptom episodes, including recorded recovery and natural gaps", () =>
    {
        for (const concern of demoReport.concerns)
        {
            const updates = demoReport.events.filter((event) => event.type === "symptom" && event.concernId === concern.id);
            expect(updates.length).toBeGreaterThanOrEqual(4);
            expect(updates.length).toBeLessThanOrEqual(8);
            expect(new Set(updates.map((event) => event.detail)).size).toBe(updates.length);
            expect(updates.every((event) => event.timestamp >= concern.startDate)).toBe(true);
            if (concern.status === "Settled") expect(updates.at(-1)?.severity).toBe(0);
        }
        expect(demoReport.events.some((event) => event.type === "test")).toBe(false);
    });
    it("covers all timeline event types with valid unique references", () =>
    {
        const end = localDay(demoReport.period.end, demoReport.timezone);
        const scoped = filteredReport(demoReport, shiftDay(end, -29), end, "all", "all");
        expect(new Set(scoped.events.map((event) => event.type))).toEqual(new Set(["symptom", "medication", "visit", "note", "treatment"]));
        expect(new Set(demoReport.events.map((event) => event.id)).size).toBe(demoReport.events.length);
        expect(new Set(demoReport.readings.map((reading) => reading.id)).size).toBe(demoReport.readings.length);
        expect(demoReport.events.every((event) => !event.concernId || demoReport.concerns.some((concern) => concern.id === event.concernId))).toBe(true);
        expect(demoReport.patientLabel).toContain("fictional");
    });
    it("keeps varied recording times within the report and linked events in sequence", () =>
    {
        const all = [...demoReport.readings, ...demoReport.events];
        expect(all.every((item) => item.timestamp >= demoReport.period.start && item.timestamp <= demoReport.period.end)).toBe(true);
        for (const metric of demoReport.metrics)
        {
            const times = demoReport.readings.filter((item) => item.metricId === metric.id).map((item) => item.timestamp.slice(11, 16));
            expect(new Set(times).size, metric.name).toBeGreaterThan(1);
        }
        for (const event of demoReport.events)
        {
            if (event.type === "test")
            {
                expect(event.timestamp).toBe(demoReport.readings.find((item) => `test-${item.id}` === event.id)?.timestamp);
            }
            if (event.type === "treatment")
            {
                const symptom = demoReport.events.find((item) => `action-${item.id}` === event.id);
                if (!symptom) throw new Error(`Missing symptom for ${event.id}`);
                expect(event.timestamp > symptom.timestamp).toBe(true);
                expect(localDay(event.timestamp, demoReport.timezone)).toBe(localDay(symptom.timestamp, demoReport.timezone));
            }
        }
    });

});
