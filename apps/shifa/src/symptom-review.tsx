import { useState } from "react";
import type { HealthReport, ReportEvent } from "@shifa/contracts";
import { eventsForSymptom } from "./symptom-model";
import { SymptomChart } from "./symptom-chart";
import { dayBoundary, localDay } from "./report-model";

type Props = {
    concerns: HealthReport["concerns"]; events: ReportEvent[]; start: string; end: string;
    timezone: string; language: "en" | "zh"; source: string;
    selection: { start: string; end: string } | undefined;
    onSelectDay(day: string): void; onClear(): void;
    focused: string; onFocus(id: string): void; overview?: boolean; onOpen(): void;
};
const labels = { symptom: ["Symptom", "症状"], medication: ["Medication", "用药"], test: ["Examination", "检查"], visit: ["Visit", "复诊"], treatment: ["Recorded action", "处理记录"], note: ["Note", "备注"] };

/**
 * SymptomReview
 * ----------------
 * Keeps period-level symptom facts separate from a selected day's details.
 * One focused symptom shows only its explicitly linked event history.
 * October 29, 2026: Created by Forrest Zhang for doctor visit review
 */
export function SymptomReview({ concerns, events, start, end, timezone, language, source, selection, onSelectDay, onClear, focused, onFocus, overview = false, onOpen }: Props)
{
    const zh = language === "zh";
    const [view, setView] = useState<"visual" | "records">("visual");
    const knownIds = concerns.map((item) => item.id);
    const otherSymptoms = events.filter((event) => event.type === "symptom" && (!event.concernId || !knownIds.includes(event.concernId)));
    const active = focused === "" && otherSymptoms.length ? undefined : concerns.find((item) => item.id === focused) ?? concerns[0];
    const scoped = eventsForSymptom(events, knownIds, active?.id);
    const observations = scoped.filter((event) => event.type === "symptom" && event.severity !== undefined);
    const latestEvent = scoped.at(-1);
    const latestDay = latestEvent ? localDay(latestEvent.timestamp, timezone) : end;
    const detailStart = selection?.start ?? latestDay;
    const detailEnd = selection?.end ?? latestDay;
    const details = (view === "records" ? events : scoped).filter((event) => view === "records" || (localDay(event.timestamp, timezone) >= detailStart && localDay(event.timestamp, timezone) <= detailEnd)).toSorted((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const symptomDetails = details.filter((event) => event.type === "symptom");
    const dayEvents = details.filter((event) => event.type !== "symptom");
    const date = new Intl.DateTimeFormat(zh ? "zh-CN" : "en-CA", { timeZone: timezone, month: "short", day: "numeric" });
    const dateTime = new Intl.DateTimeFormat(zh ? "zh-CN" : "en-CA", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return <section className={`symptom-review ${overview ? "symptom-review--overview" : ""}`} aria-label={zh ? "症状跟踪" : "Symptom follow-up"}>
        <header className="symptom-review-heading"><div><p className="eyebrow">{zh ? "患者记录的变化" : "PATIENT-RECORDED CHANGES"}</p><h2>{zh ? "症状跟踪" : "Symptom follow-up"}</h2></div>{overview ? <button className="symptom-open" onClick={onOpen}>{zh ? "查看趋势与事件 →" : "Explore symptoms & events →"}</button> : <span>{date.format(dayBoundary(start, timezone))} – {date.format(dayBoundary(end, timezone))} · {source === "all" ? (zh ? "全部来源" : "All sources") : source}</span>}</header>
        <div className="symptom-workspace">
            <div className="symptom-index" role="group" aria-label={zh ? "选择症状" : "Choose a symptom"}>
                {concerns.map((item) =>
                {
                    const points = events.filter((event) => event.concernId === item.id && event.type === "symptom" && event.severity !== undefined);
                    const first = points[0]; const last = points.at(-1);
                    return <button key={item.id} className={`symptom-choice ${active?.id === item.id ? "active" : ""}`} aria-pressed={active?.id === item.id} onClick={() =>
                    {
                        onFocus(item.id); onClear(); if (overview) onOpen();
                    }}><span className="symptom-choice-title">{item.title}</span><span className="symptom-choice-value">{last ? `${last.severity}` : "—"}<small>/10</small></span><span className="symptom-choice-meta">{last ? `${date.format(new Date(last.timestamp))} · ${points.length} ${zh ? "次记录" : "entries"}` : (zh ? "此范围无严重度记录" : "No severity in this range")}</span>{item.question && <span className="symptom-choice-question" title={item.question}>{zh ? "想问：" : "Question: "}{item.question}</span>}{!overview && <span className="symptom-choice-history">{first && last ? `${zh ? "首次 → 最新" : "First → latest"}: ${first.severity} → ${last.severity}` : (zh ? "未记录不等于 0" : "Not recorded is not zero")}</span>}</button>;
                })}
                {!!otherSymptoms.length && <button className={`symptom-choice ${!active ? "active" : ""}`} aria-pressed={!active} onClick={() =>
                {
                    onFocus(""); onClear(); if (overview) onOpen();
                }}><span className="symptom-choice-title">{zh ? "其他症状记录" : "Other symptom records"}</span><span className="symptom-choice-meta">{otherSymptoms.length} {zh ? "条未关联症状的记录" : "entries without a shared concern"}</span></button>}
                {!concerns.length && !otherSymptoms.length && <p>{zh ? "只有事件记录" : "Event records only"}</p>}
            </div>
            {!overview && <div className="symptom-focus">
                <header className="symptom-focus-heading"><h3>{active?.title ?? (zh ? "症状与事件" : "Symptoms & events")}</h3>{active && <span>{zh ? "开始于" : "Started"} {date.format(new Date(active.startDate))} · {active.status}</span>}{active?.question && <p><strong>{zh ? "患者想问" : "Patient question"}:</strong> {active.question}</p>}</header>
                <nav className="symptom-view-tabs" aria-label={zh ? "症状视图" : "Symptom views"}><button aria-current={view === "visual" ? "page" : undefined} onClick={() => setView("visual")}>{zh ? "趋势与事件" : "Trends & events"}</button><button aria-current={view === "records" ? "page" : undefined} onClick={() => setView("records")}>{zh ? "全部症状与事件记录" : "All symptom & event records"} <span>{events.length}</span></button></nav>
                {view === "visual" && <><div className="symptom-chart-heading"><strong>{zh ? "患者自评严重程度 · 0–10" : "Patient-reported severity · 0–10"}</strong><span>{observations.length} {zh ? "次评分" : "ratings"}</span></div>{!observations.length && <p className="symptom-empty">{zh ? "所选范围没有严重度评分；下面仍显示已记录的事件。" : "No severity ratings in this period; recorded events remain visible below."}</p>}<SymptomChart connectSeverity={!!active} events={scoped} start={start} end={end} timezone={timezone} language={language} selection={selection} onSelectDay={onSelectDay} /><p className="symptom-chart-caption">{zh ? "点击数据点查看当天记录。下方只显示与所选症状相关的记录。" : "Hover over a point for its description. Select it to read the symptom details and that day’s events below."}</p></>}
                <div className="symptom-records-heading"><h3>{view === "records" ? (zh ? "所选期间的全部记录" : "All records in this period") : `${selection ? (zh ? "所选日期" : "Selected day") : (zh ? "最近记录日" : "Latest recorded day")} · ${date.format(dayBoundary(detailStart, timezone))}${detailEnd !== detailStart ? ` – ${date.format(dayBoundary(detailEnd, timezone))}` : ""}`}</h3><span>{details.length} {zh ? "条记录" : "records"}</span>{view === "visual" && selection && <button onClick={onClear}>{zh ? "清除日期选择" : "Clear day selection"}</button>}</div>
                {view === "visual" && <>
                    <label className="symptom-day-picker">Select day <select aria-label="Select symptom day" value={detailStart} onChange={(event) =>
                    {
                        const value = event.target.value;
                        if (value && value >= start && value <= end) onSelectDay(value);
                    }}>{[...new Set([detailStart, ...scoped.map((event) => localDay(event.timestamp, timezone))])].sort().reverse().map((day) => <option key={day} value={day}>{date.format(dayBoundary(day, timezone))}</option>)}</select></label>
                    <section className="selected-symptom-details" aria-label="Selected day symptom details"><h3>Symptom details</h3>{symptomDetails.map((event) => <article key={event.id}><header><time>{dateTime.format(new Date(event.timestamp))}</time><strong>{event.severity !== undefined ? `Severity ${event.severity}/10` : "Severity not recorded"}</strong></header><h4>{event.title}</h4><p>{event.detail}</p></article>)}{!symptomDetails.length && <p>No symptom description recorded for this day.</p>}</section>
                    <section className="selected-day-timeline" aria-label="Selected day event timeline"><h3>{active ? "What happened that day" : "Other records that day"}</h3><ol>{dayEvents.map((event) => <li key={event.id}><time>{dateTime.format(new Date(event.timestamp))}</time><div><span>{labels[event.type][0]}</span><h4>{event.title}</h4><p>{event.detail}</p><small>{event.source}</small></div></li>)}</ol>{!dayEvents.length && <p>No additional updates for this day.</p>}</section>
                </>}
                {view === "records" && <div className="symptom-event-grid"><table><thead><tr><th>{zh ? "日期与时间" : "Date & time"}</th><th>{zh ? "类型" : "Type"}</th><th>{zh ? "记录详情" : "Recorded detail"}</th></tr></thead><tbody>{details.map((event) => <tr key={event.id}><td><button onClick={() =>
                {
                    onFocus(event.concernId && knownIds.includes(event.concernId) ? event.concernId : event.type === "symptom" ? "" : focused); onSelectDay(localDay(event.timestamp, timezone)); setView("visual");
                }}>{dateTime.format(new Date(event.timestamp))}</button></td><td><span className={`event-type event-type--${event.type}`}>{labels[event.type][zh ? 1 : 0]}</span>{!event.concernId && <small>{zh ? "未关联症状" : "Unassigned"}</small>}</td><td><strong>{event.title}{event.severity !== undefined ? ` · ${event.severity}/10` : ""}</strong><p>{event.detail}</p><small>{event.source}</small></td></tr>)}</tbody></table>{!details.length && <p className="symptom-empty">{zh ? "所选日期没有符合筛选的记录。" : "No records match this date and filter."}</p>}</div>}
            </div>}
        </div>
    </section>;
}
