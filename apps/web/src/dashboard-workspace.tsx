import type { DashboardSummary } from "@smartservice/contracts";
import { Button } from "@smartservice/ui";
import type { Session } from "@supabase/supabase-js";
import {
    ArrowRight,
    Bot,
    CalendarDays,
    CircleAlert,
    Gauge,
    LoaderCircle,
    RefreshCw,
    UsersRound,
} from "lucide-react";
import {
    useEffect,
    useState,
    type FormEvent,
    type JSX,
} from "react";

import {
    AnalyticsApiError,
    getDashboardSummary,
} from "./lib/analytics-api";

interface DashboardWorkspaceProps
{
    onOpenKnowledgeGaps(): void;
    session: Session;
}

/**
 * formatDateInput
 * ----------------
 * Formats one Date as a stable UTC calendar input without locale-dependent parsing.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard
 */
function formatDateInput(value: Date): string
{
    return value.toISOString().slice(0, 10);
}

/**
 * createDefaultRange
 * ----------------
 * Creates an inclusive trailing 30-day dashboard calendar range.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard
 */
function createDefaultRange(): { from: string; to: string }
{
    const to = new Date();
    const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
    return {
        from: formatDateInput(from),
        to: formatDateInput(to),
    };
}

const initialDashboardRange = createDefaultRange();

/**
 * toIsoRange
 * ----------------
 * Converts inclusive UTC calendar inputs into the API's inclusive-from/exclusive-to range.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard
 */
function toIsoRange(
    fromInput: string,
    toInput: string,
): { from: string; to: string }
{
    const from = new Date(`${fromInput}T00:00:00.000Z`);
    const inclusiveTo = new Date(`${toInput}T00:00:00.000Z`);
    const to = new Date(inclusiveTo.getTime() + 24 * 60 * 60 * 1000);

    if (
        Number.isNaN(from.getTime())
        || Number.isNaN(to.getTime())
        || to <= from
    )
    {
        throw new Error("Choose a valid dashboard date range.");
    }

    return {
        from: from.toISOString(),
        to: to.toISOString(),
    };
}

/**
 * describeError
 * ----------------
 * Converts a dashboard failure into concise operator guidance.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard
 */
function describeError(error: unknown): string
{
    if (error instanceof AnalyticsApiError || error instanceof Error)
    {
        return error.message;
    }

    return "Dashboard metrics could not be loaded.";
}

/**
 * formatPercent
 * ----------------
 * Formats a zero-to-one metric as a whole percentage for the compact demo dashboard.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard
 */
function formatPercent(value: number): string
{
    return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 0,
        style: "percent",
    }).format(value);
}

/**
 * DashboardWorkspace
 * ----------------
 * Renders exact date-filtered P0 metrics and compact rate charts without introducing an external BI dependency.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard
 */
