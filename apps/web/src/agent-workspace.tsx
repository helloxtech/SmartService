import type {
    TeamConversationDetail,
    TeamConversationListItem,
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

import { normalizeVisibleDemoBrand } from "./branding";
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
    api?: AgentWorkspaceApi;
    initialConversationId: string | null;
    language?: UiLanguage;
    onOpenConversation(conversationId: string): void;
    session: Session;
}

type ConversationFilter = "all" | "voice" | "text" | "handoff" | "closed";

const defaultAgentWorkspaceApi = {
    claim: claimTeamConversation,
    close: closeTeamConversation,
    get: getTeamConversation,
    list: listTeamConversations,
    send: sendTeamMessage,
};

export type AgentWorkspaceApi = typeof defaultAgentWorkspaceApi;

const agentCopy: Record<UiLanguage, {
    aiAssist: string;
    aiAssistFailed: string;
    aiAssistPending: string;
    aiAssistReady: string;
    aiAssistReview: string;
    aiAssistUsed: string;
    aiMessage: string;
    allFilter: string;
    anotherOwner: string;
    claim: string;
    claimFirst: string;
    claimed: string;
    close: string;
    closeConfirm: string;
    closed: string;
    closedQueued: string;
    closedFilter: string;
    company: string;
    conversationClosed: string;
    conversations: string;
    currentIntent: string;
    customer: string;
    customerCard: string;
    email: string;
    facts: string;
    followUpActions: string;
    guardrailContext: string;
    handoffPackage: string;
    failureCode: string;
    finalQueued: string;
    finalRecord: string;
    humanHandoff: string;
    humanMessage: string;
    handoffFilter: string;
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
    recordedCustomerFacts: string;
    replyPlaceholder: string;
    readOnly: string;
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
    textFilter: string;
    useSuggestedReply: string;
    voiceSession: string;
    voiceFilter: string;
    warmup: string;
    whyEscalated: string;
}> = {
    en: {
        aiAssist: "AI assist",
        aiAssistFailed: "The current suggestion could not be prepared. Continue manually or retry when the customer sends another message.",
        aiAssistPending: "Preparing a grounded reply from this company's approved knowledge…",
        aiAssistReady: "Grounded draft ready",
        aiAssistReview: "Review the wording and sources before sending. This draft is never sent automatically.",
        aiAssistUsed: "This suggestion was used in the human reply.",
        aiMessage: "Online service",
        allFilter: "All",
        anotherOwner: "Another operator owns this conversation.",
        claim: "Claim",
        claimFirst: "Claim this conversation to reply.",
        claimed: "Conversation claimed. AI replies are now stopped.",
        close: "Close",
        closeConfirm: "Close this conversation and generate the final summary?",
        closed: "Conversation closed.",
        closedQueued: "Conversation closed. Final summary is processing asynchronously.",
        closedFilter: "Closed",
        company: "Company",
        conversationClosed: "Conversation closed",
        conversations: "Conversations",
        currentIntent: "Current intent",
        customer: "Customer",
        customerCard: "Customer card",
        email: "Email",
        facts: "Confirmed facts",
        followUpActions: "Follow-up actions",
        guardrailContext: "Guardrail context",
        handoffPackage: "Handoff package",
        failureCode: "Failure code",
        finalQueued: "Finalization queued…",
        finalRecord: "Final record",
        humanHandoff: "Human handoff",
        humanMessage: "Human",
        handoffFilter: "Handoff",
        inbox: "Conversation center",
        includeClosed: "Include closed",
        intentOutcome: "Intent level / outcome",
        linksAndSources: "Useful sources and links",
        loading: "Loading conversations…",
        name: "Name",
        nextStep: "Next step",
        noCandidate: "No candidate was generated; the input check blocked first.",
        noConversations: "No conversations match this filter.",
        noSamples: "No samples",
        notCompleted: "Not completed",
        notProvided: "Not provided",
        phone: "Phone",
        primaryIntent: "Primary intent",
        recordedCustomerFacts: "Recorded customer facts",
        replyPlaceholder: "Write a human reply…",
        readOnly: "This customer-service conversation is read-only. Claim and reply become available only after a specialist handoff.",
        runtime: "Runtime",
        safeHandling: "Safe handling tips",
        selectConversation: "Select a conversation to review its transcript and service details.",
        send: "Send",
        serverP50: "Server P50",
        serverP95: "Server P95 / max",
        suggestedActions: "Suggested actions",
        suggestedReply: "Suggested reply",
        suggestedWording: "Suggested wording",
        summary: "Summary",
        serverTimingNote: "Server assistant timing only; browser turn-to-audio evidence is reported separately.",
        titleBody: "Review text, voice, active, handed-off, and closed customer conversations in one place.",
        textFilter: "Text",
        useSuggestedReply: "Use suggested reply",
        voiceSession: "Voice session",
        voiceFilter: "Voice",
        warmup: "Warmup",
        whyEscalated: "Why escalated",
    },
    "zh-CN": {
        aiAssist: "AI 辅助",
        aiAssistFailed: "当前建议话术未能生成。您可以继续人工回复；客户发送新消息后系统会再次尝试。",
        aiAssistPending: "正在基于本企业已批准的知识准备回复建议…",
        aiAssistReady: "有依据的建议话术已准备好",
        aiAssistReview: "发送前请核对话术和来源；系统不会自动发送这段内容。",
        aiAssistUsed: "这条建议已用于人工回复。",
        aiMessage: "在线客服",
        allFilter: "全部",
        anotherOwner: "此会话已由其他客服接管。",
        claim: "接管",
        claimFirst: "请先接管此会话才能回复。",
        claimed: "会话已接管，AI 不会继续回复。",
        close: "结束",
        closeConfirm: "确认结束此会话并生成最终总结？",
        closed: "会话已结束。",
        closedQueued: "会话已结束，最终总结正在异步生成。",
        closedFilter: "已结束",
        company: "公司",
        conversationClosed: "会话已结束",
        conversations: "会话列表",
        currentIntent: "当前意图",
        customer: "客户",
        customerCard: "客户卡片",
        email: "邮箱",
        facts: "已确认信息",
        followUpActions: "后续行动",
        guardrailContext: "安全规则上下文",
        handoffPackage: "接入包",
        failureCode: "失败代码",
        finalQueued: "最终总结已排队…",
        finalRecord: "最终记录",
        humanHandoff: "人工接入",
        humanMessage: "人工客服",
        handoffFilter: "转人工",
        inbox: "会话中心",
        includeClosed: "包含已结束",
        intentOutcome: "意图级别 / 结果",
        linksAndSources: "有用来源和链接",
        loading: "正在加载全部会话…",
        name: "姓名",
        nextStep: "下一步",
        noCandidate: "没有生成候选回答；输入检查已先拦截。",
        noConversations: "当前筛选条件下暂无会话。",
        noSamples: "暂无样本",
        notCompleted: "未完成",
        notProvided: "未提供",
        phone: "电话",
        primaryIntent: "主要意图",
        recordedCustomerFacts: "已记录的客户信息",
        replyPlaceholder: "输入人工回复…",
        readOnly: "此在线客服会话为只读记录；只有客户转接客服专员后，才会出现接管和回复操作。",
        runtime: "运行状态",
        safeHandling: "安全处理提示",
        selectConversation: "选择一个会话查看对话记录和服务详情。",
        send: "发送",
        serverP50: "服务端 P50",
        serverP95: "服务端 P95 / 最大",
        suggestedActions: "建议动作",
        suggestedReply: "建议回复",
        suggestedWording: "建议话术",
        summary: "摘要",
        serverTimingNote: "这里只显示服务端助手耗时；浏览器端首音频延迟会单独报告。",
        titleBody: "在一个页面查看文字、语音、进行中、已转人工和已结束的客户会话。",
        textFilter: "文字",
        useSuggestedReply: "使用建议回复",
        voiceSession: "语音会话",
        voiceFilter: "语音",
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
function formatConversationStatus(
    conversation: TeamConversationListItem,
    language: UiLanguage,
): string
{
    const labels: Record<UiLanguage, Record<TeamConversationListItem["status"], string>> = {
        en: {
            active_ai: "In service",
            active_human: "Human service",
            closed: "Closed",
            handoff_requested: "Awaiting human",
            resolved_ai: "Resolved",
        },
        "zh-CN": {
            active_ai: "客服处理中",
            active_human: "人工处理中",
            closed: "已结束",
            handoff_requested: "等待人工",
            resolved_ai: "客服已解决",
        },
    };

    if (conversation.status === "active_ai" && conversation.customer.channel === "voice")
    {
        if (conversation.voiceSessionStatus === "closed")
        {
            return language === "zh-CN" ? "通话已结束" : "Voice ended";
        }

        if (conversation.voiceSessionStatus === "failed")
        {
            return language === "zh-CN" ? "通话未完成" : "Voice failed";
        }
    }

    return labels[language][conversation.status];
}

/**
 * matchesConversationFilter
 * ----------------
 * Applies the operator's channel or workflow filter to the complete tenant conversation list.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService Cross-Channel Conversation Center
 */
function matchesConversationFilter(
    conversation: TeamConversationListItem,
    filter: ConversationFilter,
): boolean
{
    if (filter === "voice" || filter === "text")
    {
        return conversation.customer.channel === filter;
    }

    if (filter === "handoff")
    {
        return conversation.status === "handoff_requested"
            || conversation.status === "active_human";
    }

    if (filter === "closed")
    {
        return conversation.status === "closed";
    }

    return true;
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
 * Extracts unique customer-safe citations from the current live suggestion and transcript so the operator can verify every factual draft without another AI call.
 *
 * August 07, 2026: Updated by Forrest Zhang for SmartService R10 Human Agent Assistance
 */
function collectUsefulCitations(detail: TeamConversationDetail): TeamConversationDetail["messages"][number]["citations"]
{
    const seen = new Set<string>();
    const citations: TeamConversationDetail["messages"][number]["citations"] = [];
    const candidateGroups = [
        detail.assistantSuggestion?.citations ?? [],
        ...detail.messages.map((message) => message.citations),
    ];

    for (const group of candidateGroups)
    {
        for (const citation of group)
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
    if (detail.summary === null)
    {
        return [];
    }

    const summary = detail.summary;

    if (language === "zh-CN")
    {
        return [
            detail.acceptedBy === null
                ? "先点击“接管”，避免客户误以为已经有人回复。"
                : "继续用人工身份回复；AI 已停止自动回答。",
            summary.nextStep,
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
        summary.nextStep,
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
function statusBadgeClass(conversation: TeamConversationListItem): string
{
    const status = conversation.status;

    if (
        status === "active_ai"
        && conversation.customer.channel === "voice"
        && (conversation.voiceSessionStatus === "closed" || conversation.voiceSessionStatus === "failed")
    )
    {
        return "border-slate-200 bg-slate-100 text-slate-700";
    }

    if (status === "active_human")
    {
        return "border-violet-200 bg-violet-50 text-violet-800";
    }

    if (status === "active_ai")
    {
        return "border-sky-200 bg-sky-50 text-sky-800";
    }

    if (status === "resolved_ai")
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
    api = defaultAgentWorkspaceApi,
    initialConversationId,
    language = "en",
    onOpenConversation,
    session,
}: AgentWorkspaceProps): JSX.Element
{
    const copy = agentCopy[language];
    const [conversations, setConversations] = useState<TeamConversationListItem[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(
        initialConversationId,
    );
    const [detail, setDetail] = useState<TeamConversationDetail | null>(null);
    const [filter, setFilter] = useState<ConversationFilter>("all");
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [reply, setReply] = useState("");
    const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
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
                const inbox = await api.list(session, true);

                if (!active)
                {
                    return;
                }

                setConversations(inbox);
                const visibleInbox = inbox.filter((conversation) =>
                    matchesConversationFilter(conversation, filter),
                );
                const selectedIsVisible = selectedId !== null
                    && visibleInbox.some((conversation) => conversation.conversationId === selectedId);
                const targetId = selectedIsVisible
                    ? selectedId
                    : visibleInbox[0]?.conversationId ?? null;

                if (selectedId !== targetId)
                {
                    setSelectedId(targetId);
                    setReply("");
                    setSelectedSuggestionId(null);
                }

                if (targetId === null)
                {
                    setDetail(null);
                    setLoading(false);
                    return;
                }

                const currentDetail = await api.get(session, targetId);

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
    }, [api, filter, selectedId, session]);

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
            api.list(session, true),
            api.get(session, conversationId),
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
            await api.claim(session, detail.conversationId);
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
            await api.send(
                session,
                detail.conversationId,
                reply.trim(),
                detail.assistantSuggestion?.id === selectedSuggestionId
                    && detail.assistantSuggestion.status === "ready"
                    ? selectedSuggestionId
                    : null,
            );
            setReply("");
            setSelectedSuggestionId(null);
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
     * Copies the newest ready grounded suggestion, or the handoff fallback when none exists, into the human composer without sending it automatically.
     *
     * August 07, 2026: Updated by Forrest Zhang for SmartService R10 Human Agent Assistance
     */
    function handleUseSuggestedReply(): void
    {
        if (
            detail?.assistantSuggestion?.status === "ready"
            && detail.assistantSuggestion.draftText !== null
        )
        {
            setReply(normalizeVisibleDemoBrand(detail.assistantSuggestion.draftText));
            setSelectedSuggestionId(detail.assistantSuggestion.id);
            return;
        }

        if (detail?.summary !== null && detail?.summary !== undefined)
        {
            setReply(normalizeVisibleDemoBrand(detail.summary.suggestedReply));
            setSelectedSuggestionId(null);
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
            await api.close(session, detail.conversationId);
            setFilter("closed");
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
    const assistantSuggestion = detail?.assistantSuggestion ?? null;
    const hasReadySuggestion = assistantSuggestion?.status === "ready"
        && assistantSuggestion.draftText !== null;
    const usefulCitations = detail === null ? [] : collectUsefulCitations(detail);
    const suggestedActions = detail?.summary === null || detail === null
        ? []
        : buildSuggestedActions(detail, usefulCitations.length, language);
    const visibleConversations = conversations.filter((conversation) =>
        matchesConversationFilter(conversation, filter),
    );
    const filterOptions: Array<{ label: string; value: ConversationFilter }> = [
        { label: copy.allFilter, value: "all" },
        { label: copy.voiceFilter, value: "voice" },
        { label: copy.textFilter, value: "text" },
        { label: copy.handoffFilter, value: "handoff" },
        { label: copy.closedFilter, value: "closed" },
    ];

    return (
        <section aria-labelledby="inbox-heading" className="space-y-4">
            <h2 className="sr-only" id="inbox-heading">
                {copy.inbox}
            </h2>

            {message === null
                ? null
                : (
                    <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900" role="status">
                        {message}
                    </div>
                )}

            <div className="grid min-h-[calc(100vh-9rem)] overflow-hidden rounded-[2rem] border border-white/70 bg-white/90 shadow-[0_28px_90px_rgba(15,23,42,0.12)] backdrop-blur lg:grid-cols-[360px_minmax(0,1fr)]">
                <aside className="border-b border-slate-200 bg-slate-50/80 lg:border-b-0 lg:border-r">
                    <div className="space-y-3 border-b border-slate-200 px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-sm font-bold">{copy.inbox}</p>
                                <p className="mt-1 text-xs leading-5 text-slate-500">{copy.titleBody}</p>
                            </div>
                            <RefreshCw aria-hidden="true" className="mt-1 size-4 shrink-0 text-slate-400" />
                        </div>
                        <div aria-label={copy.conversations} className="flex flex-wrap gap-1.5" role="group">
                            {filterOptions.map((option) => (
                                <button
                                    aria-pressed={filter === option.value}
                                    className={filter === option.value
                                        ? "rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white"
                                        : "rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-sky-300 hover:text-sky-800"}
                                    key={option.value}
                                    onClick={() => setFilter(option.value)}
                                    type="button"
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {loading
                        ? (
                            <p className="flex items-center gap-2 p-5 text-sm text-slate-500" role="status">
                                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                                {copy.loading}
                            </p>
                        )
                        : visibleConversations.length === 0
                            ? (
                                <div className="p-6 text-center text-sm text-slate-500">
                                    <CheckCircle2 aria-hidden="true" className="mx-auto mb-3 size-7 text-emerald-600" />
                                    {copy.noConversations}
                                </div>
                            )
                            : (
                                <div className="max-h-[calc(100vh-13rem)] min-h-[560px] overflow-y-auto">
                                    {visibleConversations.map((conversation) => (
                                        <button
                                            className={conversation.conversationId === selectedId
                                                ? "block w-full border-b border-slate-200 bg-white px-4 py-4 text-left shadow-[inset_3px_0_0_rgb(2,132,199)]"
                                                : "block w-full border-b border-slate-200 px-4 py-4 text-left hover:bg-white"}
                                            key={conversation.conversationId}
                                            onClick={() =>
                                            {
                                                setSelectedId(conversation.conversationId);
                                                setReply("");
                                                setSelectedSuggestionId(null);
                                                onOpenConversation(conversation.conversationId);
                                            }}
                                            type="button"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-bold">
                                                        {displayValue(conversation.customer.name, language)}
                                                    </p>
                                                    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                                        {conversation.customer.channel === "voice"
                                                            ? <Headphones aria-hidden="true" className="size-3" />
                                                            : <MessageSquareText aria-hidden="true" className="size-3" />}
                                                        {conversation.customer.channel === "voice"
                                                            ? copy.voiceFilter
                                                            : copy.textFilter}
                                                    </span>
                                                </div>
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadgeClass(conversation)}`}>
                                                    {formatConversationStatus(conversation, language)}
                                                </span>
                                            </div>
                                            <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">
                                                {conversation.preview === null
                                                    ? copy.notProvided
                                                    : normalizeVisibleDemoBrand(conversation.preview)}
                                            </p>
                                            <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-400">
                                                <Clock3 aria-hidden="true" className="size-3" />
                                                {formatTime(conversation.latestActivityAt)}
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
                        <div className="grid min-w-0 2xl:grid-cols-[minmax(620px,1fr)_500px]">
                            <div className="flex min-w-0 flex-col border-b border-slate-200 2xl:border-b-0 2xl:border-r">
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

                                <div className="h-[min(64vh,720px)] min-h-[540px] space-y-4 overflow-y-auto bg-slate-50/60 p-6">
                                    {detail.messages.map((entry) => (
                                        <article
                                            className={entry.senderType === "customer"
                                                ? "mr-auto max-w-[78%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white p-4 shadow-sm"
                                                : entry.senderType === "human"
                                                    ? "ml-auto max-w-[78%] rounded-2xl rounded-br-sm bg-sky-700 p-4 text-white shadow-sm"
                                                    : "ml-auto max-w-[78%] rounded-2xl rounded-br-sm bg-slate-900 p-4 text-white shadow-sm"}
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
                                            <p className="whitespace-pre-wrap text-sm leading-6">{normalizeVisibleDemoBrand(entry.text)}</p>
                                            {entry.citations.length > 0
                                                ? (
                                                    <ul className="mt-3 space-y-1 border-t border-white/20 pt-2 text-xs opacity-80">
                                                        {entry.citations.map((citation) => (
                                                            <li key={citation.citationId}>{normalizeVisibleDemoBrand(citation.label)}</li>
                                                        ))}
                                                    </ul>
                                                )
                                                : null}
                                        </article>
                                    ))}
                                </div>

                                <div className="border-t border-slate-200 bg-white/90 p-4">
                                    {canReply
                                        ? (
                                            <form className="flex gap-3" onSubmit={handleReply}>
                                                <label className="sr-only" htmlFor="agent-reply">{copy.send}</label>
                                                <textarea
                                                    className="min-h-14 flex-1 resize-none rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-sky-600 focus:bg-white focus:ring-4 focus:ring-sky-100"
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
                                                    : detail.status === "handoff_requested"
                                                        ? copy.claimFirst
                                                        : detail.status === "active_human"
                                                            ? copy.anotherOwner
                                                            : copy.readOnly}
                                            </p>
                                        )}
                                </div>
                            </div>

                            <aside className="max-h-[calc(100vh-9rem)] space-y-5 overflow-y-auto bg-slate-50/80 p-6">
                                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                                    <h3 className="text-sm font-bold">{copy.customerCard}</h3>
                                    <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2 2xl:grid-cols-1">
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

                                {assistantSuggestion === null
                                    ? null
                                    : (
                                        <section
                                            aria-live="polite"
                                            className="rounded-[1.5rem] border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-sky-50 p-5 shadow-sm"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <h3 className="flex items-center gap-2 text-sm font-bold text-violet-950">
                                                        {assistantSuggestion.status === "pending"
                                                            ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                                                            : assistantSuggestion.status === "failed"
                                                                ? <AlertTriangle aria-hidden="true" className="size-4 text-amber-600" />
                                                                : <CheckCircle2 aria-hidden="true" className="size-4 text-emerald-600" />}
                                                        {copy.aiAssist}
                                                    </h3>
                                                    <p className="mt-1 text-xs leading-5 text-violet-800">
                                                        {assistantSuggestion.status === "pending"
                                                            ? copy.aiAssistPending
                                                            : assistantSuggestion.status === "failed"
                                                                ? copy.aiAssistFailed
                                                                : assistantSuggestion.status === "used"
                                                                    ? copy.aiAssistUsed
                                                                    : copy.aiAssistReady}
                                                    </p>
                                                </div>
                                                {hasReadySuggestion
                                                    ? (
                                                        <Button
                                                            disabled={!canReply}
                                                            onClick={handleUseSuggestedReply}
                                                            size="sm"
                                                            type="button"
                                                            variant="outline"
                                                        >
                                                            {copy.useSuggestedReply}
                                                        </Button>
                                                    )
                                                    : null}
                                            </div>

                                            {assistantSuggestion.draftText === null
                                                ? null
                                                : (
                                                    <div className="mt-4 rounded-2xl border border-violet-100 bg-white p-4">
                                                        <p className="whitespace-pre-wrap text-sm leading-6 text-slate-900">
                                                            {normalizeVisibleDemoBrand(assistantSuggestion.draftText)}
                                                        </p>
                                                        <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] leading-5 text-slate-500">
                                                            {copy.aiAssistReview}
                                                        </p>
                                                    </div>
                                                )}

                                            {assistantSuggestion.citations.length === 0
                                                ? null
                                                : (
                                                    <div className="mt-4 space-y-2">
                                                        {assistantSuggestion.citations.map((citation) => (
                                                            <article className="rounded-xl border border-sky-200 bg-sky-50/80 p-3 text-xs" key={citation.citationId}>
                                                                <p className="font-bold text-sky-950">{normalizeVisibleDemoBrand(citation.label)}</p>
                                                                <p className="mt-1 line-clamp-3 leading-5 text-sky-900/75">
                                                                    {normalizeVisibleDemoBrand(citation.supportingExcerpt)}
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
                                                                            {language === "zh-CN" ? "核对来源" : "Verify source"}
                                                                            <ExternalLink aria-hidden="true" className="size-3" />
                                                                        </a>
                                                                    )}
                                                            </article>
                                                        ))}
                                                    </div>
                                                )}
                                        </section>
                                    )}

                                {detail.summary === null
                                    ? null
                                    : (
                                        <>
                                            <section className="rounded-[1.5rem] border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-5 shadow-sm">
                                                <h3 className="flex items-center gap-2 text-sm font-bold text-sky-950">
                                                    <MessageSquareText aria-hidden="true" className="size-4" />
                                                    {copy.handoffPackage}
                                                </h3>
                                                <dl className="mt-4 space-y-3 text-xs leading-5 text-sky-950">
                                                    <div className="rounded-2xl border border-sky-100 bg-white/80 p-3">
                                                        <dt className="font-bold">{copy.summary}</dt>
                                                        <dd className="mt-1">{normalizeVisibleDemoBrand(detail.summary.conversationSummary)}</dd>
                                                    </div>
                                                    <div>
                                                        <dt className="font-bold">{copy.currentIntent}</dt>
                                                        <dd>{normalizeVisibleDemoBrand(detail.summary.currentIntent)}</dd>
                                                    </div>
                                                    <div>
                                                        <dt className="font-bold">{copy.whyEscalated}</dt>
                                                        <dd>{normalizeVisibleDemoBrand(detail.summary.triggerReason)}</dd>
                                                    </div>
                                                    <div>
                                                        <dt className="font-bold">{copy.nextStep}</dt>
                                                        <dd>{normalizeVisibleDemoBrand(detail.summary.nextStep)}</dd>
                                                    </div>
                                                </dl>
                                                {detail.summary.confirmedFacts.length === 0
                                                    ? null
                                                    : (
                                                        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                                                            <p className="text-xs font-bold text-slate-700">{copy.facts}</p>
                                                            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-700">
                                                                {detail.summary.confirmedFacts.map((fact) => (
                                                                    <li key={fact}>{normalizeVisibleDemoBrand(fact)}</li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    )}
                                                {assistantSuggestion === null
                                                    ? (
                                                        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
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
                                                                {normalizeVisibleDemoBrand(detail.summary.suggestedReply)}
                                                            </p>
                                                        </div>
                                                    )
                                                    : null}
                                            </section>

                                            <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
                                                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-950">
                                                    <ListChecks aria-hidden="true" className="size-4 text-sky-700" />
                                                    {copy.suggestedActions}
                                                </h3>
                                                <ol className="mt-3 space-y-2 text-xs leading-5 text-slate-700">
                                                    {suggestedActions.map((action) => (
                                                        <li className="flex gap-2" key={action}>
                                                            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                                                            <span>{normalizeVisibleDemoBrand(action)}</span>
                                                        </li>
                                                    ))}
                                                </ol>
                                            </section>
                                        </>
                                    )}

                                <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
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
                                                        <p className="font-bold text-slate-900">{normalizeVisibleDemoBrand(citation.label)}</p>
                                                        <p className="mt-1 line-clamp-3 leading-5 text-slate-600">
                                                            {normalizeVisibleDemoBrand(citation.supportingExcerpt)}
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
                                                            <dd>{normalizeVisibleDemoBrand(detail.summaryRecord.summary)}</dd>
                                                        </div>
                                                        <div>
                                                            <dt className="font-bold">{copy.primaryIntent}</dt>
                                                            <dd>{normalizeVisibleDemoBrand(detail.summaryRecord.primaryIntent)}</dd>
                                                        </div>
                                                        <div>
                                                            <dt className="font-bold">{copy.intentOutcome}</dt>
                                                            <dd>{detail.summaryRecord.intentLevel} / {detail.summaryRecord.outcome}</dd>
                                                        </div>
                                                        <div>
                                                            <dt className="font-bold">{copy.recordedCustomerFacts}</dt>
                                                            {detail.summaryRecord.customerFacts.length === 0
                                                                ? <dd>{copy.notProvided}</dd>
                                                                : (
                                                                    <dd>
                                                                        <ul className="mt-1 list-disc space-y-1 pl-4">
                                                                            {detail.summaryRecord.customerFacts.map((fact) => (
                                                                                <li key={`${fact.key}:${fact.value}`}>
                                                                                    <span className="font-semibold">{normalizeVisibleDemoBrand(fact.key)}:</span>{" "}
                                                                                    {normalizeVisibleDemoBrand(fact.value)}
                                                                                </li>
                                                                            ))}
                                                                        </ul>
                                                                    </dd>
                                                                )}
                                                        </div>
                                                        <div>
                                                            <dt className="font-bold">{copy.followUpActions}</dt>
                                                            {detail.summaryRecord.followUpActions.length === 0
                                                                ? <dd>{copy.notCompleted}</dd>
                                                                : (
                                                                    <dd>
                                                                        <ol className="mt-1 list-decimal space-y-1 pl-4">
                                                                            {detail.summaryRecord.followUpActions.map((action) => (
                                                                                <li key={action}>{normalizeVisibleDemoBrand(action)}</li>
                                                                            ))}
                                                                        </ol>
                                                                    </dd>
                                                                )}
                                                        </div>
                                                        <div>
                                                            <dt className="font-bold">{copy.suggestedWording}</dt>
                                                            <dd>{normalizeVisibleDemoBrand(detail.summaryRecord.suggestedScript)}</dd>
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
