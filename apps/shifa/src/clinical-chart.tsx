import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart, type BarSeriesOption, type LineSeriesOption, type ScatterSeriesOption } from "echarts/charts";
import { AriaComponent, GridComponent, LegendComponent, MarkAreaComponent, TooltipComponent, type AriaComponentOption, type GridComponentOption, type LegendComponentOption, type TooltipComponentOption } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { ReportMetric, ReportReading } from "@shifa/contracts";
import { chartReadings, dayBoundary, localDay, shiftDay, type Aggregate, type ChartReading } from "./report-model";

echarts.use([LineChart, ScatterChart, BarChart, GridComponent, TooltipComponent, LegendComponent, MarkAreaComponent, AriaComponent, SVGRenderer]);
type Option = echarts.ComposeOption<LineSeriesOption | ScatterSeriesOption | BarSeriesOption | GridComponentOption | TooltipComponentOption | LegendComponentOption | AriaComponentOption>;
type Selection = { start: string; end: string };
type Props = { metric: ReportMetric; readings: ReportReading[]; aggregate: Aggregate; timezone: string; start: string; end: string; language: "en" | "zh"; onSelect(reading: ChartReading): void; onZoom?: ((start: string, end: string) => void) | undefined; onClear?: (() => void) | undefined; selection?: Selection | undefined; compact?: boolean | undefined };
const safe = (value: string | undefined) => (value ?? "—").replace(/[{}]/g, " ");
const value = (number: number) => number.toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Renders one report metric as a print-safe SVG ECharts visual.
 *
 * Readings are constrained to the shared DateNavigator window before any
 * daily or weekly aggregation. Aggregate points are drawn at the visible
 * portion of their period, while retaining their complete period metadata for
 * truthful tooltips. Selecting a point informs the dashboard; selecting the
 * same visible period or an empty canvas clears that dashboard selection.
 * The chart intentionally has no local zoom control: date navigation is a
 * report-wide interaction and must keep charts, context, and raw records in
 * the same scope.
 */
