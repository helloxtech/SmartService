import { useRef, useState } from "react";
import { clampDay, daysBetween, isValidDay, moveWindow, normalizeWindow, positionForDay, shiftDay, type DateWindow } from "./date-window";

type DragTarget = "start" | "end" | "window";

type DateNavigatorProps = {
    firstDay: string;
    lastDay: string;
    start: string;
    end: string;
    language: "en" | "zh";
    onChange(start: string, end: string): void;
};

/**
 * DateNavigator
 * ----------------
 * Provides one report-wide date range control with accessible handles and deferred drag commits.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export function DateNavigator({ firstDay, lastDay, start, end, language, onChange }: DateNavigatorProps)
{
    const zh = language === "zh";
    const initial = normalizeWindow({ start, end }, firstDay, lastDay);
    const [dragDraft, setDragDraft] = useState<DateWindow>(initial);
    const [dragging, setDragging] = useState(false);
    const draft = dragging ? dragDraft : initial;
    const draftRef = useRef(initial);
    const drag = useRef<{ target: DragTarget; clientX: number; window: DateWindow } | null>(null);
    const track = useRef<HTMLDivElement>(null);
    const totalDays = daysBetween(firstDay, lastDay);

    /**
     * setDraft
     * ----------------
     * Updates the local drag draft without rebuilding the parent report.
     *
     * October 28, 2026: Created by Forrest Zhang for Shifa health reports
     */
    function setDraft(next: DateWindow): void
    {
        const normalized = normalizeWindow(next, firstDay, lastDay);
        draftRef.current = normalized;
        setDragDraft(normalized);
    }

    /**
     * commit
     * ----------------
     * Publishes one normalized date range after a completed interaction.
     *
     * October 28, 2026: Created by Forrest Zhang for Shifa health reports
     */
    function commit(next = draft): void
    {
        const normalized = normalizeWindow(next, firstDay, lastDay);
        onChange(normalized.start, normalized.end);
    }

    /**
     * applyPreset
     * ----------------
     * Selects a report-relative shortcut range anchored on the last report date.
     *
     * October 28, 2026: Created by Forrest Zhang for Shifa health reports
     */
    function applyPreset(days: number | "all"): void
    {
        const next = days === "all"
            ? { start: firstDay, end: lastDay }
            : { start: clampDay(shiftDay(lastDay, -(days - 1)), firstDay, lastDay), end: lastDay };
        commit(next);
    }

    /**
     * beginDrag
     * ----------------
     * Captures a pointer so a handle or selected window can be moved continuously.
     *
     * October 28, 2026: Created by Forrest Zhang for Shifa health reports
     */
    function beginDrag(target: DragTarget, event: React.PointerEvent<HTMLButtonElement | HTMLDivElement>): void
    {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        draftRef.current = draft;
        setDragDraft(draft);
        setDragging(true);
        drag.current = { target, clientX: event.clientX, window: draft };
    }

    /**
     * dragTo
     * ----------------
     * Adjusts only the local draft; crossed handles clamp at the opposite handle.
     *
     * October 28, 2026: Created by Forrest Zhang for Shifa health reports
     */
    function dragTo(event: React.PointerEvent<HTMLButtonElement | HTMLDivElement>): void
    {
        const current = drag.current;
        const element = track.current;
        if (!current || !element) return;
        const width = Math.max(1, element.getBoundingClientRect().width);
        const offset = Math.round(((event.clientX - current.clientX) / width) * totalDays);
        if (current.target === "window")
        {
            setDraft(moveWindow(current.window, offset, firstDay, lastDay));
            return;
        }
        const moved = clampDay(shiftDay(current.target === "start" ? current.window.start : current.window.end, offset), firstDay, lastDay);
        setDraft(current.target === "start"
            ? { start: moved <= current.window.end ? moved : current.window.end, end: current.window.end }
            : { start: current.window.start, end: moved >= current.window.start ? moved : current.window.start });
    }

    /**
     * finishDrag
     * ----------------
     * Commits one final range after pointer interaction completes or is cancelled.
     *
     * October 28, 2026: Created by Forrest Zhang for Shifa health reports
     */
    function finishDrag(): void
    {
        if (!drag.current) return;
        drag.current = null;
        const next = draftRef.current;
        setDragging(false);
        commit(next);
    }

    /**
     * moveHandle
     * ----------------
     * Moves one accessible range handle by a day or by seven days with Shift.
     *
     * October 28, 2026: Created by Forrest Zhang for Shifa health reports
     */
    function moveHandle(target: "start" | "end", event: React.KeyboardEvent<HTMLButtonElement>): void
    {
        const amount = event.shiftKey ? 7 : 1;
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const offset = event.key === "ArrowLeft" ? -amount : amount;
        const nextDay = clampDay(shiftDay(draft[target], offset), firstDay, lastDay);
        const next = target === "start"
            ? { start: nextDay <= draft.end ? nextDay : draft.end, end: draft.end }
            : { start: draft.start, end: nextDay >= draft.start ? nextDay : draft.start };
        commit(next);
    }

    /**
     * inputChange
     * ----------------
     * Commits a valid native-date input and leaves blank or impossible dates unchanged.
     *
     * October 28, 2026: Created by Forrest Zhang for Shifa health reports
     */
    function inputChange(target: "start" | "end", value: string): void
    {
        if (!isValidDay(value)) return;
        const next = target === "start" ? { start: value, end: draft.end } : { start: draft.start, end: value };
        commit(next);
    }

    /**
     * moveWindowByKey
     * ----------------
     * Provides keyboard movement of the complete selected date window.
     *
     * October 28, 2026: Created by Forrest Zhang for Shifa health reports
     */
    function moveWindowByKey(event: React.KeyboardEvent<HTMLDivElement>): void
    {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const amount = event.shiftKey ? 7 : 1;
        commit(moveWindow(draft, event.key === "ArrowLeft" ? -amount : amount, firstDay, lastDay));
    }

    const left = positionForDay(draft.start, firstDay, lastDay) * 100;
    const right = positionForDay(draft.end, firstDay, lastDay) * 100;
    const width = Math.max(0, right - left);
    const moveByWindow = daysBetween(draft.start, draft.end) + 1;
    const previous = moveWindow(draft, -moveByWindow, firstDay, lastDay);
    const following = moveWindow(draft, moveByWindow, firstDay, lastDay);
    const presetWindow = (days: number | "all"): DateWindow => days === "all"
        ? { start: firstDay, end: lastDay }
        : { start: clampDay(shiftDay(lastDay, -(days - 1)), firstDay, lastDay), end: lastDay };
    const sameWindow = (leftWindow: DateWindow, rightWindow: DateWindow): boolean => leftWindow.start === rightWindow.start && leftWindow.end === rightWindow.end;

    return <section className="date-navigator" aria-label={zh ? "报告日期范围" : "Report date range"}>
        <div className="date-navigator-presets" role="group" aria-label={zh ? "快捷日期范围" : "Quick date ranges"}>
            {[7, 30, 90].map((days) => <button key={days} type="button" aria-pressed={sameWindow(draft, presetWindow(days))} onClick={() => applyPreset(days)}>{zh ? `最近 ${days} 天` : `Last ${days} days`}</button>)}
            <button type="button" aria-pressed={sameWindow(draft, presetWindow("all"))} onClick={() => applyPreset("all")}>{zh ? "全部" : "All"}</button>
            <button type="button" disabled={sameWindow(draft, previous)} aria-label={zh ? "向前移动当前范围" : "Move current range earlier"} onClick={() => commit(previous)}>‹</button>
            <button type="button" disabled={sameWindow(draft, following)} aria-label={zh ? "向后移动当前范围" : "Move current range later"} onClick={() => commit(following)}>›</button>
        </div>
        <div className="date-navigator-inputs">
            <label>{zh ? "开始" : "From"}<input type="date" min={firstDay} max={draft.end} value={draft.start} onChange={(event) => inputChange("start", event.target.value)} onBlur={(event) => inputChange("start", event.currentTarget.value)} /></label>
            <label>{zh ? "结束" : "To"}<input type="date" min={draft.start} max={lastDay} value={draft.end} onChange={(event) => inputChange("end", event.target.value)} onBlur={(event) => inputChange("end", event.currentTarget.value)} /></label>
        </div>
        <div ref={track} className="date-navigator-track">
            <div className="date-navigator-selected-window" role="button" tabIndex={0} aria-label={zh ? "移动所选日期范围" : "Move selected date range"} style={{ left: `${left}%`, width: `${width}%` }} onKeyDown={moveWindowByKey} onPointerDown={(event) => beginDrag("window", event)} onPointerMove={dragTo} onPointerUp={finishDrag} onPointerCancel={finishDrag} />
            <button className="date-navigator-handle date-navigator-handle-start" type="button" role="slider" aria-label={zh ? "开始日期" : "Start date"} aria-valuemin={0} aria-valuemax={daysBetween(firstDay, draft.end)} aria-valuenow={daysBetween(firstDay, draft.start)} aria-valuetext={draft.start} style={{ left: `${left}%` }} onKeyDown={(event) => moveHandle("start", event)} onPointerDown={(event) => beginDrag("start", event)} onPointerMove={dragTo} onPointerUp={finishDrag} onPointerCancel={finishDrag} />
            <button className="date-navigator-handle date-navigator-handle-end" type="button" role="slider" aria-label={zh ? "结束日期" : "End date"} aria-valuemin={daysBetween(firstDay, draft.start)} aria-valuemax={totalDays} aria-valuenow={daysBetween(firstDay, draft.end)} aria-valuetext={draft.end} style={{ left: `${right}%` }} onKeyDown={(event) => moveHandle("end", event)} onPointerDown={(event) => beginDrag("end", event)} onPointerMove={dragTo} onPointerUp={finishDrag} onPointerCancel={finishDrag} />
        </div>
    </section>;
}
