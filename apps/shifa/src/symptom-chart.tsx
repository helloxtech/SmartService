import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import {
    LineChart,
    type LineSeriesOption,
} from "echarts/charts";
import {
    AriaComponent,
    GridComponent,
    MarkAreaComponent,
    TooltipComponent,
    type AriaComponentOption,
    type GridComponentOption,
    type TooltipComponentOption,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { ReportEvent } from "@shifa/contracts";
import { dayBoundary, localDay, shiftDay } from "./report-model";
import {
    symptomSeverityPoints,
    type SymptomSeverityPoint,
} from "./symptom-model";

echarts.use([
    LineChart,
    GridComponent,
    TooltipComponent,
    MarkAreaComponent,
    AriaComponent,
    SVGRenderer,
]);
type Option = echarts.ComposeOption<
  | LineSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | AriaComponentOption
>;
type Selection = { start: string; end: string };
type Props = {
    events: ReportEvent[];
    start: string;
    end: string;
    timezone: string;
    language: "en" | "zh";
    selection?: Selection | undefined;
    onSelectDay: (day: string) => void;
    connectSeverity?: boolean;
};
type ChartEvent = { seriesId?: unknown; value?: unknown };
type ChartMarkArea = NonNullable<LineSeriesOption["markArea"]>;
/**
 * safeText
 * ----------------
 * Removes ECharts rich-text control braces from patient-entered display text.
 *
 * October 29, 2026: Created by Forrest Zhang for Shifa symptom visualisation
 */
function safeText(text: string): string
{
    return text.replace(/[{}]/g, " ");
}

/**
 * selectionArea
 * ----------------
 * Builds an explicit ECharts mark area, including an empty value to remove a
 * previous dashboard selection from each chart grid.
 *
 * October 29, 2026: Created by Forrest Zhang for Shifa symptom visualisation
 */
function selectionArea(
    selection: Selection | undefined,
    timezone: string,
): ChartMarkArea
{
    if (!selection) return { data: [] };
    return {
        silent: true,
        itemStyle: { color: "rgba(49,130,206,.11)" },
        data: [
            [
                { xAxis: dayBoundary(selection.start, timezone) },
                { xAxis: dayBoundary(shiftDay(selection.end, 1), timezone) - 1 },
            ],
        ],
    };
}

/**
 * selectedWindow
 * ----------------
 * Keeps a dashboard selection only when it intersects this rendered window.
 *
 * October 29, 2026: Created by Forrest Zhang for Shifa symptom visualisation
 */
function selectedWindow(
    selection: Selection | undefined,
    start: string,
    end: string,
): Selection | undefined
{
    if (!selection || selection.end < start || selection.start > end)
        return undefined;
    return {
        start: selection.start < start ? start : selection.start,
        end: selection.end > end ? end : selection.end,
    };
}

/**
 * pointTimestamp
 * ----------------
 * Reads the time coordinate from an ECharts click payload without trusting
 * untyped event data.
 *
 * October 29, 2026: Created by Forrest Zhang for Shifa symptom visualisation
 */
function pointTimestamp(value: unknown): number | undefined
{
    return Array.isArray(value) && typeof value[0] === "number"
        ? value[0]
        : undefined;
}

/**
 * SymptomChart
 * ----------------
 * Renders severity observations with patient descriptions in point tooltips.
 * Severity is never imputed or averaged. Other events appear in the selected
 * day timeline below instead of encoded symbol lanes. The chart is
 * SVG-backed for print, uses the shared date selection, and sends a clicked day
 * to the dashboard without changing report data.
 *
 * October 29, 2026: Created by Forrest Zhang for Shifa symptom visualisation
 */
export function SymptomChart({
    events,
    start,
    end,
    timezone,
    language,
    selection,
    onSelectDay,
    connectSeverity = true,
}: Props)
{
    const node = useRef<HTMLDivElement>(null);
    const chartRef = useRef<echarts.ECharts | null>(null);
    const severityRef = useRef<SymptomSeverityPoint[]>([]);
    const handlers = useRef({ onSelectDay, timezone });

    useEffect(() =>
    {
        handlers.current = { onSelectDay, timezone };
    }, [onSelectDay, timezone]);
    useEffect(() =>
    {
        if (!node.current) return;
        const chart = echarts.init(node.current, null, { renderer: "svg" });
        chartRef.current = chart;
        chart.on("click", (event: ChartEvent) =>
        {
            const timestamp = pointTimestamp(event.value);
            if (timestamp === undefined) return;
            const day = localDay(
                new Date(timestamp).toISOString(),
                handlers.current.timezone,
            );
            handlers.current.onSelectDay(day);
        });
        const observer = new ResizeObserver(() => chart.resize());
        observer.observe(node.current);
        return () =>
        {
            observer.disconnect();
            chart.dispose();
            chartRef.current = null;
        };
    }, []);
    useEffect(() =>
    {
        const chart = chartRef.current;
        if (!chart) return;
        const severity = symptomSeverityPoints(events, start, end, timezone);
        severityRef.current = severity;
        const active = selectedWindow(selection, start, end);
        const label = new Intl.DateTimeFormat(
            language === "zh" ? "zh-CN" : "en-CA",
            { timeZone: timezone, month: "short", day: "numeric" },
        );
        const dateTime = new Intl.DateTimeFormat(
            language === "zh" ? "zh-CN" : "en-CA",
            { timeZone: timezone, dateStyle: "medium", timeStyle: "short" },
        );
        const markArea = selectionArea(active, timezone);
        const severityData: Array<[number, number | null]> = [];
        let previousDay: string | undefined;
        for (const point of severity)
        {
            if (previousDay && shiftDay(previousDay, 1) < point.day)
                severityData.push([
                    dayBoundary(shiftDay(previousDay, 1), timezone),
                    null,
                ]);
            severityData.push([Date.parse(point.timestamp), point.severity]);
            previousDay = point.day;
        }
        const gridLeft = language === "zh" ? 52 : 82;
        const severitySeries: LineSeriesOption = {
            id: "symptom-severity",
            name: language === "zh" ? "症状严重度" : "Symptom severity",
            type: "line",
            xAxisIndex: 0,
            yAxisIndex: 0,
            data: severityData,
            symbol: "circle",
            symbolSize: 8,
            showSymbol: true,
            connectNulls: false,
            smooth: false,
            lineStyle: { color: "#2a7e91", width: connectSeverity ? 2 : 0 },
            itemStyle: { color: "#2a7e91" },
            emphasis: { focus: "series" },
            markArea,
        };
        const option: Option = {
            animation: false,
            textStyle: {
                fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
                fontSize: 12,
                color: "#587087",
            },
            aria: {
                enabled: true,
                label: {
                    description: `${language === "zh" ? "症状图" : "Symptom chart"}: ${severity.length} ${language === "zh" ? "条严重度记录" : "severity records"}${active ? `; ${language === "zh" ? "已选" : "selected"} ${active.start}–${active.end}` : ""}.`,
                },
            },
            grid: { left: gridLeft, right: 20, top: 30, bottom: 43 },
            tooltip: {
                trigger: "item",
                renderMode: "richText",
                confine: true,
                backgroundColor: "#fff",
                borderColor: "#d5e0e8",
                formatter: (parameter: unknown) =>
                {
                    if (!parameter || typeof parameter !== "object") return "—";
                    const entry = parameter as ChartEvent;
                    const timestamp = pointTimestamp(entry.value);
                    if (timestamp === undefined || typeof entry.seriesId !== "string")
                        return "—";
                    if (entry.seriesId === "symptom-severity")
                    {
                        const point = severityRef.current.find(
                            (item) => Date.parse(item.timestamp) === timestamp,
                        );
                        return point
                            ? `${dateTime.format(new Date(point.timestamp))}\n${language === "zh" ? "严重度" : "Severity"}: ${point.severity}/10\n${safeText(point.event.title)}\n${safeText(point.event.detail).replace(/(.{1,48})(\s+|$)/g, "$1\n")}\nClick to view this day below`
                            : "—";
                    }
                    return "—";
                },
            },
            xAxis: [0].map((gridIndex) => ({
                type: "time",
                gridIndex,
                min: dayBoundary(start, timezone),
                max: dayBoundary(shiftDay(end, 1), timezone) - 1,
                axisLine: { lineStyle: { color: "#cbd6df" } },
                axisTick: { show: false },
                splitLine: { show: false },
                axisLabel: {
                    formatter: (item: number) => label.format(item),
                    hideOverlap: true,
                    margin: 10,
                    interval: "auto",
                },
            })),
            yAxis: [
                {
                    type: "value",
                    gridIndex: 0,
                    min: 0,
                    max: 10,
                    interval: 2,
                    name: language === "zh" ? "严重度" : "Severity",
                    nameTextStyle: { align: "right", color: "#6e8292" },
                    axisLabel: { color: "#6e8292", formatter: "{value}/10" },
                    splitLine: { lineStyle: { color: "#e7edf2", type: "dashed" } },
                },
            ],
            series: [severitySeries],
        };
        chart.setOption(option, { replaceMerge: ["series"], lazyUpdate: false });
    }, [events, start, end, timezone, language, selection, connectSeverity]);
    return (
        <div
            ref={node}
            className="symptom-chart"
            style={{ minHeight: 300, height: 300 }}
            role="img"
            aria-label={
                language === "zh"
                    ? "症状严重度和记录时间线"
                    : "Symptom severity over time"
            }
        />
    );
}