export function ClinicalChart({ metric, readings, aggregate, timezone, start, end, language, onSelect, onClear, selection, compact = false }: Props)
{
    const node = useRef<HTMLDivElement>(null);
    const chartRef = useRef<echarts.ECharts | null>(null);
    const pointsRef = useRef<ChartReading[]>([]);
    const interactionRef = useRef({ timezone, selection, start, end });
    const handlers = useRef({ onSelect, onClear });
    useEffect(() =>
    {
        handlers.current = { onSelect, onClear };
    }, [onSelect, onClear]);
    useEffect(() =>
    {
        interactionRef.current = { timezone, selection, start, end };
    }, [timezone, selection, start, end]);
    useEffect(() =>
    {
        if (!node.current) return;
        const chart = echarts.init(node.current, null, { renderer: "svg" });
        chartRef.current = chart;
        chart.on("click", (event) =>
        {
            const timestamp = Array.isArray(event.data) ? event.data[0] : undefined;
            if (typeof timestamp !== "number")
            {
                handlers.current.onClear?.(); return;
            }
            const selected = pointsRef.current.find((item) => Date.parse(item.timestamp) === timestamp);
            if (!selected) return;
            const state = interactionRef.current;
            const periodStart = selected.periodStart && selected.periodStart < state.start ? state.start : selected.periodStart ?? localDay(selected.timestamp, state.timezone);
            const periodEnd = selected.periodEnd && selected.periodEnd > state.end ? state.end : selected.periodEnd ?? localDay(selected.timestamp, state.timezone);
            const active = interactionRef.current.selection;
            if (active?.start === periodStart && active.end === periodEnd) handlers.current.onClear?.();
            else handlers.current.onSelect(selected);
        });
        chart.getZr().on("click", (event) =>
        {
            if (!event.target) handlers.current.onClear?.();
        });
        const observer = new ResizeObserver(() => chart.resize()); observer.observe(node.current);
        return () =>
        {
            observer.disconnect(); chart.dispose(); chartRef.current = null;
        };
    }, []);
    useEffect(() =>
    {
        const chart = chartRef.current; if (!chart) return;
        const scoped = readings.filter((item) =>
        {
            const day = localDay(item.timestamp, timezone); return day >= start && day <= end;
        }).slice(-20_000);
        const points = chartReadings(scoped, aggregate, timezone, metric.aggregation).map((point) =>
        {
            const visibleStart = point.periodStart && point.periodStart < start ? start : point.periodStart;
            return visibleStart ? { ...point, timestamp: new Date(dayBoundary(visibleStart, timezone)).toISOString() } : point;
        }); pointsRef.current = points;
        const paired = points.some((point) => point.secondaryValue !== undefined);
        const names = paired ? (language === "zh" ? [`收缩压 (${metric.unit})`, `舒张压 (${metric.unit})`] : [`Systolic (${metric.unit})`, `Diastolic (${metric.unit})`]) : [`${metric.name} (${metric.unit})`];
        const colors = paired ? ["#b64042", "#2374a0"] : ["#087f82"];
        const active = selection && selection.start <= end && selection.end >= start ? selection : undefined;
        const label = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-CA", { timeZone: timezone, month: "short", day: "numeric" });
        const dateTime = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-CA", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });
        const series = [0, ...(paired ? [1] : [])].map((index) =>
        {
            const data: Array<[number, number | null]> = []; let previous = 0;
            for (const point of points)
            {
                const timestamp = Date.parse(point.timestamp); const gap = aggregate === "week" ? 8 * 86_400_000 : 1.5 * 86_400_000;
                if (previous && timestamp - previous > gap) data.push([previous + gap / 2, null]);
                data.push([timestamp, index === 1 ? point.secondaryValue ?? null : point.value]); previous = timestamp;
            }
            return { id: `${metric.id}-${index}`, name: names[index], type: metric.category === "lab" ? "scatter" : metric.aggregation === "sum" ? "bar" : "line", data, color: colors[index], symbol: index === 1 ? "emptyCircle" : "circle", symbolSize: (item: unknown) => active && Array.isArray(item) && localDay(new Date(Number(item[0])).toISOString(), timezone) >= active.start && localDay(new Date(Number(item[0])).toISOString(), timezone) <= active.end ? 10 : 6, showSymbol: points.length <= 800, connectNulls: false, smooth: false, lineStyle: { width: 2 }, emphasis: { focus: "series" }, ...(metric.aggregation === "sum" ? { barMaxWidth: 14 } : {}), ...(index === 0 ? { markArea: active ? { silent: true, itemStyle: { color: "rgba(49,130,206,.11)" }, data: [[{ xAxis: dayBoundary(active.start, timezone) }, { xAxis: dayBoundary(shiftDay(active.end, 1), timezone) - 1 }]] } : { data: [] } } : {}) } as LineSeriesOption | ScatterSeriesOption | BarSeriesOption;
        });
        const option: Option = { animation: false, textStyle: { fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif", fontSize: 12, color: "#587087" }, aria: { enabled: true, label: { description: `${metric.name}: ${scoped.length} ${language === "zh" ? "条所选范围记录" : "observations in selected range"}${active ? `; ${language === "zh" ? "已选" : "selected"} ${active.start}–${active.end}` : ""}.` } }, grid: { left: compact ? 46 : 54, right: 20, top: 38, bottom: compact ? 35 : 44 }, legend: { top: 0, right: 8, itemWidth: 18, itemHeight: 8, textStyle: { color: "#4d6275", fontSize: 12 } }, tooltip: { trigger: "axis", renderMode: "richText", confine: true, backgroundColor: "#fff", borderColor: "#d5e0e8", axisPointer: { type: "cross", label: { show: false } }, formatter: (params: unknown) =>
        {
            const first = Array.isArray(params) ? params[0] as { value?: [number, number] } : undefined; const point = points.find((item) => Date.parse(item.timestamp) === first?.value?.[0]); if (!point) return "—"; const pair = `${value(point.value)} ${metric.unit}${point.secondaryValue === undefined ? "" : ` / ${value(point.secondaryValue)} ${metric.unit}`}`; if (aggregate === "raw") return `${dateTime.format(new Date(point.timestamp))}\n${safe(metric.name)}: ${pair}\n${safe(point.source)} · ${safe(point.context)}`; const periodStart = point.periodStart && point.periodStart < start ? start : point.periodStart ?? start; const periodEnd = point.periodEnd && point.periodEnd > end ? end : point.periodEnd ?? end; const mode = metric.aggregation === "sum" ? (language === "zh" ? "合计" : "Sum") : metric.aggregation === "latest" ? (language === "zh" ? "末次值" : "Last value") : (language === "zh" ? "均值" : "Mean"); return `${periodStart} – ${periodEnd}\n${safe(metric.name)} ${mode}: ${pair}\nn=${point.sampleCount ?? 1}`;
        } }, xAxis: { type: "time", min: dayBoundary(start, timezone), max: dayBoundary(shiftDay(end, 1), timezone) - 1, axisLine: { lineStyle: { color: "#cbd6df" } }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { formatter: (item: number) => label.format(item), hideOverlap: true, margin: 11, interval: "auto" } }, yAxis: { type: "value", scale: true, splitNumber: compact ? 3 : 4, name: metric.unit, nameTextStyle: { align: "right", color: "#6e8292" }, axisLabel: { color: "#6e8292" }, splitLine: { lineStyle: { color: "#e7edf2", type: "dashed" } } }, series };
        chart.setOption(option, { replaceMerge: ["series"], lazyUpdate: false });
    }, [metric, readings, aggregate, timezone, start, end, language, selection, compact]);
    return <div ref={node} className={`clinical-chart${compact ? " clinical-chart--compact" : ""}`} role="img" aria-label={`${metric.name} ${language === "zh" ? "趋势图" : "trend chart"}`} />;
}
