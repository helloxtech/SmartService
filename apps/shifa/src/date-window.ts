/**
 * clampDay
 * ----------------
 * Keeps an ISO calendar day within an inclusive report boundary.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export function clampDay(day: string, firstDay: string, lastDay: string): string
{
    if (day < firstDay) return firstDay;
    if (day > lastDay) return lastDay;
    return day;
}

/**
 * isValidDay
 * ----------------
 * Accepts only a real Gregorian ISO calendar day, not merely a date-shaped string.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export function isValidDay(day: string): boolean
{
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    const date = new Date(`${day}T12:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === day;
}

/**
 * shiftDay
 * ----------------
 * Moves a calendar day without browser-timezone or DST drift.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export function shiftDay(day: string, offset: number): string
{
    const date = new Date(`${day}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
}

/**
 * daysBetween
 * ----------------
 * Returns the calendar-day distance; the same day has distance zero.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export function daysBetween(start: string, end: string): number
{
    return Math.max(0, Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000));
}

export type DateWindow = { start: string; end: string };

/**
 * normalizeWindow
 * ----------------
 * Clamps and orders a candidate inclusive window, including a one-day report.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export function normalizeWindow(candidate: DateWindow, firstDay: string, lastDay: string): DateWindow
{
    const start = clampDay(candidate.start, firstDay, lastDay);
    const end = clampDay(candidate.end, firstDay, lastDay);
    return start <= end ? { start, end } : { start: end, end: start };
}

/**
 * moveWindow
 * ----------------
 * Moves a whole window while preserving its length until it reaches a boundary.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export function moveWindow(window: DateWindow, offset: number, firstDay: string, lastDay: string): DateWindow
{
    const normalized = normalizeWindow(window, firstDay, lastDay);
    const length = daysBetween(normalized.start, normalized.end);
    let start = shiftDay(normalized.start, offset);
    let end = shiftDay(normalized.end, offset);
    if (start < firstDay) 
    {
        start = firstDay; end = shiftDay(start, length); 
    }
    if (end > lastDay) 
    {
        end = lastDay; start = shiftDay(end, -length); 
    }
    return normalizeWindow({ start, end }, firstDay, lastDay);
}

/**
 * windowFromPositions
 * ----------------
 * Converts two 0–1 navigator positions into an inclusive report date window.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export function windowFromPositions(left: number, right: number, firstDay: string, lastDay: string): DateWindow
{
    const span = daysBetween(firstDay, lastDay);
    if (!span) return { start: firstDay, end: firstDay };
    const start = shiftDay(firstDay, Math.round(Math.min(1, Math.max(0, left)) * span));
    const end = shiftDay(firstDay, Math.round(Math.min(1, Math.max(0, right)) * span));
    return normalizeWindow({ start, end }, firstDay, lastDay);
}

/**
 * positionForDay
 * ----------------
 * Returns a 0–1 navigator position for a report-local calendar day.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export function positionForDay(day: string, firstDay: string, lastDay: string): number
{
    const span = daysBetween(firstDay, lastDay);
    return span ? daysBetween(firstDay, clampDay(day, firstDay, lastDay)) / span : 0;
}
