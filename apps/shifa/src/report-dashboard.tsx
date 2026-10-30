import { useMemo, useState } from "react";
import type { HealthReport, ReportMetric, ReportReading } from "@shifa/contracts";
import { ClinicalChart } from "./clinical-chart";
import { SymptomReview } from "./symptom-review";
import { DateNavigator } from "./date-navigator";
import { Activity, ArrowDown, ArrowUp, CalendarDays, ChevronRight, GripVertical, Maximize2, Minimize2, RotateCcw, Table2, X, Printer } from "lucide-react";
import { filteredReport, localDay, shiftDay, dayBoundary, type Aggregate, type ChartReading } from "./report-model";
type Language = "en" | "zh";

/**
 * formattedDate
 * ----------------
 * Formats observations in the report timezone, including time when requested.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
function formattedDate(value: string, language: Language, timezone: string, time = false): string
{
    return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-CA", { timeZone: timezone, month: "short", day: "numeric", year: "numeric", ...(time ? { hour: "numeric", minute: "2-digit" } : {}) }).format(new Date(value));
}

/**
 * number
 * ----------------
 * Formats finite recorded values without implying more measurement precision.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
function number(value: number): string
{
    return Number(value.toFixed(1)).toLocaleString();
}

/**
 * pair
 * ----------------
 * Displays paired blood-pressure values together.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
function pair(item: ReportReading | undefined): string
{
    return item ? `${item.value.toLocaleString(undefined, { maximumSignificantDigits: 15 })}${item.secondaryValue === undefined ? "" : ` / ${item.secondaryValue.toLocaleString(undefined, { maximumSignificantDigits: 15 })}`}` : "—";
}

/**
 * meanPair
 * ----------------
 * Summarizes observed samples only and keeps paired observations aligned.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
function meanPair(items: ReportReading[]): string
{
    if (!items.length) return "—";
    const paired = items.some((item) => item.secondaryValue !== undefined);
    const group = paired ? items.filter((item) => item.secondaryValue !== undefined) : items;
    return `${number(group.reduce((sum, item) => sum + item.value, 0) / group.length)}${paired ? ` / ${number(group.reduce((sum, item) => sum + (item.secondaryValue ?? 0), 0) / group.length)}` : ""}`;
}

/**
 * ReportDashboard
 * ----------------
 * Presents one selected visit report with linked, consistently scoped views.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export function ReportDashboard({ report, demo, language, close, expiresAt }: { report: HealthReport; demo: boolean; language: Language; close(): void; expiresAt: string | undefined })
{
    const zh = language === "zh";
    const [tab, setTab] = useState("trends");
    const [start, setStart] = useState([localDay(report.period.start, report.timezone), shiftDay(localDay(report.period.end, report.timezone), -29)].sort().at(-1) ?? localDay(report.period.start, report.timezone));
    const [end, setEnd] = useState(localDay(report.period.end, report.timezone));
    const [source, setSource] = useState("all");
    const [context, setContext] = useState("all");
    const [aggregation, setAggregation] = useState<Aggregate>("raw");
    const [selected, setSelected] = useState<Pick<ChartReading, "timestamp" | "periodStart" | "periodEnd">>();
    const [chosen, setChosen] = useState(report.metrics.slice(0, 4).map((item) => item.id));
    const [order, setOrder] = useState(report.metrics.map((item) => item.id));
    const [dragged, setDragged] = useState<string>();
    const [search, setSearch] = useState("");
    const [focusedConcern, setFocusedConcern] = useState(report.concerns[0]?.id ?? "");
    const [ascending, setAscending] = useState(false);
    const [expanded, setExpanded] = useState<string>();
    const [recordsMetric, setRecordsMetric] = useState<string>();
    const firstDay = localDay(report.period.start, report.timezone);
    const lastDay = localDay(report.period.end, report.timezone);
    const from = start;
    const to = end;
    const filtered = useMemo(() => filteredReport(report, from, to, source, context), [report, from, to, source, context]);
    const selectedDay = selected ? localDay(selected.timestamp, report.timezone) : undefined;
    const selectedEnd = selectedDay ? [selected?.periodEnd ?? selectedDay, to].sort()[0] : undefined;
    const selectedStart = selectedDay ? [selected?.periodStart ?? selectedDay, from].sort().at(-1) : undefined;
    const selectedMetrics = order.flatMap((id) => chosen.includes(id) ? report.metrics.filter((item) => item.id === id) : []);
    const sources = [...new Set([...report.readings, ...report.events].map((item) => item.source))];
    const contexts = [...new Set(report.readings.flatMap((item) => item.context ? [item.context] : []))];
    const relatedEvents = filtered.events.filter((item) => (!selectedDay || (localDay(item.timestamp, report.timezone) >= (selectedStart ?? "") && localDay(item.timestamp, report.timezone) <= (selectedEnd ?? ""))));
    const rows = filtered.readings.filter((item) => (recordsMetric ? item.metricId === recordsMetric : chosen.includes(item.metricId)) && (!selectedDay || (localDay(item.timestamp, report.timezone) >= (selectedStart ?? "") && localDay(item.timestamp, report.timezone) <= (selectedEnd ?? "")))).toSorted((a, b) => ascending ? Date.parse(a.timestamp) - Date.parse(b.timestamp) : Date.parse(b.timestamp) - Date.parse(a.timestamp));
    const categories: Array<[ReportMetric["category"], string]> = [["vitals", zh ? "生命体征" : "Vital signs"], ["glucose", zh ? "血糖" : "Blood glucose"], ["body", zh ? "身体测量" : "Body measurements"], ["lifestyle", zh ? "日常生活" : "Daily wellbeing"], ["other", zh ? "其他指标" : "Other measures"], ["lab", zh ? "检查结果" : "Lab results"]];
    /**
     * zoom
     * ----------------
     * Applies chart brushing to all views and clears a stale point selection.
     *
     * October 28, 2026: Created by Forrest Zhang for Shifa health reports
     */
    function zoom(nextStart: string, nextEnd: string)
    {
        setStart(nextStart < firstDay ? firstDay : nextStart); setEnd(nextEnd > lastDay ? lastDay : nextEnd); setSelected(undefined);
    }
    /**
     * reset
     * ----------------
     * Restores the initial view without changing any report records.
     *
     * October 28, 2026: Created by Forrest Zhang for Shifa health reports
     */
    function reset()
    {
        setStart([firstDay, shiftDay(lastDay, -29)].sort().at(-1) ?? firstDay); setEnd(lastDay); setExpanded(undefined); setSource("all"); setContext("all"); setAggregation("raw"); setSelected(undefined); setFocusedConcern(report.concerns[0]?.id ?? ""); setChosen(report.metrics.slice(0, 4).map((item) => item.id)); setOrder(report.metrics.map((item) => item.id)); setSearch(""); setRecordsMetric(undefined);
    }
    /**
     * move
     * ----------------
     * Reorders charts with a keyboard-accessible alternative to dragging.
     *
     * October 28, 2026: Created by Forrest Zhang for Shifa health reports
     */
    function move(id: string, delta: number)
    {
        const visibleOrder = selectedMetrics.map((item) => item.id);
        const position = visibleOrder.indexOf(id);
        const other = visibleOrder[position + delta];
        if (!other) return;
        const updated = [...order];
        const a = updated.indexOf(id); const b = updated.indexOf(other);
        updated[a] = other; updated[b] = id; setOrder(updated);
    }
    const focusReadings = filtered.readings.filter((item) => chosen.includes(item.metricId) && (!selectedStart || (localDay(item.timestamp, report.timezone) >= selectedStart && localDay(item.timestamp, report.timezone) <= (selectedEnd ?? selectedStart))));
    const scopeDays = new Set((tab === "symptoms" ? filtered.events : focusReadings).map((item) => localDay(item.timestamp, report.timezone))).size;
    const selection = selectedStart && selectedEnd ? { start: selectedStart, end: selectedEnd } : undefined;
    /**
     * renderChart
     * ----------------
     * Draws one unit-specific visual with focus, data inspection and accessible ordering.
     *
     * October 28, 2026: Updated by Forrest Zhang for Shifa Power BI interaction review
     */
    function renderChart(metric: ReportMetric)
    {
        const points = filtered.readings.filter((item) => item.metricId === metric.id);
        const facts = focusReadings.filter((item) => item.metricId === metric.id);
        return <article key={metric.id} className={`measure-panel ${expanded === metric.id ? "expanded-chart" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) =>
        {
            event.preventDefault();
            if (!dragged || dragged === metric.id) return;
            const updated = order.filter((id) => id !== dragged);
            updated.splice(updated.indexOf(metric.id), 0, dragged); setOrder(updated); setDragged(undefined);
        }}>
            <header className="measure-heading">
                <div className="visual-title"><span className="chart-grip" draggable onDragStart={() => setDragged(metric.id)} title={zh ? "拖动排列图表" : "Drag to reorder charts"}><GripVertical size={17} /></span><div><h2>{metric.name}</h2><p>{metric.unit} · {points.length} {zh ? "次测量" : "readings"}{aggregation !== "raw" ? ` · ${aggregation === "week" ? (zh ? "按周" : "Weekly") : (zh ? "按日" : "Daily")} ${metric.aggregation === "sum" ? (zh ? "合计" : "total") : metric.aggregation === "latest" ? (zh ? "末次值" : "last value") : (zh ? "均值" : "mean")}` : ""}</p></div></div>
                <div className="visual-actions">
                    <button aria-label={`${metric.name}: ${zh ? "查看数据" : "View data"}`} title={zh ? "查看原始记录" : "View underlying records"} onClick={() =>
                    {
                        setRecordsMetric(metric.id); setExpanded(undefined); setTab("records");
                    }}><Table2 size={15} /></button>
                    <button aria-label={`${metric.name}: ${zh ? "上移" : "Move earlier"}`} disabled={selectedMetrics[0]?.id === metric.id} onClick={() => move(metric.id, -1)}><ArrowUp size={14} /></button>
                    <button aria-label={`${metric.name}: ${zh ? "下移" : "Move later"}`} disabled={selectedMetrics.at(-1)?.id === metric.id} onClick={() => move(metric.id, 1)}><ArrowDown size={14} /></button>
                    <button className={expanded === metric.id ? "restore-chart" : undefined} aria-label={`${metric.name}: ${expanded === metric.id ? (zh ? "恢复原尺寸" : "Restore size") : (zh ? "专注查看" : "Focus view")}`} onClick={() => setExpanded(expanded === metric.id ? undefined : metric.id)}>{expanded === metric.id ? <><Minimize2 size={16} /><span>{zh ? "恢复原尺寸" : "Restore size"}</span></> : <Maximize2 size={15} />}</button>
                </div>
            </header>
            <div className="chart-facts"><span>{zh ? "最新" : "Latest"} <strong>{pair(facts.at(-1))}</strong> {metric.unit}</span><span>{metric.aggregation === "sum" ? (zh ? "范围合计" : "Period total") : metric.aggregation === "latest" ? (zh ? "最近结果" : "Latest result") : (zh ? "范围均值" : "Period mean")} <strong>{metric.aggregation === "sum" ? facts.length ? number(facts.reduce((n, item) => n + item.value, 0)) : "—" : metric.aggregation === "latest" ? pair(facts.at(-1)) : meanPair(facts)}</strong></span></div>
            {points.length ? <ClinicalChart metric={metric} readings={points} aggregate={aggregation} timezone={report.timezone} start={from} end={to} language={language} selection={selection} onSelect={setSelected} onClear={() => setSelected(undefined)} /> : <div className="empty-chart">{zh ? "此范围没有测量记录" : "No measurements in this range"}</div>}
        </article>;
    }
    /**
     * renderContext
     * ----------------
     * Keeps symptom and medication facts linked to the selected date range.
     *
     * October 28, 2026: Updated by Forrest Zhang for Shifa Power BI interaction review
     */
    function renderContext()
    {
        return <aside className="day-context"><header><span className="eyebrow">{selected ? (zh ? "已选时间" : "SELECTED PERIOD") : (zh ? "同一时间范围" : "IN THIS PERIOD")}</span><h2>{selected ? (zh ? "记录详情" : "Record context") : (zh ? "症状与用药" : "Symptoms & medication")}</h2><span>{selected ? selectedStart : `${relatedEvents.length} ${zh ? "条事件" : "recorded events"}`}</span></header><div className="context-events">{relatedEvents.slice().reverse().slice(0, 4).map((item) => <article key={item.id}><span className={`event-dot ${item.type}`} /><div><time>{formattedDate(item.timestamp, language, report.timezone)}</time><strong>{item.title}</strong><p>{item.detail}</p></div></article>)}{!relatedEvents.length && <p className="empty-context">{zh ? "此范围没有相关事件" : "No related events recorded in this range"}</p>}</div><button className="context-link" onClick={() => setTab("symptoms")}>{zh ? "打开完整时间线" : "Explore full timeline"}<ChevronRight size={15} /></button></aside>;
    }
    return <div className={`report-shell ${tab === "symptoms" ? "report-shell--symptoms" : ""}`}>
        <aside id="measure-selection" className="measure-sidebar">
            <div className="sidebar-heading"><Activity size={17} /><strong>{zh ? "指标" : "Measurements"}</strong><span>{chosen.length}</span></div>
            <label className="search-label"><span className="sr-only">{zh ? "查找指标" : "Find a measure"}</span><input type="search" placeholder={zh ? "查找指标…" : "Find a measurement…"} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
            {categories.map(([category, label]) =>
            {
                const items = report.metrics.filter((metric) => metric.category === category && metric.name.toLowerCase().includes(search.toLowerCase()));
                return items.length ? <fieldset key={category}><legend>{label}</legend>{items.map((metric) => <label key={metric.id} className={chosen.includes(metric.id) ? "chosen" : ""}><input type="checkbox" checked={chosen.includes(metric.id)} onChange={(event) =>
                {
                    setChosen(event.target.checked ? [...chosen, metric.id] : chosen.filter((id) => id !== metric.id)); setSelected(undefined); setExpanded(undefined);
                }} /><span>{metric.name}</span></label>)}</fieldset> : null;
            })}
            <a className="mobile-measures" href="#report-content">{zh ? "返回报告" : "Back to report"}</a>
            <p className="sidebar-note">{zh ? "只含患者主动分享的记录" : "Patient-selected data only"}</p>
        </aside>
        <main id="report-content" className="report-main">
            <div className="report-title"><div><p className="eyebrow">{zh ? "健康数据 · 就诊回顾" : "HEALTH DATA · VISIT REVIEW"}</p><h1>{zh ? "健康报告" : "Health report"}</h1><p className="patient-line"><strong>{report.patientLabel}</strong><span>{formattedDate(report.period.start, language, report.timezone)} – {formattedDate(report.period.end, language, report.timezone)}</span></p></div><div className="report-tools"><span className={demo ? "demo-badge" : "snapshot-badge"}>{demo ? (zh ? "1234 · 虚构演示" : "1234 · DEMO DATA") : (zh ? "患者分享快照" : "PATIENT SNAPSHOT")}</span><div className="tool-buttons"><button onClick={() => window.print()}><Printer size={15} />{zh ? "打印" : "Print view"}</button><button onClick={reset}><RotateCcw size={15} />{zh ? "重置" : "Reset"}</button><button onClick={close} aria-label={zh ? "关闭报告" : "Close report"}><X size={17} /></button></div></div></div>
            {!demo && <p className="access-note">{zh ? "请与患者确认身份 · 访问截止 " : "Confirm identity with the patient · Access ends "}{expiresAt ? formattedDate(expiresAt, language, report.timezone, true) : "—"}</p>}
            <nav className="report-tabs" aria-label={zh ? "报告内容" : "Report sections"}>{[["trends", zh ? "健康趋势" : "Health trends"], ["symptoms", zh ? "症状与用药" : "Symptoms & medication"]].map(([id, label]) => <button key={id} aria-current={tab === id || (tab === "records" && id === "trends") ? "page" : undefined} onClick={() =>
            {
                setTab(id ?? "trends"); setExpanded(undefined); setRecordsMetric(undefined);
            }}>{label}</button>)}<a className="mobile-measures" href="#measure-selection">{zh ? "选择指标" : "Measurements"}</a></nav>
            <div className="analysis-controls"><DateNavigator firstDay={firstDay} lastDay={lastDay} start={from} end={to} language={language} onChange={zoom} />
                <div className="filter-row"><div className="date-caption"><CalendarDays size={14} /><span>{from} — {to}</span><small>{zh ? "拖动两端调整日期，拖动中间平移" : "Drag either end to change dates, or the middle to move the range"}</small></div><div className="report-filters"><label>{zh ? "来源" : "Source"}<select value={source} onChange={(event) =>
                {
                    setSource(event.target.value); setSelected(undefined);
                }}><option value="all">{zh ? "全部来源" : "All sources"}</option>{sources.map((item) => <option key={item}>{item}</option>)}</select></label><label>{zh ? "背景" : "Context"}<select value={context} onChange={(event) =>
                {
                    setContext(event.target.value); setSelected(undefined);
                }}><option value="all">{zh ? "全部背景" : "All contexts"}</option>{contexts.map((item) => <option key={item}>{item}</option>)}</select></label><label>{zh ? "粒度" : "Granularity"}<select value={aggregation} onChange={(event) =>
                {
                    setAggregation(event.target.value as Aggregate); setSelected(undefined);
                }}><option value="raw">{zh ? "每次测量" : "Individual readings"}</option><option value="day">{zh ? "按日汇总" : "Daily summary"}</option><option value="week">{zh ? "按周汇总" : "Weekly summary"}</option></select></label></div></div>
            </div>
            <div className="scope-bar"><span><strong>{tab === "symptoms" ? filtered.events.length : focusReadings.length}</strong> {tab === "symptoms" ? (zh ? "条事件记录" : "recorded events") : (zh ? "次所选指标测量" : "selected measurements")}</span><span><strong>{scopeDays}</strong> {zh ? "天有记录" : "days with records"}</span><span>{zh ? "缺测保留为空" : "Missing days stay empty"}</span><span className="scope-timezone">{report.timezone}</span></div>
            {selected && <div className="selection-strip" role="status"><span className="selection-dot" /><strong>{selectedStart}{selectedEnd !== selectedStart ? ` — ${selectedEnd}` : ""}</strong><span>{tab === "symptoms" ? (zh ? "查看当天详情 · 症状摘要仍按整个日期范围计算" : "Day details selected · symptom summaries retain the full date range") : (zh ? "已联动图表及原始记录" : "Highlighted across charts · records filtered")}</span><button onClick={() => setSelected(undefined)}><X size={14} />{zh ? "清除选择" : "Clear selection"}</button></div>}
            {tab === "trends" && <>
                {expanded ? <div className="focus-surface">{selectedMetrics.filter((metric) => metric.id === expanded).map((metric) => renderChart(metric))}</div> : selectedMetrics.length ? <><section className="measurement-grid">{selectedMetrics.map((metric) => renderChart(metric))}</section>{renderContext()}</> : <div className="no-measures">{zh ? "从指标列表选择要分析的数据，或查看下方症状记录。" : "Select measurements to explore, or review the symptom records below."}</div>}
            </>}
            {(tab === "trends" || tab === "symptoms") && (!!report.concerns.length || filtered.events.length > 0) && <SymptomReview concerns={filtered.concerns} events={filtered.events} start={from} end={to} timezone={report.timezone} language={language} source={source} selection={selection} focused={focusedConcern} onFocus={setFocusedConcern} overview={tab === "trends"} onOpen={() => setTab("symptoms")} onSelectDay={(day) => setSelected({ timestamp: new Date(dayBoundary(day, report.timezone)).toISOString() })} onClear={() => setSelected(undefined)} />}
            {tab === "symptoms" && !report.concerns.length && !filtered.events.length && <section className="symptom-review"><p className="symptom-empty">{zh ? "此报告在所选范围内没有症状或事件记录。" : "This report has no symptom or event records in the selected range."}</p></section>}
            {tab === "records" && <section className="original-records"><button className="symptom-open" onClick={() =>
            {
                setTab("trends"); setRecordsMetric(undefined);
            }}>← Back to health trends</button><div className="section-heading"><h2>{zh ? "原始测量记录" : "Underlying measurements"}</h2><span>{rows.length} {zh ? "条记录" : "records"}</span></div><div className="table-scroll"><table><thead><tr><th><button onClick={() => setAscending(!ascending)}>{zh ? "日期与时间" : "Date & time"} {ascending ? "↑" : "↓"}</button></th><th>{zh ? "指标" : "Measure"}</th><th>{zh ? "原始值" : "Recorded value"}</th><th>{zh ? "来源" : "Source"}</th><th>{zh ? "背景与备注" : "Context & notes"}</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td><button onClick={() => setSelected(item)}>{formattedDate(item.timestamp, language, report.timezone, true)}</button></td><td>{report.metrics.find((metric) => metric.id === item.metricId)?.name}</td><td><strong>{pair(item)}</strong> {report.metrics.find((metric) => metric.id === item.metricId)?.unit}</td><td>{item.source}</td><td>{[item.context, item.note, item.referenceRange].filter(Boolean).join(" · ") || "—"}</td></tr>)}</tbody></table></div>{!rows.length && <p>{zh ? "没有符合筛选的测量，症状记录可在症状与用药中查看" : "No measurements match. Symptom records are in Symptoms & medication."}</p>}</section>}
            <footer>{zh ? "生成于" : "Generated"} {formattedDate(report.generatedAt, language, report.timezone, true)} · {zh ? "患者选择的快照。新记录不会自动加入；已查看或打印的内容无法收回。" : "Patient-selected snapshot. New entries are not added automatically; viewed or printed copies cannot be recalled."}</footer>
        </main>
    </div>;
}
