import { reportSchema, type HealthReport, type ReportReading, type ReportMetric, type ReportEvent } from "@shifa/contracts";

/**
 * day
 * ----------------
 * Produces synthetic timestamps inside a fixed 180-day demonstration period.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
function day(offset: number, hour = 15, minute = 0): string
{
    return new Date(Date.UTC(2026, 4, 2 + offset, hour, minute)).toISOString();
}
/**
 * recordedTime
 * ----------------
 * Varies fictional recording times reproducibly around a local routine. The
 * May–October demo period is entirely PDT (UTC−7); no patient data is changed.
 *
 * October 29, 2026: Created by Forrest Zhang for natural demo timestamps
 */
function recordedTime(offset: number, key: string, localMinute: number, spread = 45): string
{
    let seed = 2166136261;
    for (const character of `${offset}:${key}`)
    {
        seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
    }
    return day(offset, 7, localMinute + seed % (spread * 2 + 1) - spread);
}
const definitions: Array<[string, string, string, ReportMetric["category"], number, number, number]> = [
    ["bp", "Blood pressure", "mmHg", "vitals", 134, 6, 0.055],
    ["glucose", "Blood glucose", "mmol/L", "glucose", 7.3, 0.8, 0.003],
    ["heart", "Heart rate", "bpm", "vitals", 74, 5, 0.025],
    ["weight", "Weight", "kg", "body", 79, 0.45, 0.018],
    ["oxygen", "Blood oxygen", "%", "vitals", 97.5, 0.7, 0],
    ["temperature", "Temperature", "°C", "vitals", 36.6, 0.3, 0],
    ["sleep", "Sleep duration", "hours", "lifestyle", 6.6, 0.6, -0.004],
    ["steps", "Steps", "steps", "lifestyle", 4200, 1100, -12],
    ["activity", "Activity duration", "minutes", "lifestyle", 25, 10, -0.08],
    ["waist", "Waist circumference", "cm", "body", 92, 0.4, 0.015],
];
const metrics: ReportMetric[] = definitions.map(([id, name, unit, category]) => ({ id, name, unit, category, aggregation: ["steps", "activity", "water"].includes(id) ? "sum" : "mean" }));
const readings: ReportReading[] = [];
for (let offset = 0; offset < 180; offset++)
{
    for (const [index, definition] of definitions.entries())
    {
        const [id, , , category, base, amplitude, trend] = definition;
        if (id === "waist" && ![8, 43, 79, 113, 148, 176].includes(offset)) continue;
        if (id === "weight" && offset % 7 !== 1 && offset % 7 !== 5) continue;
        if (["oxygen", "temperature"].includes(id) && ![170, 171, 172, 174, 177].includes(offset)) continue;
        if (id === "glucose" && offset % 7 === 6) continue;
        if (id === "bp" && [6, 13, 37, 61, 62, 94, 117, 146, 157, 172].includes(offset)) continue;
        if (["heart", "sleep", "steps", "activity"].includes(id) && [31, 32, 78, 119, 120, 156].includes(offset)) continue;
        const variation = ((Math.imul(offset + 1, 2654435761) ^ Math.imul(index + 17, 1597334677)) >>> 0) % 1001 / 500 - 1;
        const kneeDay = offset >= 156 && offset <= 170;
        const raw = base + variation * amplitude - trend * offset
            + (id === "steps" && kneeDay ? -1800 : 0)
            + (id === "activity" && kneeDay ? -12 : 0)
            + (id === "sleep" && offset >= 150 && offset <= 161 ? -1.3 : 0);
        const value = ["bp", "heart", "steps", "activity", "oxygen"].includes(id) ? Math.round(raw) : Math.round(raw * 10) / 10;
        readings.push({ id: `${id}-${offset}`, metricId: id, timestamp: recordedTime(offset, id, ["steps", "activity", "water", "mood", "fatigue"].includes(id) ? 21 * 60 : 8 * 60), value,
            context: category === "lifestyle" ? "Daily diary total" : category === "body" ? "Morning check" : "Resting check",
            note: category === "lifestyle" ? "Daily total." : "Recorded at home.",
            source: ["heart", "sleep", "steps"].includes(id) ? "Wearable" : ["bp", "glucose", "oxygen", "peakFlow"].includes(id) ? "Home monitor" : "Patient entered",
            ...(id === "bp" ? { secondaryValue: Math.round(85 + variation * 4 - offset * 0.025), context: "Morning, seated" } : {}),
            ...(id === "glucose" ? { context: "Before breakfast" } : {}),
            ...(offset === 162 && id === "weight" ? { note: "Checked the unit on my scale and corrected this entry." } : {}),
        });
        if ((id === "bp" || id === "glucose") && offset % 3 === 0)
        {
            readings.push({ id: `${id}-${offset}-evening`, metricId: id, timestamp: recordedTime(offset, `${id}-evening`, 20 * 60, 65), value: id === "bp" ? value + 2 + offset % 5 : Math.round((value + 0.8 + offset % 4 * 0.3) * 10) / 10,
                source: "Home monitor", context: id === "bp" ? "Evening, seated" : "After meal", note: "Additional same-day reading recorded with its own time and context.",
                ...(id === "bp" ? { secondaryValue: Math.round(80 + variation * 4) } : {}),
            });
        }
    }
}
const labDefinitions: Array<[string, string, string, number, number]> = [
    ["a1c", "HbA1c", "%", 6.9, 6.6], ["ldl", "LDL cholesterol", "mmol/L", 3.1, 2.9],
    ["hdl", "HDL cholesterol", "mmol/L", 1.3, 1.4], ["triglycerides", "Triglycerides", "mmol/L", 1.8, 1.6],
    ["creatinine", "Creatinine", "µmol/L", 82, 80], ["egfr", "eGFR", "mL/min/1.73m²", 88, 90],
    ["hemoglobin", "Hemoglobin", "g/L", 139, 141], ["tsh", "TSH", "mIU/L", 2.1, 2.2],
];
for (const [id, name, unit, first, last] of labDefinitions)
{
    metrics.push({ id, name, unit, category: "lab", aggregation: "latest" });
    for (const offset of [8, 102, 166])
    {
        const value = offset === 8 ? first : offset === 166 ? last : Math.round((first + last) * 5) / 10;
        readings.push({ id: `${id}-${offset}`, metricId: id, timestamp: recordedTime(offset, "lab-collection", 10 * 60, 90), value, source: "Lab report", context: "Blood draw", note: "Result from my lab report." });
    }
}
const scenarios = [
    { id: "head", title: "Headache", onset: 145, status: "Comes and goes", question: "Could my headaches be related to long days at my desk?",
        entries: [[145, 4, "Headache after two hours at the computer. Lasted about 40 minutes."], [151, 2, "Mild headache after work. Went away after a break."], [163, 5, "Headache after a busy afternoon. Had to stop working for a while."], [170, 2, "Brief headache this afternoon. Able to finish my usual activities."], [178, 1, "Slight headache after work, gone within 15 minutes."]],
        action: "Stopped working and rested in a quiet room.", visit: 166 },
    { id: "knee", title: "Right knee pain", onset: 156, status: "Getting better", question: "When can I return to my usual longer walks?",
        entries: [[156, 6, "Right knee hurt after a long walk. Going downstairs was difficult."], [157, 5, "Still sore on stairs this morning. Walked less today."], [160, 4, "Able to walk around the house. Knee ached after standing to cook."], [163, 3, "A short walk was comfortable. Stairs still hurt a little."], [168, 5, "More sore after carrying groceries upstairs."], [171, 3, "Less pain today. Took a short, slow walk."], [175, 2, "Only noticed the knee when going downstairs."], [179, 1, "Walked for 20 minutes with little discomfort."]],
        action: "Sat down and rested my knee.", visit: 164 },
    { id: "sleep", title: "Trouble sleeping", onset: 150, status: "Getting better", question: "What can I do when I keep waking up at night?",
        entries: [[150, 5, "Woke up three times. Felt tired at breakfast."], [153, 6, "Awake for about an hour during the night. Tired at work."], [158, 4, "Woke twice, but got back to sleep more quickly."], [162, 3, "Woke once for about 20 minutes."], [168, 1, "Slept through most of the night and felt rested."]],
        action: "Noted my bedtime and how often I woke up.", visit: 166 },
    { id: "reflux", title: "Stomach discomfort", onset: 120, status: "Settled", question: "Could meal timing be related to the discomfort?",
        entries: [[120, 4, "Burning feeling in my upper stomach after a late dinner. Lasted 30 minutes."], [123, 3, "Similar discomfort after dinner, lasting about 15 minutes."], [129, 1, "Only a slight discomfort after eating today."], [137, 0, "No stomach discomfort this week."]],
        action: "Wrote down what I ate and when the discomfort started.", visit: 125 },
    { id: "back", title: "Lower back stiffness", onset: 72, status: "Settled", question: "How can I make long periods of sitting more comfortable?",
        entries: [[72, 5, "Back felt stiff after a long drive. Getting out of the car was uncomfortable."], [75, 3, "Stiff after sitting, but easier to move around today."], [81, 2, "Mild stiffness at the end of the workday."], [89, 0, "No back stiffness today. Back to my usual activities."]],
        action: "Stood up and took a short walk.", visit: undefined },
    { id: "nose", title: "Blocked nose", onset: 170, status: "Settled", question: "",
        entries: [[170, 4, "Blocked nose and sneezing since this morning."], [171, 5, "Nose was blocked overnight and disturbed my sleep."], [172, 3, "Breathing through my nose was easier this afternoon."], [174, 1, "Slightly blocked nose in the morning, clearer later."], [177, 0, "Nose feels clear again."]],
        action: "Rested at home.", visit: undefined },
] satisfies Array<{ id: string; title: string; onset: number; status: string; question: string; entries: Array<[number, number, string]>; action: string; visit: number | undefined }>;
const events: ReportEvent[] = [];
for (let offset = 0; offset < 180; offset++)
{
    if ([12, 45, 46, 83, 117, 158].includes(offset)) continue;
    const missed = [27, 91, 154].includes(offset);
    events.push({ id: `med-morning-${offset}`, timestamp: recordedTime(offset, "med-morning", 9 * 60, 35), type: "medication",
        title: missed ? "Amlodipine — missed" : "Amlodipine — taken",
        detail: missed ? "Missed my amlodipine while away from home." : "Took amlodipine after breakfast.",
        source: "Patient entered" });
    events.push({ id: `med-evening-${offset}`, timestamp: recordedTime(offset, "med-evening", 21 * 60, 40), type: "medication", title: "Metformin — taken",
        detail: "Took metformin with dinner.", source: "Patient entered" });
}
for (const scenario of scenarios)
{
    for (const [index, [offset, severity, detail]] of scenario.entries.entries())
    {
        const symptomTime = recordedTime(offset, scenario.id, scenario.id === "reflux" ? 21 * 60 : ["sleep", "nose"].includes(scenario.id) ? 9 * 60 : 16 * 60, 50);
        events.push({ id: `${scenario.id}-${offset}`, timestamp: symptomTime, type: "symptom", title: scenario.title, severity,
            detail, source: "Patient entered", concernId: scenario.id, concern: scenario.title });
        if (index === 0 || (scenario.id === "knee" && offset === 168))
        {
            events.push({ id: `action-${scenario.id}-${offset}`, timestamp: new Date(Date.parse(symptomTime) + 23 * 60000).toISOString(), type: "treatment", title: "What I did",
                detail: scenario.action, source: "Patient entered", concernId: scenario.id, concern: scenario.title });
        }
    }
    if (scenario.visit !== undefined)
    {
        events.push({ id: `visit-${scenario.id}`, timestamp: recordedTime(scenario.visit, "visit", 13 * 60, 110), type: "visit", title: "Doctor visit",
            detail: scenario.id === "knee" ? "Discussed when the knee pain started and which activities make it worse." : `Discussed ${scenario.title.toLowerCase()} and reviewed my notes.`,
            source: "Patient entered", concernId: scenario.id, concern: scenario.title });
    }
}
events.push({ id: "knee-question", timestamp: recordedTime(163, "question", 18 * 60), type: "note", title: "Question for my doctor",
    detail: "Should I shorten my walks while my knee is sore?", source: "Patient entered", concernId: "knee", concern: "Right knee pain" });
export const demoReport: HealthReport = reportSchema.parse({
    version: 1, generatedAt: day(179, 30, 59), period: { start: day(0, 7), end: day(179, 30, 59) },
    patientLabel: "Alex Morgan · fictional patient", timezone: "America/Vancouver", metrics,
    readings: readings.toSorted((a, b) => a.timestamp.localeCompare(b.timestamp)),
    events: events.toSorted((a, b) => a.timestamp.localeCompare(b.timestamp)),
    concerns: scenarios.map((scenario) => ({ id: scenario.id, title: scenario.title, startDate: recordedTime(scenario.onset, scenario.id, scenario.id === "reflux" ? 21 * 60 : ["sleep", "nose"].includes(scenario.id) ? 9 * 60 : 16 * 60, 50), status: scenario.status, question: scenario.question })),
});
