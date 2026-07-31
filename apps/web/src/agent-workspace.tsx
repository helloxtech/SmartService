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
    ExternalLink,
    Headphones,
    ListChecks,
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
import type { UiLanguage } from "./language";

interface AgentWorkspaceProps
{
    initialConversationId: string | null;
    language?: UiLanguage;
    onOpenConversation(conversationId: string): void;
    session: Session;
}

const agentCopy: Record<UiLanguage, {
    aiAssist: string;
    aiMessage: string;
    anotherOwner: string;
    claim: string;
    claimFirst: string;
    claimed: string;
    close: string;
    closeConfirm: string;
    closed: string;
    closedQueued: string;
    company: string;
    conversationClosed: string;
    conversations: string;
    currentIntent: string;
    customer: string;
    customerCard: string;
    email: string;
    facts: string;
    guardrailContext: string;
    handoffPackage: string;
    failureCode: string;
    finalQueued: string;
    finalRecord: string;
    humanHandoff: string;
    humanMessage: string;
    inbox: string;
    includeClosed: string;
    intentOutcome: string;
    linksAndSources: string;
    loading: string;
    name: string;
    nextStep: string;
    noCandidate: string;
    noConversations: string;
    noSamples: string;
    notCompleted: string;
    notProvided: string;
    phone: string;
    primaryIntent: string;
    replyPlaceholder: string;
    runtime: string;
    safeHandling: string;
    selectConversation: string;
    send: string;
    serverP50: string;
    serverP95: string;
    suggestedActions: string;
    suggestedReply: string;
    suggestedWording: string;
    summary: string;
    serverTimingNote: string;
    titleBody: string;
    useSuggestedReply: string;
    voiceSession: string;
    warmup: string;
    whyEscalated: string;
}> = {
    en: {
        aiAssist: "AI assist",
        aiMessage: "AI",
        anotherOwner: "Another operator owns this conversation.",
        claim: "Claim",
        claimFirst: "Claim this conversation to reply.",
        claimed: "Conversation claimed. AI replies are now stopped.",
        close: "Close",
        closeConfirm: "Close this conversation and generate the final summary?",
        closed: "Conversation closed.",
        closedQueued: "Conversation closed. Final summary is processing asynchronously.",
        company: "Company",
        conversationClosed: "Conversation closed",
        conversations: "Conversations",
        currentIntent: "Current intent",
        customer: "Customer",
        customerCard: "Customer card",
        email: "Email",
        facts: "Confirmed facts",
        guardrailContext: "Guardrail context",
        handoffPackage: "Handoff package",
        failureCode: "Failure code",
        finalQueued: "Finalization queued…",
        finalRecord: "Final record",
        humanHandoff: "Human handoff",
        humanMessage: "Human",
        inbox: "Agent inbox",
        includeClosed: "Include closed",
        intentOutcome: "Intent level / outcome",
        linksAndSources: "Useful sources and links",
        loading: "Loading inbox…",
        name: "Name",
        nextStep: "Next step",
        noCandidate: "No candidate was generated; the input check blocked first.",
        noConversations: "No conversations are waiting.",
        noSamples: "No samples",
        notCompleted: "Not completed",
        notProvided: "Not provided",
        phone: "Phone",
        primaryIntent: "Primary intent",
        replyPlaceholder: "Write a human reply…",
        runtime: "Runtime",
        safeHandling: "Safe handling tips",
        selectConversation: "Select a conversation to review its handoff package.",
        send: "Send",
        serverP50: "Server P50",
        serverP95: "Server P95 / max",
        suggestedActions: "Suggested actions",
        suggestedReply: "Suggested reply",
        suggestedWording: "Suggested wording",
        summary: "Summary",
        serverTimingNote: "Server assistant timing only; browser turn-to-audio evidence is reported separately.",
        titleBody: "Review the customer context, source evidence, and suggested next action before claiming.",
        useSuggestedReply: "Use suggested reply",
        voiceSession: "Voice session",
        warmup: "Warmup",
        whyEscalated: "Why escalated",
    },
    "zh-CN": {
        aiAssist: "AI 辅助",
        aiMessage: "AI",
        anotherOwner: "此会话已由其他客服接管。",
        claim: "接管",
        claimFirst: "请先接管此会话才能回复。",
        claimed: "会话已接管，AI 不会继续回复。",
        close: "结束",
        closeConfirm: "确认结束此会话并生成最终总结？",
        closed: "会话已结束。",
        closedQueued: "会话已结束，最终总结正在异步生成。",
        company: "公司",
        conversationClosed: "会话已结束",
        conversations: "会话列表",
        currentIntent: "当前意图",
        customer: "客户",
        customerCard: "客户卡片",
        email: "邮箱",
        facts: "已确认信息",
        guardrailContext: "安全规则上下文",
        handoffPackage: "接入包",
        failureCode: "失败代码",
        finalQueued: "最终总结已排队…",
        finalRecord: "最终记录",
        humanHandoff: "人工接入",
        humanMessage: "人工客服",
        inbox: "客服会话",
        includeClosed: "包含已结束",
        intentOutcome: "意图级别 / 结果",
        linksAndSources: "有用来源和链接",
        loading: "正在加载会话…",
        name: "姓名",
        nextStep: "下一步",
        noCandidate: "没有生成候选回答；输入检查已先拦截。",
        noConversations: "暂无等待处理的会话。",
        noSamples: "暂无样本",
        notCompleted: "未完成",
        notProvided: "未提供",
        phone: "电话",
        primaryIntent: "主要意图",
        replyPlaceholder: "输入人工回复…",
        runtime: "运行状态",
        safeHandling: "安全处理提示",
        selectConversation: "选择一个会话查看接入包。",
        send: "发送",
        serverP50: "服务端 P50",
        serverP95: "服务端 P95 / 最大",
        suggestedActions: "建议动作",
        suggestedReply: "建议回复",
        suggestedWording: "建议话术",
        summary: "摘要",
        serverTimingNote: "这里只显示服务端助手耗时；浏览器端首音频延迟会单独报告。",
        titleBody: "接管前先查看客户上下文、证据来源和建议下一步。",
        useSuggestedReply: "使用建议回复",
        voiceSession: "语音会话",
        warmup: "预热",
        whyEscalated: "转人工原因",
    },
};

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
function displayValue(value: string | null, language: UiLanguage): string
{
    return value === null || value.trim().length === 0
        ? agentCopy[language].notProvided
        : value;
}

