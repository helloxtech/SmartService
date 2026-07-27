import type {
    KnowledgeGap,
    KnowledgeGapRetestResponse,
    KnowledgeGapStatus,
} from "@smartservice/contracts";
import { Button } from "@smartservice/ui";
import type { Session } from "@supabase/supabase-js";
import {
    ArrowLeft,
    BookPlus,
    CheckCircle2,
    CircleAlert,
    ExternalLink,
    LoaderCircle,
    MessageSquareText,
    RefreshCw,
    RotateCcw,
    SearchCheck,
} from "lucide-react";
import {
    useEffect,
    useState,
    type FormEvent,
    type JSX,
} from "react";

import {
    AnalyticsApiError,
    applyKnowledgeGapAction,
    getKnowledgeGap,
    listKnowledgeGaps,
    resolveKnowledgeGap,
    retestKnowledgeGap,
} from "./lib/analytics-api";

interface KnowledgeGapWorkspaceProps
{
    initialGapId: string | null;
    onOpenGap(gapId: string | null): void;
    session: Session;
}

const processingStatuses = new Set([
    "uploaded",
    "extracting",
    "chunking",
    "embedding",
]);

/**
 * describeError
 * ----------------
 * Converts a knowledge-gap API failure into concise operator guidance.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gaps
 */
function describeError(error: unknown): string
{
    if (error instanceof AnalyticsApiError || error instanceof Error)
    {
        return error.message;
    }

    return "The knowledge-gap operation could not be completed.";
}

/**
 * formatTime
 * ----------------
 * Formats a gap timestamp in the operator's local timezone.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gaps
 */
function formatTime(value: string): string
{
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(value));
}

/**
 * statusClass
 * ----------------
 * Maps every gap state to a visible text-and-color badge.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gaps
 */
function statusClass(status: KnowledgeGapStatus): string
{
    if (status === "resolved")
    {
        return "border-emerald-200 bg-emerald-50 text-emerald-800";
    }

    if (status === "ignored")
    {
        return "border-slate-200 bg-slate-100 text-slate-700";
    }

    return "border-amber-200 bg-amber-50 text-amber-900";
}

/**
 * KnowledgeGapWorkspace
 * ----------------
 * Renders grouped gaps, manual-answer resolution, embedding progress, state actions, and source-scoped cited re-tests.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gaps
 */
