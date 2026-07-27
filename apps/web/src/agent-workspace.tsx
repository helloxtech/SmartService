import type {
    TeamConversationDetail,
    TeamInboxItem,
} from "@smartservice/contracts";
import { Button } from "@smartservice/ui";
import type { Session } from "@supabase/supabase-js";
import {
    AlertTriangle,
    CheckCircle2,
    Clock3,
    Headphones,
    LoaderCircle,
    MessageSquareText,
    RefreshCw,
    Send,
    UserRoundCheck,
} from "lucide-react";
import {
    useEffect,
    useState,
    type FormEvent,
    type JSX,
} from "react";

import {
    claimTeamConversation,
    closeTeamConversation,
    getTeamConversation,
    listTeamConversations,
    sendTeamMessage,
    TeamApiError,
} from "./lib/team-api";

interface AgentWorkspaceProps
{
    initialConversationId: string | null;
    onOpenConversation(conversationId: string): void;
    session: Session;
}

/**
 * describeError
 * ----------------
 * Converts team API failures into concise operator guidance without exposing upstream response bodies.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Workspace
 */
function describeError(error: unknown): string
{
    if (error instanceof TeamApiError || error instanceof Error)
    {
        return error.message;
    }

    return "The conversation workspace could not be updated.";
}

/**
 * formatTime
 * ----------------
 * Formats an ISO timestamp in the operator's local browser timezone.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Workspace
 */
function formatTime(value: string): string
{
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(value));
}

/**
 * displayValue
 * ----------------
 * Shows the explicit acceptance fallback for absent customer fields without inventing data.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Customer Card
 */
function displayValue(value: string | null): string
{
    return value === null || value.trim().length === 0
        ? "Not provided"
        : value;
}

/**
 * statusBadgeClass
 * ----------------
 * Maps conversation state to an accessible badge while preserving a visible text label.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Inbox
 */
function statusBadgeClass(status: TeamInboxItem["status"]): string
{
    if (status === "active_human")
    {
        return "border-emerald-200 bg-emerald-50 text-emerald-800";
    }

    if (status === "closed")
    {
        return "border-slate-200 bg-slate-100 text-slate-700";
    }

    return "border-amber-200 bg-amber-50 text-amber-900";
}

/**
 * AgentWorkspace
 * ----------------
 * Renders the handoff queue, live transcript, customer/summary context, takeover, human reply, and closure controls.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Workspace
 */
