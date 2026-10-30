import { z } from "zod";

export const metricSchema = z.object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
    unit: z.string().max(30),
    category: z.enum(["vitals", "body", "glucose", "lifestyle", "lab", "other"]),
    aggregation: z.enum(["mean", "sum", "latest"]),
});

export const readingSchema = z.object({
    id: z.string().min(1).max(100),
    metricId: z.string().min(1).max(100),
    timestamp: z.iso.datetime({ offset: true }),
    value: z.number().finite(),
    secondaryValue: z.number().finite().optional(),
    source: z.string().min(1).max(100),
    context: z.string().max(150).optional(),
    note: z.string().max(1000).optional(),
    referenceRange: z.string().max(150).optional(),
});

export const eventSchema = z.object({
    id: z.string().min(1).max(100),
    timestamp: z.iso.datetime({ offset: true }),
    type: z.enum(["symptom", "medication", "visit", "test", "note", "treatment"]),
    title: z.string().min(1).max(200),
    detail: z.string().max(2000),
    source: z.string().min(1).max(100),
    concern: z.string().max(200).optional(),
    concernId: z.string().max(100).optional(),
    severity: z.number().min(0).max(10).optional(),
});

export const reportSchema = z.object({
    version: z.literal(1),
    generatedAt: z.iso.datetime({ offset: true }),
    period: z.object({ start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }) }),
    patientLabel: z.string().min(1).max(100),
    timezone: z.string().min(1).max(100),
    metrics: z.array(metricSchema).max(100),
    readings: z.array(readingSchema).max(20000),
    events: z.array(eventSchema).max(3000),
    concerns: z.array(z.object({
        id: z.string().min(1).max(100),
        title: z.string().min(1).max(200),
        startDate: z.iso.datetime({ offset: true }),
        status: z.string().max(100),
        question: z.string().max(1000).optional(),
    })).max(100).default([]),
}).superRefine((report, ctx) =>
{
    try
    {
        new Intl.DateTimeFormat("en", { timeZone: report.timezone }).format(0);
    }
    catch
    {
        ctx.addIssue({ code: "custom", message: "Invalid report timezone", path: ["timezone"] });
    }
    const start = Date.parse(report.period.start);
    const end = Date.parse(report.period.end);
    const ids = new Set(report.metrics.map((metric) => metric.id));
    if (start > end || ids.size !== report.metrics.length)
    {
        ctx.addIssue({ code: "custom", message: "Invalid period or duplicate metrics" });
    }
    if (!report.readings.length && !report.events.length && !report.concerns.length)
    {
        ctx.addIssue({ code: "custom", message: "Select at least one record or concern" });
    }
    for (const reading of report.readings)
    {
        if (!ids.has(reading.metricId) || Date.parse(reading.timestamp) < start || Date.parse(reading.timestamp) > end)
        {
            ctx.addIssue({ code: "custom", message: "Reading outside shared scope" });
            break;
        }
    }
    if (report.events.some((event) => Date.parse(event.timestamp) < start || Date.parse(event.timestamp) > end))
    {
        ctx.addIssue({ code: "custom", message: "Event outside shared scope" });
    }
});

export type ReportMetric = z.infer<typeof metricSchema>;
export type ReportReading = z.infer<typeof readingSchema>;
export type ReportEvent = z.infer<typeof eventSchema>;
export type HealthReport = z.infer<typeof reportSchema>;

export const createShareSchema = z.object({
    report: reportSchema,
    durationMinutes: z.union([z.literal(15), z.literal(60), z.literal(240)]).default(60),
    consent: z.literal(true),
});

export interface CreatedShare
{
    shareId: string;
    code: string;
    ownerToken: string;
    expiresAt: string;
}

export interface CreatedRequest
{
    requestId: string;
    phrase: string;
    requestToken: string;
    expiresAt: string;
}

export interface PendingRequest
{
    requestId: string;
    phrase: string;
    expiresAt: string;
}

export type RequestStatus =
    | { status: "pending" | "denied" | "expired"; expiresAt?: string }
    | { status: "approved"; expiresAt: string; report: HealthReport };