export function KnowledgeGapWorkspace({
    initialGapId,
    onOpenGap,
    session,
}: KnowledgeGapWorkspaceProps): JSX.Element
{
    const [filter, setFilter] = useState<KnowledgeGapStatus | "all">("open");
    const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(initialGapId);
    const [detail, setDetail] = useState<KnowledgeGap | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [title, setTitle] = useState("");
    const [answer, setAnswer] = useState("");
    const [sourceNote, setSourceNote] = useState("");
    const [retest, setRetest] = useState<KnowledgeGapRetestResponse | null>(null);
    const resolutionStatus = detail?.resolutionSource?.status;

    useEffect(() =>
    {
        let active = true;

        /**
         * loadWorkspace
         * ----------------
         * Polls grouped gaps and selected resolution progress while discarding results after unmount.
         *
         * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gaps
         */
        async function loadWorkspace(): Promise<void>
        {
            try
            {
                const currentGaps = await listKnowledgeGaps(
                    session,
                    filter === "all" ? undefined : filter,
                );
                const currentDetail = selectedId === null
                    ? null
                    : await getKnowledgeGap(session, selectedId);

                if (active)
                {
                    setGaps(currentGaps);
                    setDetail(currentDetail);
                    setLoading(false);
                }
            }
            catch (error: unknown)
            {
                if (active)
                {
                    setMessage(describeError(error));
                    setLoading(false);
                }
            }
        }

        void loadWorkspace();
        const intervalId = globalThis.setInterval(() =>
        {
            if (
                resolutionStatus !== undefined
                && processingStatuses.has(resolutionStatus)
            )
            {
                void loadWorkspace();
            }
        }, 1_000);

        return () =>
        {
            active = false;
            globalThis.clearInterval(intervalId);
        };
    }, [filter, resolutionStatus, selectedId, session]);

    /**
     * refresh
     * ----------------
     * Reloads the list and selected gap immediately after an operator action.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gaps
     */
    async function refresh(): Promise<void>
    {
        const [currentGaps, currentDetail] = await Promise.all([
            listKnowledgeGaps(session, filter === "all" ? undefined : filter),
            selectedId === null
                ? Promise.resolve(null)
                : getKnowledgeGap(session, selectedId),
        ]);
        setGaps(currentGaps);
        setDetail(currentDetail);
    }

    /**
     * handleRefresh
     * ----------------
     * Runs an operator-requested refresh with bounded visible loading and error state.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gaps
     */
    async function handleRefresh(): Promise<void>
    {
        setLoading(true);
        setMessage(null);

        try
        {
            await refresh();
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

    /**
     * openGap
     * ----------------
     * Selects one grouped gap and updates the same-origin detail route.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Detail
     */
    function openGap(gap: KnowledgeGap): void
    {
        setSelectedId(gap.id);
        setDetail(gap);
        setRetest(null);
        setTitle(gap.normalizedQuestion.slice(0, 120));
        setAnswer("");
        setSourceNote("");
        onOpenGap(gap.id);
    }

    /**
     * handleResolve
     * ----------------
     * Creates one manual source and leaves progress polling active until embedding resolves the gap.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 One-click Knowledge
     */
    async function handleResolve(event: FormEvent<HTMLFormElement>): Promise<void>
    {
        event.preventDefault();

        if (detail === null)
        {
            return;
        }

        setBusy(true);
        setMessage(null);
        setRetest(null);

        try
        {
            await resolveKnowledgeGap(session, detail.id, {
                answer,
                sourceNote: sourceNote.trim().length === 0
                    ? undefined
                    : sourceNote.trim(),
                title,
            });
            await refresh();
            setMessage("Manual knowledge queued. Embedding progress will refresh automatically.");
        }
        catch (error: unknown)
        {
            setMessage(describeError(error));
        }
        finally
        {
            setBusy(false);
        }
    }

    /**
     * handleAction
     * ----------------
     * Applies an ignore or reopen transition and refreshes the authoritative grouped list.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Management
     */
    async function handleAction(action: "ignore" | "reopen"): Promise<void>
    {
        if (detail === null)
        {
            return;
        }

        setBusy(true);
        setMessage(null);

        try
        {
            setDetail(await applyKnowledgeGapAction(session, detail.id, action));
            await refresh();
        }
        catch (error: unknown)
        {
            setMessage(describeError(error));
        }
        finally
        {
            setBusy(false);
        }
    }

    /**
     * handleRetest
     * ----------------
     * Re-runs the original question against only the resolved manual source and displays its validated citations.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Re-test
     */
    async function handleRetest(): Promise<void>
    {
        if (detail === null)
        {
            return;
        }

        setBusy(true);
        setMessage(null);

        try
        {
            setRetest(await retestKnowledgeGap(session, detail.id));
        }
        catch (error: unknown)
        {
            setMessage(describeError(error));
        }
        finally
        {
            setBusy(false);
        }
    }

    const sourceProcessing = detail?.resolutionSource !== null
        && detail?.resolutionSource !== undefined
        && processingStatuses.has(detail.resolutionSource.status);
    const canRetest = detail?.status === "resolved"
        && detail.resolutionSource?.status === "ready";

    return (
        <section aria-labelledby="knowledge-gaps-heading">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <p className="text-sm font-semibold text-sky-700">Data feedback loop</p>
                    <h2 className="mt-1 text-3xl font-bold tracking-tight" id="knowledge-gaps-heading">
                        Knowledge gaps
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                        Repeated normalized questions stay grouped. Add one approved answer, embed it, then prove the repair with a cited re-test.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-sm font-semibold text-slate-600" htmlFor="gap-filter">
                        Status
                    </label>
                    <select
                        className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm"
                        id="gap-filter"
                        onChange={(event) =>
                        {
                            setFilter(event.target.value as KnowledgeGapStatus | "all");
                        }}
                        value={filter}
                    >
                        <option value="open">Open</option>
                        <option value="resolved">Resolved</option>
                        <option value="ignored">Ignored</option>
                        <option value="all">All</option>
                    </select>
                    <Button
                        aria-label="Refresh knowledge gaps"
                        disabled={loading}
                        onClick={() => void handleRefresh()}
                        size="icon"
                        variant="outline"
                    >
                        <RefreshCw aria-hidden="true" className={loading ? "size-4 animate-spin" : "size-4"} />
                    </Button>
                </div>
            </div>

            {message === null
                ? null
                : (
                    <div className="mb-5 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900" role="status">
                        {message}
                    </div>
                )}

            <div className="grid min-h-[620px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[330px_minmax(0,1fr)]">
                <aside className="border-b border-slate-200 bg-slate-50/70 lg:border-b-0 lg:border-r">
                    <div className="border-b border-slate-200 px-4 py-3">
                        <p className="text-sm font-bold">{gaps.length} grouped question{gaps.length === 1 ? "" : "s"}</p>
                    </div>

                    {loading && gaps.length === 0
                        ? (
                            <p className="flex items-center gap-2 p-5 text-sm text-slate-500" role="status">
                                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                                Loading gaps…
                            </p>
                        )
                        : gaps.length === 0
                            ? (
                                <div className="p-8 text-center">
                                    <CheckCircle2 aria-hidden="true" className="mx-auto size-7 text-emerald-600" />
                                    <p className="mt-3 font-semibold">No {filter === "all" ? "" : filter} gaps</p>
                                    <p className="mt-1 text-sm text-slate-500">
                                        New unsupported questions will be grouped here.
                                    </p>
                                </div>
                            )
                            : (
                                <div className="max-h-[620px] overflow-y-auto">
                                    {gaps.map((gap) => (
                                        <button
                                            className={gap.id === selectedId
                                                ? "block w-full border-b border-slate-200 bg-white px-4 py-4 text-left"
                                                : "block w-full border-b border-slate-200 px-4 py-4 text-left hover:bg-white"}
                                            key={gap.id}
                                            onClick={() => openGap(gap)}
                                            type="button"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold capitalize ${statusClass(gap.status)}`}>
                                                    {gap.status}
                                                </span>
                                                <span className="text-xs font-semibold text-slate-500">
                                                    ×{gap.occurrenceCount}
                                                </span>
                                            </div>
                                            <p className="mt-2 line-clamp-3 text-sm font-semibold leading-5">
                                                {gap.normalizedQuestion}
                                            </p>
                                            <p className="mt-2 text-xs text-slate-500">
                                                Last seen {formatTime(gap.lastSeenAt)}
                                            </p>
                                        </button>
                                    ))}
                                </div>
                            )}
                </aside>

                <div className="min-w-0 p-5 sm:p-7">
                    {detail === null
                        ? (
                            <div className="flex min-h-[500px] flex-col items-center justify-center text-center">
                                <CircleAlert aria-hidden="true" className="size-9 text-slate-300" />
                                <h3 className="mt-4 text-lg font-bold">Select a knowledge gap</h3>
                                <p className="mt-2 max-w-sm text-sm text-slate-500">
                                    Open a grouped question to review its example, occurrences, and resolution workflow.
                                </p>
                            </div>
                        )
                        : (
                            <div>
                                <button
                                    className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-sky-700 lg:hidden"
                                    onClick={() =>
                                    {
                                        setSelectedId(null);
                                        setDetail(null);
                                        onOpenGap(null);
                                    }}
                                    type="button"
                                >
                                    <ArrowLeft aria-hidden="true" className="size-4" />
                                    Back to gaps
                                </button>

                                <div className="flex flex-wrap items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <span className={`rounded-full border px-2.5 py-1 text-xs font-bold capitalize ${statusClass(detail.status)}`}>
                                            {detail.status}
                                        </span>
                                        <h3 className="mt-3 text-2xl font-bold tracking-tight">
                                            {detail.normalizedQuestion}
                                        </h3>
                                        <p className="mt-2 text-sm text-slate-500">
                                            Seen {detail.occurrenceCount} time{detail.occurrenceCount === 1 ? "" : "s"} · latest {formatTime(detail.lastSeenAt)}
                                        </p>
                                    </div>
                                    {detail.status === "open"
                                        ? (
                                            <Button
                                                disabled={busy || sourceProcessing}
                                                onClick={() => void handleAction("ignore")}
                                                size="sm"
                                                variant="ghost"
                                            >
                                                Ignore
                                            </Button>
                                        )
                                        : detail.status === "ignored"
                                            ? (
                                                <Button
                                                    disabled={busy}
                                                    onClick={() => void handleAction("reopen")}
                                                    size="sm"
                                                    variant="outline"
                                                >
                                                    <RotateCcw aria-hidden="true" className="size-4" />
                                                    Reopen
                                                </Button>
                                            )
                                            : null}
                                </div>

                                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                                    <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                            Example customer question
                                        </p>
                                        <p className="mt-2 text-sm leading-6">{detail.exampleQuestion}</p>
                                    </article>
                                    <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                            Gap reason
                                        </p>
                                        <p className="mt-2 text-sm leading-6">{detail.reason}</p>
                                        {detail.firstConversationId === null
                                            ? null
                                            : (
                                                <a
                                                    className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-sky-700"
                                                    href={`/app/conversations/${detail.firstConversationId}`}
                                                >
                                                    Open example conversation
                                                    <ExternalLink aria-hidden="true" className="size-3" />
                                                </a>
                                            )}
                                    </article>
                                </div>

                                {detail.resolutionSource === null
                                    ? null
                                    : (
                                        <article className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-4">
                                            <div className="flex flex-wrap items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-xs font-bold uppercase tracking-wide text-sky-700">
                                                        Manual resolution source
                                                    </p>
                                                    <p className="mt-1 font-semibold">{detail.resolutionSource.name}</p>
                                                </div>
                                                <span className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-xs font-bold capitalize text-sky-800">
                                                    {detail.resolutionSource.status}
                                                </span>
                                            </div>
                                            {sourceProcessing
                                                ? (
                                                    <p className="mt-3 flex items-center gap-2 text-sm text-sky-800" role="status">
                                                        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                                                        Chunking and embedding the approved answer…
                                                    </p>
                                                )
                                                : detail.resolutionSource.status === "failed"
                                                    ? (
                                                        <p className="mt-3 text-sm text-rose-700">
                                                            Embedding failed. Submit a new manual resolution or retry the source from Knowledge.
                                                        </p>
                                                    )
                                                    : (
                                                        <p className="mt-3 text-sm text-slate-600">
                                                            {detail.resolutionSource.chunkCount} ready chunk{detail.resolutionSource.chunkCount === 1 ? "" : "s"}.
                                                        </p>
                                                    )}
                                        </article>
                                    )}

                                {detail.status === "resolved"
                                    ? (
                                        <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                                            <div className="flex flex-wrap items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-sm font-bold text-emerald-900">
                                                        Knowledge repair complete
                                                    </p>
                                                    <p className="mt-1 text-sm text-emerald-800">
                                                        Re-test searches only this manual source and requires validated citations.
                                                    </p>
                                                </div>
                                                <Button
                                                    disabled={busy || !canRetest}
                                                    onClick={() => void handleRetest()}
                                                >
                                                    <SearchCheck aria-hidden="true" className="size-4" />
                                                    Re-test original question
                                                </Button>
                                            </div>

                                            {retest === null
                                                ? null
                                                : (
                                                    <div className="mt-5 rounded-xl border border-emerald-200 bg-white p-4">
                                                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-700">
                                                            <MessageSquareText aria-hidden="true" className="size-4" />
                                                            {retest.decision}
                                                        </div>
                                                        <p className="mt-3 text-sm leading-6">{retest.answer}</p>
                                                        <div className="mt-4 space-y-2">
                                                            {retest.citations.map((citation) => (
                                                                <div className="rounded-lg bg-slate-50 p-3 text-xs" key={citation.citationId}>
                                                                    <p className="font-bold">{citation.label}</p>
                                                                    <p className="mt-1 leading-5 text-slate-600">
                                                                        {citation.supportingExcerpt}
                                                                    </p>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                        </div>
                                    )
                                    : sourceProcessing
                                        ? null
                                        : (
                                            <form className="mt-6 rounded-2xl border border-slate-200 p-5" onSubmit={handleResolve}>
                                                <div className="flex items-start gap-3">
                                                    <span className="rounded-xl bg-sky-50 p-2.5 text-sky-700">
                                                        <BookPlus aria-hidden="true" className="size-5" />
                                                    </span>
                                                    <div>
                                                        <h4 className="font-bold">One-click manual knowledge</h4>
                                                        <p className="mt-1 text-sm text-slate-500">
                                                            Save an approved answer as a manual source and queue the shared embedding pipeline.
                                                        </p>
                                                    </div>
                                                </div>

                                                <label className="mt-5 block text-sm font-semibold" htmlFor="gap-title">
                                                    Knowledge title
                                                </label>
                                                <input
                                                    className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm"
                                                    id="gap-title"
                                                    maxLength={240}
                                                    onChange={(event) => setTitle(event.target.value)}
                                                    required
                                                    value={title}
                                                />

                                                <label className="mt-4 block text-sm font-semibold" htmlFor="gap-answer">
                                                    Approved answer
                                                </label>
                                                <textarea
                                                    className="mt-2 min-h-32 w-full rounded-lg border border-slate-300 p-3 text-sm leading-6"
                                                    id="gap-answer"
                                                    maxLength={5000}
                                                    onChange={(event) => setAnswer(event.target.value)}
                                                    required
                                                    value={answer}
                                                />

                                                <label className="mt-4 block text-sm font-semibold" htmlFor="gap-source-note">
                                                    Source note <span className="font-normal text-slate-500">(optional)</span>
                                                </label>
                                                <input
                                                    className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm"
                                                    id="gap-source-note"
                                                    maxLength={500}
                                                    onChange={(event) => setSourceNote(event.target.value)}
                                                    placeholder="For example: Confirmed by product lead"
                                                    value={sourceNote}
                                                />

                                                <Button className="mt-5" disabled={busy} type="submit">
                                                    {busy
                                                        ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                                                        : <BookPlus aria-hidden="true" className="size-4" />}
                                                    Create and embed knowledge
                                                </Button>
                                            </form>
                                        )}
                            </div>
                        )}
                </div>
            </div>
        </section>
    );
}