/**
 * formatConversationStatus
 * ----------------
 * Converts stored conversation status values into short operator-facing labels.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService Workspace UX
 */
function formatConversationStatus(status: TeamInboxItem["status"], language: UiLanguage): string
{
    if (language === "zh-CN")
    {
        if (status === "active_human")
        {
            return "人工处理中";
        }

        if (status === "closed")
        {
            return "已结束";
        }

        return "等待接管";
    }

    return status.replace("_", " ");
}

/**
 * formatGuardrailSeverity
 * ----------------
 * Converts guardrail severity values into compact labels inside the Agent handoff view.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService Workspace UX
 */
function formatGuardrailSeverity(severity: string, language: UiLanguage): string
{
    if (language === "zh-CN")
    {
        const labels: Record<string, string> = {
            critical: "严重",
            high: "高",
            low: "低",
            medium: "中",
        };

        return labels[severity] ?? severity;
    }

    return severity;
}

/**
 * collectUsefulCitations
 * ----------------
 * Extracts unique customer-safe citations from the transcript so the handoff package can expose source links without another AI call.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService Handoff Package UX
 */
function collectUsefulCitations(detail: TeamConversationDetail): TeamConversationDetail["messages"][number]["citations"]
{
    const seen = new Set<string>();
    const citations: TeamConversationDetail["messages"][number]["citations"] = [];

    for (const message of detail.messages)
    {
        for (const citation of message.citations)
        {
            const key = `${citation.citationId}:${citation.label}:${citation.sourceUrl ?? ""}`;

            if (seen.has(key))
            {
                continue;
            }

            seen.add(key);
            citations.push(citation);
        }
    }

    return citations.slice(0, 6);
}