export function DashboardWorkspace({
    onOpenKnowledgeGaps,
    session,
}: DashboardWorkspaceProps): JSX.Element
{
    const [fromDate, setFromDate] = useState(initialDashboardRange.from);
    const [toDate, setToDate] = useState(initialDashboardRange.to);
    const [summary, setSummary] = useState<DashboardSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState<string | null>(null);

    /**
     * loadSummary
     * ----------------
     * Loads authoritative dashboard aggregation for the selected inclusive calendar range.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard
     */
    async function loadSummary(): Promise<void>
    {
        setLoading(true);
        setMessage(null);

        try
        {
            const range = toIsoRange(fromDate, toDate);
            setSummary(await getDashboardSummary(
                session,
                range.from,
                range.to,
            ));
        }
        catch (error: unknown)
        {
            setMessage(describeError(error));
        }
        finally
        {
            setLoading(false);
        }
    }

    useEffect(() =>
    {
        let active = true;
        const range = toIsoRange(
            initialDashboardRange.from,
            initialDashboardRange.to,
        );

        getDashboardSummary(session, range.from, range.to)
            .then((loadedSummary) =>
            {
                if (active)
                {
                    setSummary(loadedSummary);
                    setMessage(null);
                }
            })
            .catch((error: unknown) =>
            {
                if (active)
                {
                    setMessage(describeError(error));
                }
            })
            .finally(() =>
            {
                if (active)
                {
                    setLoading(false);
                }
            });

        return () =>
        {
            active = false;
        };
    }, [session]);

    /**
     * handleFilter
     * ----------------
     * Applies the current date inputs without reloading metrics on every keystroke.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard
     */
    function handleFilter(event: FormEvent<HTMLFormElement>): void
    {
        event.preventDefault();
        void loadSummary();
    }

    const metricCards = summary === null
        ? []
        : [
            {
                detail: "Closed in selected period",
                icon: Gauge,
                label: "Total conversations",
                value: summary.totalConversations.toString(),
            },
            {
                detail: `${summary.aiContainedConversations} AI-resolved without handoff`,
                icon: Bot,
                label: "AI containment",
                value: formatPercent(summary.aiContainmentRate),
            },
            {
                detail: `${summary.handedOffConversations} entered human handoff`,
                icon: UsersRound,
                label: "Handoff rate",
                value: formatPercent(summary.handoffRate),
            },
            {
                detail: "Unresolved in selected period",
                icon: CircleAlert,
                label: "Knowledge gaps",
                value: summary.openKnowledgeGapCount.toString(),
            },
        ];

    return (
        <section aria-labelledby="dashboard-heading">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <p className="text-sm font-semibold text-sky-700">P0 operations</p>
                    <h2 className="mt-1 text-3xl font-bold tracking-tight" id="dashboard-heading">
                        Dashboard
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                        Exact tenant metrics use closed conversations and grouped unresolved questions.
                    </p>
                </div>

                <form className="flex flex-wrap items-end gap-3" onSubmit={handleFilter}>
                    <label className="text-xs font-semibold text-slate-600">
                        From
                        <input
                            className="mt-1 block h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm"
                            max={toDate}
                            onChange={(event) => setFromDate(event.target.value)}
                            required
                            type="date"
                            value={fromDate}
                        />
                    </label>
                    <label className="text-xs font-semibold text-slate-600">
                        To
                        <input
                            className="mt-1 block h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm"
                            min={fromDate}
                            onChange={(event) => setToDate(event.target.value)}
                            required
                            type="date"
                            value={toDate}
                        />
                    </label>
                    <Button disabled={loading} size="sm" type="submit" variant="outline">
                        <CalendarDays aria-hidden="true" className="size-4" />
                        Apply
                    </Button>
                </form>
            </div>

            {message === null
                ? null
                : (
                    <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
                        {message}
                    </div>
                )}

            {loading && summary === null
                ? (
                    <div className="flex min-h-64 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm text-slate-500">
                        <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
                        Loading dashboard…
                    </div>
                )
                : (
                    <>
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            {metricCards.map((metric) =>
                            {
                                const Icon = metric.icon;
                                return (
                                    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" key={metric.label}>
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-sm font-semibold text-slate-600">
                                                {metric.label}
                                            </p>
                                            <span className="rounded-lg bg-sky-50 p-2 text-sky-700">
                                                <Icon aria-hidden="true" className="size-4" />
                                            </span>
                                        </div>
                                        <p className="mt-5 text-3xl font-bold tracking-tight">{metric.value}</p>
                                        <p className="mt-2 text-xs leading-5 text-slate-500">{metric.detail}</p>
                                    </article>
                                );
                            })}
                        </div>

                        {summary === null
                            ? null
                            : (
                                <div className="mt-5 grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
                                    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <h3 className="font-bold">Resolution mix</h3>
                                                <p className="mt-1 text-sm text-slate-500">
                                                    Rates divide by closed conversations in the selected period.
                                                </p>
                                            </div>
                                            <Button
                                                aria-label="Refresh dashboard"
                                                disabled={loading}
                                                onClick={() => void loadSummary()}
                                                size="icon"
                                                variant="ghost"
                                            >
                                                <RefreshCw aria-hidden="true" className={loading ? "size-4 animate-spin" : "size-4"} />
                                            </Button>
                                        </div>

                                        <div className="mt-7 space-y-6">
                                            <div>
                                                <div className="mb-2 flex justify-between text-sm">
                                                    <span className="font-semibold">AI containment</span>
                                                    <span>{formatPercent(summary.aiContainmentRate)}</span>
                                                </div>
                                                <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                                                    <div
                                                        aria-label={`AI containment ${formatPercent(summary.aiContainmentRate)}`}
                                                        className="h-full rounded-full bg-emerald-500"
                                                        role="img"
                                                        style={{ width: `${summary.aiContainmentRate * 100}%` }}
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <div className="mb-2 flex justify-between text-sm">
                                                    <span className="font-semibold">Human handoff</span>
                                                    <span>{formatPercent(summary.handoffRate)}</span>
                                                </div>
                                                <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                                                    <div
                                                        aria-label={`Handoff rate ${formatPercent(summary.handoffRate)}`}
                                                        className="h-full rounded-full bg-amber-500"
                                                        role="img"
                                                        style={{ width: `${summary.handoffRate * 100}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </article>

                                    <article className="flex flex-col justify-between rounded-2xl border border-sky-200 bg-sky-50 p-6">
                                        <div>
                                            <CircleAlert aria-hidden="true" className="size-6 text-sky-700" />
                                            <h3 className="mt-4 text-xl font-bold">Close the knowledge loop</h3>
                                            <p className="mt-2 text-sm leading-6 text-slate-600">
                                                Group repeated unanswered questions, add one approved answer, embed it, and re-test the original question.
                                            </p>
                                        </div>
                                        <Button className="mt-6" onClick={onOpenKnowledgeGaps}>
                                            Review knowledge gaps
                                            <ArrowRight aria-hidden="true" className="size-4" />
                                        </Button>
                                    </article>
                                </div>
                            )}
                    </>
                )}
        </section>
    );
}