export function AgentWorkspace({
    initialConversationId,
    onOpenConversation,
    session,
}: AgentWorkspaceProps): JSX.Element
{
    const [conversations, setConversations] = useState<TeamInboxItem[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(
        initialConversationId,
    );
    const [detail, setDetail] = useState<TeamConversationDetail | null>(null);
    const [includeClosed, setIncludeClosed] = useState(
        initialConversationId !== null,
    );
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [reply, setReply] = useState("");
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() =>
    {
        let active = true;

        /**
         * loadWorkspace
         * ----------------
         * Polls the tenant handoff list and selected detail every second while discarding results after unmount.
         *
         * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Workspace
         */
        async function loadWorkspace(): Promise<void>
        {
            try
            {
                const inbox = await listTeamConversations(session, includeClosed);

                if (!active)
                {
                    return;
                }

                setConversations(inbox);
                const targetId = selectedId ?? inbox[0]?.conversationId ?? null;

                if (selectedId === null && targetId !== null)
                {
                    setSelectedId(targetId);
                }

                if (targetId === null)
                {
                    setDetail(null);
                    setLoading(false);
                    return;
                }

                const currentDetail = await getTeamConversation(session, targetId);

                if (active)
                {
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
            void loadWorkspace();
        }, 1_000);

        return () =>
        {
            active = false;
            globalThis.clearInterval(intervalId);
        };
    }, [includeClosed, selectedId, session]);

    /**
     * refreshSelected
     * ----------------
     * Reloads the selected conversation immediately after an operator state transition.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Workspace
     */
    async function refreshSelected(conversationId: string): Promise<void>
    {
        const [inbox, currentDetail] = await Promise.all([
            listTeamConversations(session, includeClosed),
            getTeamConversation(session, conversationId),
        ]);
        setConversations(inbox);
        setDetail(currentDetail);
    }

    /**
     * handleClaim
     * ----------------
     * Claims the selected waiting handoff and refreshes the authoritative state.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Takeover
     */
    async function handleClaim(): Promise<void>
    {
        if (detail === null)
        {
            return;
        }

        setBusy(true);
        setMessage(null);

        try
        {
            await claimTeamConversation(session, detail.conversationId);
            await refreshSelected(detail.conversationId);
            setMessage("Conversation claimed. AI replies are now stopped.");
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
     * handleReply
     * ----------------
     * Sends one human response only from the current handoff owner.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Human Messaging
     */
    async function handleReply(event: FormEvent<HTMLFormElement>): Promise<void>
    {
        event.preventDefault();

        if (detail === null || reply.trim().length === 0)
        {
            return;
        }

        setBusy(true);
        setMessage(null);

        try
        {
            await sendTeamMessage(
                session,
                detail.conversationId,
                reply.trim(),
            );
            setReply("");
            await refreshSelected(detail.conversationId);
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
     * handleClose
     * ----------------
     * Confirms closure, queues finalization, and keeps the closed record visible while its summary arrives.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Conversation Closure
     */
    async function handleClose(): Promise<void>
    {
        if (
            detail === null
            || !globalThis.confirm("Close this conversation and generate the final summary?")
        )
        {
            return;
        }

        setBusy(true);
        setMessage(null);

        try
        {
            await closeTeamConversation(session, detail.conversationId);
            setIncludeClosed(true);
            await refreshSelected(detail.conversationId);
            setMessage("Conversation closed. Final summary is processing asynchronously.");
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

    const ownsConversation = detail?.acceptedBy === session.user.id;
    const canReply = detail?.status === "active_human" && ownsConversation;

    return (
        <section aria-labelledby="inbox-heading">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <p className="text-sm font-semibold text-sky-700">Human handoff</p>
                    <h2 className="mt-1 text-3xl font-bold tracking-tight" id="inbox-heading">
                        Agent inbox
                    </h2>
                    <p className="mt-2 text-sm text-slate-600">
                        Waiting context is ready before takeover; customer fields remain explicit when unavailable.
                    </p>
                </div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                        checked={includeClosed}
                        className="size-4 rounded border-slate-300"
                        onChange={(event) => setIncludeClosed(event.target.checked)}
                        type="checkbox"
                    />
                    Include closed
                </label>
            </div>

            {message === null
                ? null
                : (
                    <div className="mb-5 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900" role="status">
                        {message}
                    </div>
                )}

            <div className="grid min-h-[620px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[300px_minmax(0,1fr)]">
                <aside className="border-b border-slate-200 bg-slate-50/70 lg:border-b-0 lg:border-r">
                    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                        <p className="text-sm font-bold">Conversations</p>
                        <RefreshCw aria-hidden="true" className="size-4 text-slate-400" />
                    </div>

                    {loading
                        ? (
                            <p className="flex items-center gap-2 p-5 text-sm text-slate-500" role="status">
                                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                                Loading inbox…
                            </p>
                        )
                        : conversations.length === 0
                            ? (
                                <div className="p-6 text-center text-sm text-slate-500">
                                    <CheckCircle2 aria-hidden="true" className="mx-auto mb-3 size-7 text-emerald-600" />
                                    No conversations are waiting.
                                </div>
                            )
                            : (
                                <div className="max-h-[620px] overflow-y-auto">
                                    {conversations.map((conversation) => (
                                        <button
                                            className={conversation.conversationId === selectedId
                                                ? "block w-full border-b border-slate-200 bg-white px-4 py-4 text-left"
                                                : "block w-full border-b border-slate-200 px-4 py-4 text-left hover:bg-white"}
                                            key={conversation.conversationId}
                                            onClick={() =>
                                            {
                                                setSelectedId(conversation.conversationId);
                                                onOpenConversation(conversation.conversationId);
                                            }}
                                            type="button"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <p className="truncate text-sm font-bold">
                                                    {displayValue(conversation.customer.name)}
                                                </p>
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadgeClass(conversation.status)}`}>
                                                    {conversation.status.replace("_", " ")}
                                                </span>
                                            </div>
                                            <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">
                                                {conversation.summary.customerQuestion}
                                            </p>
                                            <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-400">
                                                <Clock3 aria-hidden="true" className="size-3" />
                                                {formatTime(conversation.handoffRequestedAt)}
                                            </p>
                                        </button>
                                    ))}
                                </div>
                            )}
                </aside>

                {detail === null
                    ? (
                        <div className="flex items-center justify-center p-10 text-center text-sm text-slate-500">
                            Select a conversation to review its handoff package.
                        </div>
                    )
                    : (
                        <div className="grid min-w-0 xl:grid-cols-[minmax(0,1fr)_320px]">
                            <div className="flex min-w-0 flex-col border-b border-slate-200 xl:border-b-0 xl:border-r">
                                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                                    <div>
                                        <p className="font-bold">{displayValue(detail.customer.name)}</p>
                                        <p className="mt-1 text-xs text-slate-500">
                                            {detail.customer.language} · {detail.customer.channel}
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        {detail.status === "handoff_requested"
                                            ? (
                                                <Button disabled={busy} onClick={() => void handleClaim()} size="sm">
                                                    <UserRoundCheck aria-hidden="true" className="size-4" />
                                                    Claim
                                                </Button>
                                            )
                                            : null}
                                        {canReply
                                            ? (
                                                <Button disabled={busy} onClick={() => void handleClose()} size="sm" variant="outline">
                                                    Close
                                                </Button>
                                            )
                                            : null}
                                    </div>
                                </header>

                                <div className="h-[430px] space-y-4 overflow-y-auto bg-slate-50/50 p-5">
                                    {detail.messages.map((entry) => (
                                        <article
                                            className={entry.senderType === "customer"
                                                ? "mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white p-4"
                                                : entry.senderType === "human"
                                                    ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-sky-700 p-4 text-white"
                                                    : "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-slate-900 p-4 text-white"}
                                            key={entry.messageId}
                                        >
                                            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider opacity-65">
                                                {entry.senderType}
                                            </p>
                                            <p className="whitespace-pre-wrap text-sm leading-6">{entry.text}</p>
                                            {entry.citations.length > 0
                                                ? (
                                                    <ul className="mt-3 space-y-1 border-t border-white/20 pt-2 text-xs opacity-80">
                                                        {entry.citations.map((citation) => (
                                                            <li key={citation.citationId}>{citation.label}</li>
                                                        ))}
                                                    </ul>
                                                )
                                                : null}
                                        </article>
                                    ))}
                                </div>

                                <div className="border-t border-slate-200 p-4">
                                    {canReply
                                        ? (
                                            <form className="flex gap-2" onSubmit={handleReply}>
                                                <label className="sr-only" htmlFor="agent-reply">Human reply</label>
                                                <textarea
                                                    className="min-h-11 flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
                                                    id="agent-reply"
                                                    maxLength={5000}
                                                    onChange={(event) => setReply(event.target.value)}
                                                    placeholder="Write a human reply…"
                                                    value={reply}
                                                />
                                                <Button disabled={busy || reply.trim().length === 0} type="submit">
                                                    <Send aria-hidden="true" className="size-4" />
                                                    Send
                                                </Button>
                                            </form>
                                        )
                                        : (
                                            <p className="flex items-center gap-2 text-sm text-slate-500">
                                                <Headphones aria-hidden="true" className="size-4" />
                                                {detail.status === "closed"
                                                    ? "Conversation closed."
                                                    : detail.acceptedBy === null
                                                        ? "Claim this conversation to reply."
                                                        : "Another operator owns this conversation."}
                                            </p>
                                        )}
                                </div>
                            </div>

                            <aside className="max-h-[620px] space-y-5 overflow-y-auto p-5">
                                <section>
                                    <h3 className="text-sm font-bold">Customer card</h3>
                                    <dl className="mt-3 grid gap-3 text-xs">
                                        {[
                                            ["Name", detail.customer.name],
                                            ["Email", detail.customer.email],
                                            ["Phone", detail.customer.phone],
                                            ["Company", detail.customer.company],
                                        ].map(([label, value]) => (
                                            <div key={label}>
                                                <dt className="text-slate-400">{label}</dt>
                                                <dd className="mt-0.5 break-words font-medium text-slate-800">
                                                    {displayValue(value ?? null)}
                                                </dd>
                                            </div>
                                        ))}
                                    </dl>
                                </section>

                                {detail.voiceSession === null
                                    ? null
                                    : (
                                        <section className="rounded-xl border border-violet-200 bg-violet-50 p-4">
                                            <h3 className="flex items-center gap-2 text-sm font-bold text-violet-950">
                                                <Headphones aria-hidden="true" className="size-4" />
                                                Voice session
                                            </h3>
                                            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs text-violet-950">
                                                <div>
                                                    <dt className="font-bold">Runtime</dt>
                                                    <dd>{detail.voiceSession.provider} · {detail.voiceSession.status}</dd>
                                                </div>
                                                <div>
                                                    <dt className="font-bold">Warmup</dt>
                                                    <dd>{detail.voiceSession.warmupMs === null
                                                        ? "Not completed"
                                                        : `${detail.voiceSession.warmupMs} ms`}</dd>
                                                </div>
                                                <div>
                                                    <dt className="font-bold">Server P50</dt>
                                                    <dd>{detail.voiceSession.serverAssistantLatency.p50Ms === null
                                                        ? "No samples"
                                                        : `${detail.voiceSession.serverAssistantLatency.p50Ms} ms`}</dd>
                                                </div>
                                                <div>
                                                    <dt className="font-bold">Server P95 / max</dt>
                                                    <dd>{detail.voiceSession.serverAssistantLatency.p95Ms === null
                                                        ? "No samples"
                                                        : `${detail.voiceSession.serverAssistantLatency.p95Ms} / ${detail.voiceSession.serverAssistantLatency.maxMs} ms`}</dd>
                                                </div>
                                            </dl>
                                            <p className="mt-3 text-[11px] text-violet-800">
                                                Server assistant timing only; browser turn-to-audio evidence is reported separately.
                                            </p>
                                            {detail.voiceSession.errorCode === null
                                                ? null
                                                : (
                                                    <p className="mt-2 text-[11px] font-semibold text-rose-700">
                                                        Failure code: {detail.voiceSession.errorCode}
                                                    </p>
                                                )}
                                        </section>
                                    )}

                                <section className="rounded-xl bg-sky-50 p-4">
                                    <h3 className="flex items-center gap-2 text-sm font-bold text-sky-950">
                                        <MessageSquareText aria-hidden="true" className="size-4" />
                                        Handoff package
                                    </h3>
                                    <dl className="mt-3 space-y-3 text-xs leading-5 text-sky-950">
                                        <div>
                                            <dt className="font-bold">Current intent</dt>
                                            <dd>{detail.summary.currentIntent}</dd>
                                        </div>
                                        <div>
                                            <dt className="font-bold">Why escalated</dt>
                                            <dd>{detail.summary.triggerReason}</dd>
                                        </div>
                                        <div>
                                            <dt className="font-bold">Next step</dt>
                                            <dd>{detail.summary.nextStep}</dd>
                                        </div>
                                        <div>
                                            <dt className="font-bold">Suggested reply</dt>
                                            <dd>{detail.summary.suggestedReply}</dd>
                                        </div>
                                    </dl>
                                </section>

                                {detail.guardrailEvents.length > 0
                                    ? (
                                        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                                            <h3 className="flex items-center gap-2 text-sm font-bold text-amber-950">
                                                <AlertTriangle aria-hidden="true" className="size-4" />
                                                Guardrail context
                                            </h3>
                                            <ul className="mt-3 space-y-3 text-xs text-amber-950">
                                                {detail.guardrailEvents.map((event) => (
                                                    <li key={event.id}>
                                                        <p className="font-bold">{event.ruleCode} · {event.severity}</p>
                                                        <p className="mt-1 leading-5">{event.reason}</p>
                                                    </li>
                                                ))}
                                            </ul>
                                            <p className="mt-3 text-[11px] text-amber-800">
                                                Withheld candidate text is redacted from Agent views.
                                            </p>
                                        </section>
                                    )
                                    : null}

                                {detail.status === "closed"
                                    ? (
                                        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                                            <h3 className="text-sm font-bold text-emerald-950">Final record</h3>
                                            {detail.summaryRecord === null
                                                ? (
                                                    <p className="mt-2 flex items-center gap-2 text-xs text-emerald-900">
                                                        <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
                                                        Finalization queued…
                                                    </p>
                                                )
                                                : (
                                                    <dl className="mt-3 space-y-3 text-xs leading-5 text-emerald-950">
                                                        <div>
                                                            <dt className="font-bold">Summary</dt>
                                                            <dd>{detail.summaryRecord.summary}</dd>
                                                        </div>
                                                        <div>
                                                            <dt className="font-bold">Primary intent</dt>
                                                            <dd>{detail.summaryRecord.primaryIntent}</dd>
                                                        </div>
                                                        <div>
                                                            <dt className="font-bold">Intent level / outcome</dt>
                                                            <dd>{detail.summaryRecord.intentLevel} / {detail.summaryRecord.outcome}</dd>
                                                        </div>
                                                        <div>
                                                            <dt className="font-bold">Suggested wording</dt>
                                                            <dd>{detail.summaryRecord.suggestedScript}</dd>
                                                        </div>
                                                    </dl>
                                                )}
                                        </section>
                                    )
                                    : null}
                            </aside>
                        </div>
                    )}
            </div>
        </section>
    );
}