/**
 * buildSuggestedActions
 * ----------------
 * Builds deterministic operator next actions from the existing handoff summary, citations, status, and guardrail events.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService Handoff Package UX
 */
function buildSuggestedActions(
    detail: TeamConversationDetail,
    sourceCount: number,
    language: UiLanguage,
): string[]
{
    if (language === "zh-CN")
    {
        return [
            detail.acceptedBy === null
                ? "先点击“接管”，避免客户误以为已经有人回复。"
                : "继续用人工身份回复；AI 已停止自动回答。",
            detail.summary.nextStep,
            sourceCount > 0
                ? "回复前查看下方来源；如果有网页链接，可直接打开确认。"
                : "当前没有可点击来源；如需事实答案，请先到知识库补充资料。",
            detail.guardrailEvents.length > 0
                ? "避免承诺价格、库存、交付日期或安全结论，除非知识库有明确证据。"
                : "确认客户具体需求后，用建议回复作为起点。",
        ];
    }

    return [
        detail.acceptedBy === null
            ? "Claim the conversation before replying so the customer sees a clear takeover."
            : "Continue as the human owner; AI automatic replies are stopped.",
        detail.summary.nextStep,
        sourceCount > 0
            ? "Review the sources below; open any webpage links before making a factual commitment."
            : "No clickable source is available; add approved knowledge before giving company-specific facts.",
        detail.guardrailEvents.length > 0
            ? "Avoid price, stock, delivery, safety, or competitor claims unless approved knowledge supports them."
            : "Confirm the exact customer need, then use the suggested reply as a starting point.",
    ];
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
    language = "en",
    onOpenConversation,
    session,
}: AgentWorkspaceProps): JSX.Element
{
    const copy = agentCopy[language];
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
            setMessage(copy.claimed);
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
     * handleUseSuggestedReply
     * ----------------
     * Copies the current handoff package's suggested reply into the human composer without sending it automatically.
     *
     * July 30, 2026: Created by Forrest Zhang for SmartService Handoff Package UX
     */
    function handleUseSuggestedReply(): void
    {
        if (detail !== null)
        {
            setReply(detail.summary.suggestedReply);
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
            || !globalThis.confirm(copy.closeConfirm)
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
            setMessage(copy.closedQueued);
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
    const usefulCitations = detail === null ? [] : collectUsefulCitations(detail);
    const suggestedActions = detail === null
        ? []
        : buildSuggestedActions(detail, usefulCitations.length, language);

    return (
        <section aria-labelledby="inbox-heading">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <p className="text-sm font-semibold text-sky-700">{copy.humanHandoff}</p>
                    <h2 className="mt-1 text-3xl font-bold tracking-tight" id="inbox-heading">
                        {copy.inbox}
                    </h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                        {copy.titleBody}
                    </p>
                </div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                        checked={includeClosed}
                        className="size-4 rounded border-slate-300"
                        onChange={(event) => setIncludeClosed(event.target.checked)}
                        type="checkbox"
                    />
                    {copy.includeClosed}
                </label>
            </div>

            {message === null
                ? null
                : (
                    <div className="mb-5 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900" role="status">
                        {message}
                    </div>
                )}

            <div className="grid min-h-[720px] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[340px_minmax(0,1fr)]">
                <aside className="border-b border-slate-200 bg-slate-50/70 lg:border-b-0 lg:border-r">
                    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                        <p className="text-sm font-bold">{copy.conversations}</p>
                        <RefreshCw aria-hidden="true" className="size-4 text-slate-400" />
                    </div>

                    {loading
                        ? (
                            <p className="flex items-center gap-2 p-5 text-sm text-slate-500" role="status">
                                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                                {copy.loading}
                            </p>
                        )
                        : conversations.length === 0
                            ? (
                                <div className="p-6 text-center text-sm text-slate-500">
                                    <CheckCircle2 aria-hidden="true" className="mx-auto mb-3 size-7 text-emerald-600" />
                                    {copy.noConversations}
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
                                                    {displayValue(conversation.customer.name, language)}
                                                </p>
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadgeClass(conversation.status)}`}>
                                                    {formatConversationStatus(conversation.status, language)}
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
                            {copy.selectConversation}
                        </div>
                    )
                    : (
                        <div className="grid min-w-0 xl:grid-cols-[minmax(0,1fr)_420px]">
                            <div className="flex min-w-0 flex-col border-b border-slate-200 xl:border-b-0 xl:border-r">
                                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                                    <div>
                                        <p className="font-bold">{displayValue(detail.customer.name, language)}</p>
                                        <p className="mt-1 text-xs text-slate-500">
                                            {detail.customer.language} · {detail.customer.channel}
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        {detail.status === "handoff_requested"
                                            ? (
                                                <Button disabled={busy} onClick={() => void handleClaim()} size="sm">
                                                    <UserRoundCheck aria-hidden="true" className="size-4" />
                                                    {copy.claim}
                                                </Button>
                                            )
                                            : null}
                                        {canReply
                                            ? (
                                                <Button disabled={busy} onClick={() => void handleClose()} size="sm" variant="outline">
                                                    {copy.close}
                                                </Button>
                                            )
                                            : null}
                                    </div>
                                </header>

                                <div className="h-[500px] space-y-4 overflow-y-auto bg-slate-50/50 p-5">
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
                                                {entry.senderType === "customer"
                                                    ? copy.customer
                                                    : entry.senderType === "ai"
                                                        ? copy.aiMessage
                                                        : entry.senderType === "human"
                                                            ? copy.humanMessage
                                                            : entry.senderType}
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
                                                <label className="sr-only" htmlFor="agent-reply">{copy.send}</label>
                                                <textarea
                                                    className="min-h-11 flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
                                                    id="agent-reply"
                                                    maxLength={5000}
                                                    onChange={(event) => setReply(event.target.value)}
                                                    placeholder={copy.replyPlaceholder}
                                                    value={reply}
                                                />
                                                <Button disabled={busy || reply.trim().length === 0} type="submit">
                                                    <Send aria-hidden="true" className="size-4" />
                                                    {copy.send}
                                                </Button>
                                            </form>
                                        )
                                        : (
                                            <p className="flex items-center gap-2 text-sm text-slate-500">
                                                <Headphones aria-hidden="true" className="size-4" />
                                                {detail.status === "closed"
                                                    ? copy.closed
                                                    : detail.acceptedBy === null
                                                        ? copy.claimFirst
                                                        : copy.anotherOwner}
                                            </p>
                                        )}
                                </div>
                            </div>

                            <aside className="max-h-[720px] space-y-5 overflow-y-auto bg-slate-50/60 p-5">
                                <section>
                                    <h3 className="text-sm font-bold">{copy.customerCard}</h3>
                                    <dl className="mt-3 grid gap-3 text-xs">
                                        {[
                                            [copy.name, detail.customer.name],
                                            [copy.email, detail.customer.email],
                                            [copy.phone, detail.customer.phone],
                                            [copy.company, detail.customer.company],
                                        ].map(([label, value]) => (
                                            <div key={label}>
                                                <dt className="text-slate-400">{label}</dt>
                                                <dd className="mt-0.5 break-words font-medium text-slate-800">
                                                    {displayValue(value ?? null, language)}
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
                                                {copy.voiceSession}
                                            </h3>
                                            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs text-violet-950">
                                                <div>
                                                    <dt className="font-bold">{copy.runtime}</dt>
                                                    <dd>{detail.voiceSession.provider} · {detail.voiceSession.status}</dd>
                                                </div>
                                                <div>
                                                    <dt className="font-bold">{copy.warmup}</dt>
                                                    <dd>{detail.voiceSession.warmupMs === null
                                                        ? copy.notCompleted
                                                        : `${detail.voiceSession.warmupMs} ms`}</dd>
                                                </div>
                                                <div>
                                                    <dt className="font-bold">{copy.serverP50}</dt>
                                                    <dd>{detail.voiceSession.serverAssistantLatency.p50Ms === null
                                                        ? copy.noSamples
                                                        : `${detail.voiceSession.serverAssistantLatency.p50Ms} ms`}</dd>
                                                </div>
                                                <div>
                                                    <dt className="font-bold">{copy.serverP95}</dt>
                                                    <dd>{detail.voiceSession.serverAssistantLatency.p95Ms === null
                                                        ? copy.noSamples
                                                        : `${detail.voiceSession.serverAssistantLatency.p95Ms} / ${detail.voiceSession.serverAssistantLatency.maxMs} ms`}</dd>
                                                </div>
                                            </dl>
                                            <p className="mt-3 text-[11px] text-violet-800">
                                                {copy.serverTimingNote}
                                            </p>
                                            {detail.voiceSession.errorCode === null
                                                ? null
                                                : (
                                                    <p className="mt-2 text-[11px] font-semibold text-rose-700">
                                                        {copy.failureCode}: {detail.voiceSession.errorCode}
                                                    </p>
                                                )}
                                        </section>
                                    )}

                                <section className="rounded-2xl border border-sky-100 bg-white p-4 shadow-sm">
                                    <h3 className="flex items-center gap-2 text-sm font-bold text-sky-950">
                                        <MessageSquareText aria-hidden="true" className="size-4" />
                                        {copy.handoffPackage}
                                    </h3>
                                    <dl className="mt-4 space-y-3 text-xs leading-5 text-sky-950">
                                        <div className="rounded-xl bg-sky-50 p-3">
                                            <dt className="font-bold">{copy.summary}</dt>
                                            <dd className="mt-1">{detail.summary.conversationSummary}</dd>
                                        </div>
                                        <div>
                                            <dt className="font-bold">{copy.currentIntent}</dt>
                                            <dd>{detail.summary.currentIntent}</dd>
                                        </div>
                                        <div>
                                            <dt className="font-bold">{copy.whyEscalated}</dt>
                                            <dd>{detail.summary.triggerReason}</dd>
                                        </div>
                                        <div>
                                            <dt className="font-bold">{copy.nextStep}</dt>
                                            <dd>{detail.summary.nextStep}</dd>
                                        </div>
                                    </dl>
                                    {detail.summary.confirmedFacts.length === 0
                                        ? null
                                        : (
                                            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                                                <p className="text-xs font-bold text-slate-700">{copy.facts}</p>
                                                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-700">
                                                    {detail.summary.confirmedFacts.map((fact) => (
                                                        <li key={fact}>{fact}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-xs font-bold text-emerald-950">{copy.suggestedReply}</p>
                                            <Button
                                                disabled={!canReply}
                                                onClick={handleUseSuggestedReply}
                                                size="sm"
                                                type="button"
                                                variant="outline"
                                            >
                                                {copy.useSuggestedReply}
                                            </Button>
                                        </div>
                                        <p className="mt-2 text-xs leading-5 text-emerald-950">
                                            {detail.summary.suggestedReply}
                                        </p>
                                    </div>
                                </section>

                                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                                    <h3 className="flex items-center gap-2 text-sm font-bold text-slate-950">
                                        <ListChecks aria-hidden="true" className="size-4 text-sky-700" />
                                        {copy.suggestedActions}
                                    </h3>
                                    <ol className="mt-3 space-y-2 text-xs leading-5 text-slate-700">
                                        {suggestedActions.map((action) => (
                                            <li className="flex gap-2" key={action}>
                                                <CheckCircle2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                                                <span>{action}</span>
                                            </li>
                                        ))}
                                    </ol>
                                </section>

                                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                                    <h3 className="flex items-center gap-2 text-sm font-bold text-slate-950">
                                        <MessageSquareText aria-hidden="true" className="size-4 text-sky-700" />
                                        {copy.linksAndSources}
                                    </h3>
                                    {usefulCitations.length === 0
                                        ? (
                                            <p className="mt-3 text-xs leading-5 text-slate-500">
                                                {language === "zh-CN"
                                                    ? "当前会话没有可复用引用来源。"
                                                    : "No reusable citation source is available in this conversation."}
                                            </p>
                                        )
                                        : (
                                            <div className="mt-3 space-y-2">
                                                {usefulCitations.map((citation) => (
                                                    <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs" key={citation.citationId}>
                                                        <p className="font-bold text-slate-900">{citation.label}</p>
                                                        <p className="mt-1 line-clamp-3 leading-5 text-slate-600">
                                                            {citation.supportingExcerpt}
                                                        </p>
                                                        {citation.sourceUrl === null
                                                            ? null
                                                            : (
                                                                <a
                                                                    className="mt-2 inline-flex items-center gap-1 font-semibold text-sky-700"
                                                                    href={citation.sourceUrl}
                                                                    rel="noreferrer"
                                                                    target="_blank"
                                                                >
                                                                    {language === "zh-CN" ? "打开来源链接" : "Open source link"}
                                                                    <ExternalLink aria-hidden="true" className="size-3" />
                                                                </a>
                                                            )}
                                                    </article>
                                                ))}
                                            </div>
                                        )}
                                </section>

                                {detail.guardrailEvents.length > 0
                                    ? (
                                        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                                            <h3 className="flex items-center gap-2 text-sm font-bold text-amber-950">
                                                <AlertTriangle aria-hidden="true" className="size-4" />
                                                {copy.guardrailContext}
                                            </h3>
                                            <ul className="mt-3 space-y-3 text-xs text-amber-950">
                                                {detail.guardrailEvents.map((event) => (
                                                    <li key={event.id}>
                                                        <p className="font-bold">{event.ruleCode} · {formatGuardrailSeverity(event.severity, language)}</p>
                                                        <p className="mt-1 leading-5">{event.reason}</p>
                                                    </li>
                                                ))}
                                            </ul>
                                            <p className="mt-3 text-[11px] text-amber-800">
                                                {language === "zh-CN"
                                                    ? "被拦截的候选回答默认不向客服展示。"
                                                    : "Withheld candidate text is redacted from Agent views."}
                                            </p>
                                        </section>
                                    )
                                    : null}

                                {detail.status === "closed"
                                    ? (
                                        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                                            <h3 className="text-sm font-bold text-emerald-950">{copy.finalRecord}</h3>
                                            {detail.summaryRecord === null
                                                ? (
                                                    <p className="mt-2 flex items-center gap-2 text-xs text-emerald-900">
                                                        <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
                                                        {copy.finalQueued}
                                                    </p>
                                                )
                                                : (
                                                    <dl className="mt-3 space-y-3 text-xs leading-5 text-emerald-950">
                                                        <div>
                                                            <dt className="font-bold">{copy.summary}</dt>
                                                            <dd>{detail.summaryRecord.summary}</dd>
                                                        </div>
                                                        <div>
                                                            <dt className="font-bold">{copy.primaryIntent}</dt>
                                                            <dd>{detail.summaryRecord.primaryIntent}</dd>
                                                        </div>
                                                        <div>
                                                            <dt className="font-bold">{copy.intentOutcome}</dt>
                                                            <dd>{detail.summaryRecord.intentLevel} / {detail.summaryRecord.outcome}</dd>
                                                        </div>
                                                        <div>
                                                            <dt className="font-bold">{copy.suggestedWording}</dt>
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
