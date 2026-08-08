import {
    teamConversationListItemSchema,
    type ClaimConversationResponse,
    type CloseConversationResponse,
    type SendHumanMessageResponse,
    type TeamConversationDetail,
    type TeamConversationListItem,
} from "@smartservice/contracts";
import type { Session } from "@supabase/supabase-js";
import { Headphones } from "lucide-react";
import { type JSX } from "react";

import {
    AgentWorkspace,
    type AgentWorkspaceApi,
} from "./agent-workspace";
import type { UiLanguage } from "./language";

const previewAgentId = "10000000-0000-4000-a000-000000000001";
const previewSession = {
    access_token: "local-preview-access-token",
    expires_in: 3600,
    refresh_token: "local-preview-refresh-token",
    token_type: "bearer",
    user: {
        id: previewAgentId,
    },
} as unknown as Session;

const previewDetails = new Map<string, TeamConversationDetail>([
    [
        "20000000-0000-4000-a000-000000000101",
        {
            acceptedAt: null,
            acceptedBy: null,
            assistantSuggestion: null,
            conversationId: "20000000-0000-4000-a000-000000000101",
            customer: {
                channel: "voice",
                company: null,
                email: null,
                language: "zh-CN",
                name: "语音访客 101",
                phone: null,
            },
            guardrailCount: 0,
            guardrailEvents: [],
            handoffReason: null,
            handoffRequestedAt: null,
            latestActivityAt: "2026-08-07T20:15:00.000Z",
            latestGuardrailCode: null,
            messages: [
                {
                    citations: [],
                    createdAt: "2026-08-07T20:14:30.000Z",
                    decision: null,
                    messageId: "30000000-0000-4000-a000-000000000101",
                    senderType: "customer",
                    senderUserId: null,
                    text: "请问你们有古筝课程吗？",
                },
                {
                    citations: [
                        {
                            citationId: "50000000-0000-4000-a000-000000000101",
                            label: "课程介绍｜民族乐器",
                            sourceType: "url",
                            sourceUrl: "https://example.com/programs",
                            supportingExcerpt: "学院提供古筝、二胡等民族乐器课程。",
                        },
                    ],
                    createdAt: "2026-08-07T20:15:00.000Z",
                    decision: "answer",
                    messageId: "30000000-0000-4000-a000-000000000102",
                    senderType: "ai",
                    senderUserId: null,
                    text: "有的，我们提供古筝课程。您是想为自己还是孩子了解课程？我可以继续帮您确认合适的班型。",
                },
            ],
            preview: "有的，我们提供古筝课程。您是想为自己还是孩子了解课程？",
            startedAt: "2026-08-07T20:14:20.000Z",
            status: "active_ai",
            summary: null,
            summaryRecord: null,
            voiceSession: {
                createdAt: "2026-08-07T20:14:20.000Z",
                endedAt: "2026-08-07T20:15:05.000Z",
                errorCode: null,
                provider: "mock",
                readyAt: "2026-08-07T20:14:21.000Z",
                serverAssistantLatency: {
                    maxMs: 842,
                    p50Ms: 842,
                    p95Ms: 842,
                    sampleSize: 1,
                },
                startedAt: "2026-08-07T20:14:23.000Z",
                status: "closed",
                voiceSessionId: "60000000-0000-4000-a000-000000000101",
                warmupMs: 1000,
            },
            voiceSessionStatus: "closed",
        },
    ],
    [
        "20000000-0000-4000-a000-000000000102",
        {
            acceptedAt: null,
            acceptedBy: null,
            assistantSuggestion: null,
            conversationId: "20000000-0000-4000-a000-000000000102",
            customer: {
                channel: "text",
                company: "North Shore Family",
                email: "parent@example.test",
                language: "en",
                name: "Alex",
                phone: null,
            },
            guardrailCount: 0,
            guardrailEvents: [],
            handoffReason: null,
            handoffRequestedAt: null,
            latestActivityAt: "2026-08-07T19:46:00.000Z",
            latestGuardrailCode: null,
            messages: [
                {
                    citations: [],
                    createdAt: "2026-08-07T19:45:20.000Z",
                    decision: null,
                    messageId: "30000000-0000-4000-a000-000000000103",
                    senderType: "customer",
                    senderUserId: null,
                    text: "Where is the school located?",
                },
                {
                    citations: [],
                    createdAt: "2026-08-07T19:46:00.000Z",
                    decision: "answer",
                    messageId: "30000000-0000-4000-a000-000000000104",
                    senderType: "ai",
                    senderUserId: null,
                    text: "We are located at 2335-8888 Odlin Cres, Richmond, B.C.",
                },
            ],
            preview: "We are located at 2335-8888 Odlin Cres, Richmond, B.C.",
            startedAt: "2026-08-07T19:45:00.000Z",
            status: "resolved_ai",
            summary: null,
            summaryRecord: null,
            voiceSession: null,
            voiceSessionStatus: null,
        },
    ],
    [
        "20000000-0000-4000-a000-000000000103",
        {
            acceptedAt: null,
            acceptedBy: null,
            assistantSuggestion: {
                citations: [{
                    citationId: "80000000-0000-4000-a000-000000000113",
                    label: "课程介绍｜民族乐器",
                    sourceType: "url",
                    sourceUrl: "https://example.com/programs",
                    supportingExcerpt: "我们提供一对一器乐课程，包括古筝。",
                }],
                createdAt: "2026-08-07T19:20:00.000Z",
                draftText: "有的，我们提供一对一古筝课程。我可以继续帮您确认合适的安排。请问学员年龄、目前程度，以及平日或周末哪些时间比较方便？",
                errorCode: null,
                generatedAt: "2026-08-07T19:20:02.000Z",
                id: "80000000-0000-4000-a000-000000000103",
                kind: "grounded_answer",
                status: "ready",
                triggerMessageId: "30000000-0000-4000-a000-000000000105",
                updatedAt: "2026-08-07T19:20:02.000Z",
                usedAt: null,
            },
            conversationId: "20000000-0000-4000-a000-000000000103",
            customer: {
                channel: "voice",
                company: null,
                email: null,
                language: "zh-CN",
                name: "语音访客 103",
                phone: "604-555-0103",
            },
            guardrailCount: 0,
            guardrailEvents: [],
            handoffReason: "customer_requested_human",
            handoffRequestedAt: "2026-08-07T19:20:00.000Z",
            latestActivityAt: "2026-08-07T19:20:00.000Z",
            latestGuardrailCode: null,
            messages: [
                {
                    citations: [],
                    createdAt: "2026-08-07T19:19:30.000Z",
                    decision: null,
                    messageId: "30000000-0000-4000-a000-000000000105",
                    senderType: "customer",
                    senderUserId: null,
                    text: "我想了解一对一古筝课程的具体时间，能请客服跟进吗？",
                },
                {
                    citations: [],
                    createdAt: "2026-08-07T19:20:00.000Z",
                    decision: "handoff",
                    messageId: "30000000-0000-4000-a000-000000000106",
                    senderType: "ai",
                    senderUserId: null,
                    text: "可以，我会请客服专员继续为您确认可选时间。",
                },
            ],
            preview: "我想了解一对一古筝课程的具体时间，能请客服跟进吗？",
            startedAt: "2026-08-07T19:19:15.000Z",
            status: "handoff_requested",
            summary: {
                confirmedFacts: [
                    "客户希望了解一对一古筝课程。",
                    "客户希望客服确认可选上课时间。",
                ],
                conversationSummary: "客户通过语音询问一对一古筝课程时间，并主动要求客服专员跟进。",
                currentIntent: "咨询一对一古筝课程时间",
                customerQuestion: "一对一古筝课程有哪些可选时间？",
                nextStep: "确认客户年龄、经验和可上课时段，再提供可选安排。",
                suggestedReply: "您好，我来继续帮您确认一对一古筝课程。请问学员年龄、目前程度，以及平日或周末哪些时间比较方便？",
                triggerReason: "客户主动要求客服专员跟进",
            },
            summaryRecord: null,
            voiceSession: {
                createdAt: "2026-08-07T19:19:15.000Z",
                endedAt: null,
                errorCode: null,
                provider: "mock",
                readyAt: "2026-08-07T19:19:16.000Z",
                serverAssistantLatency: {
                    maxMs: 910,
                    p50Ms: 910,
                    p95Ms: 910,
                    sampleSize: 1,
                },
                startedAt: "2026-08-07T19:19:18.000Z",
                status: "handoff",
                voiceSessionId: "60000000-0000-4000-a000-000000000103",
                warmupMs: 1000,
            },
            voiceSessionStatus: "handoff",
        },
    ],
    [
        "20000000-0000-4000-a000-000000000104",
        {
            acceptedAt: "2026-08-07T18:05:00.000Z",
            acceptedBy: previewAgentId,
            assistantSuggestion: null,
            conversationId: "20000000-0000-4000-a000-000000000104",
            customer: {
                channel: "text",
                company: null,
                email: "customer@example.test",
                language: "zh-CN",
                name: "王女士",
                phone: null,
            },
            guardrailCount: 0,
            guardrailEvents: [],
            handoffReason: "missing_knowledge",
            handoffRequestedAt: "2026-08-07T18:03:00.000Z",
            latestActivityAt: "2026-08-07T18:12:00.000Z",
            latestGuardrailCode: null,
            messages: [
                {
                    citations: [],
                    createdAt: "2026-08-07T18:02:30.000Z",
                    decision: null,
                    messageId: "30000000-0000-4000-a000-000000000107",
                    senderType: "customer",
                    senderUserId: null,
                    text: "能帮我确认下个月的演出报名截止日期吗？",
                },
                {
                    citations: [],
                    createdAt: "2026-08-07T18:10:00.000Z",
                    decision: "human",
                    messageId: "30000000-0000-4000-a000-000000000108",
                    senderType: "human",
                    senderUserId: previewAgentId,
                    text: "报名截止日期是 8 月 20 日，我已经把报名表链接发到您的邮箱。",
                },
            ],
            preview: "报名截止日期是 8 月 20 日，我已经把报名表链接发到您的邮箱。",
            startedAt: "2026-08-07T18:02:00.000Z",
            status: "closed",
            summary: {
                confirmedFacts: ["客户询问下个月演出报名。"],
                conversationSummary: "客服确认报名截止日期并发送报名表。",
                currentIntent: "完成演出报名",
                customerQuestion: "下个月演出的报名截止日期是什么时候？",
                nextStep: "如客户未收到邮件，重新发送报名表。",
                suggestedReply: "如您没有收到报名表，请告诉我，我可以再发一次。",
                triggerReason: "知识库没有报名截止日期",
            },
            summaryRecord: {
                createdAt: "2026-08-07T18:12:00.000Z",
                customerFacts: [
                    {
                        key: "request",
                        sourceMessageId: "30000000-0000-4000-a000-000000000107",
                        value: "演出报名截止日期",
                    },
                ],
                followUpActions: ["确认客户是否收到报名表"],
                id: "70000000-0000-4000-a000-000000000104",
                intentLevel: "high",
                outcome: "resolved_human",
                primaryIntent: "演出报名",
                suggestedScript: "如您没有收到报名表，请告诉我，我可以再发一次。",
                summary: "客服确认报名截止日期并发送报名表。",
            },
            voiceSession: null,
            voiceSessionStatus: null,
        },
    ],
]);

/**
 * listPreviewConversations
 * ----------------
 * Returns development-only cross-channel fixtures using the production list contract and optional closed-state filtering.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService Local Conversation Center Preview
 */
async function listPreviewConversations(
    _session: Session,
    includeClosed = false,
): Promise<TeamConversationListItem[]>
{
    return [...previewDetails.values()]
        .filter((detail) => includeClosed || detail.status !== "closed")
        .map((detail) => teamConversationListItemSchema.parse(detail))
        .sort((left, right) => Date.parse(right.latestActivityAt) - Date.parse(left.latestActivityAt));
}

/**
 * getPreviewConversation
 * ----------------
 * Loads a defensive copy of one local fixture so the shared conversation workspace can render its complete detail contract.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService Local Conversation Center Preview
 */
async function getPreviewConversation(
    _session: Session,
    conversationId: string,
): Promise<TeamConversationDetail>
{
    const detail = previewDetails.get(conversationId);

    if (detail === undefined)
    {
        throw new Error("The local preview conversation was not found.");
    }

    return structuredClone(detail);
}

/**
 * claimPreviewConversation
 * ----------------
 * Simulates the same handoff-only ownership transition used by the server while keeping all preview data in browser memory.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService Local Conversation Center Preview
 */
async function claimPreviewConversation(
    session: Session,
    conversationId: string,
): Promise<ClaimConversationResponse>
{
    const detail = previewDetails.get(conversationId);

    if (detail === undefined || detail.status !== "handoff_requested")
    {
        throw new Error("Only a waiting handoff can be claimed.");
    }

    const acceptedAt = new Date().toISOString();
    detail.acceptedAt = acceptedAt;
    detail.acceptedBy = session.user.id;
    detail.latestActivityAt = acceptedAt;
    detail.status = "active_human";

    return {
        acceptedAt,
        acceptedBy: session.user.id,
        conversationId,
        status: "active_human",
    };
}

/**
 * sendPreviewMessage
 * ----------------
 * Appends a human reply only to a claimed development fixture, records suggestion use, and returns the normal idempotent message shape.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService Local Conversation Center Preview
 */
async function sendPreviewMessage(
    session: Session,
    conversationId: string,
    text: string,
    suggestionId: string | null = null,
): Promise<SendHumanMessageResponse>
{
    const detail = previewDetails.get(conversationId);

    if (detail === undefined || detail.status !== "active_human" || detail.acceptedBy !== session.user.id)
    {
        throw new Error("Claim this handoff before replying.");
    }

    const createdAt = new Date().toISOString();
    const message = {
        citations: [],
        createdAt,
        decision: "human" as const,
        messageId: crypto.randomUUID(),
        senderType: "human" as const,
        senderUserId: session.user.id,
        text,
    };
    detail.latestActivityAt = createdAt;
    detail.messages.push(message);
    detail.preview = text;

    if (
        suggestionId !== null
        && detail.assistantSuggestion?.id === suggestionId
        && detail.assistantSuggestion.status === "ready"
    )
    {
        detail.assistantSuggestion.status = "used";
        detail.assistantSuggestion.usedAt = createdAt;
        detail.assistantSuggestion.updatedAt = createdAt;
    }

    return {
        created: true,
        message,
    };
}

/**
 * closePreviewConversation
 * ----------------
 * Simulates closure for an owned development fixture without making a network or provider call.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService Local Conversation Center Preview
 */
async function closePreviewConversation(
    session: Session,
    conversationId: string,
): Promise<CloseConversationResponse>
{
    const detail = previewDetails.get(conversationId);

    if (detail === undefined || detail.status !== "active_human" || detail.acceptedBy !== session.user.id)
    {
        throw new Error("Only the current human owner can close this conversation.");
    }

    detail.latestActivityAt = new Date().toISOString();
    detail.status = "closed";

    if (
        detail.assistantSuggestion?.status === "pending"
        || detail.assistantSuggestion?.status === "ready"
        || detail.assistantSuggestion?.status === "failed"
    )
    {
        detail.assistantSuggestion = null;
    }

    return {
        conversationId,
        finalizationQueued: true,
        status: "closed",
    };
}

const previewApi: AgentWorkspaceApi = {
    claim: claimPreviewConversation,
    close: closePreviewConversation,
    get: getPreviewConversation,
    list: listPreviewConversations,
    send: sendPreviewMessage,
};

/**
 * LocalConversationPreview
 * ----------------
 * Renders the shared conversation-center UI against isolated in-memory fixtures only when the Vite development build explicitly routes here.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService Local Conversation Center Preview
 */
export function LocalConversationPreview(): JSX.Element
{
    const parameters = new URLSearchParams(window.location.search);
    const language: UiLanguage = parameters.get("lang") === "en" ? "en" : "zh-CN";
    const conversationMatch = /^\/local\/conversations\/([0-9a-f-]{36})\/?$/iu.exec(window.location.pathname);
    const initialConversationId = conversationMatch?.[1] ?? null;

    return (
        <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#e0f2fe,_#f8fafc_42%,_#eef2ff)] px-4 py-6 text-slate-950 sm:px-7">
            <header className="mx-auto mb-5 flex max-w-[1800px] flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/80 bg-white/85 px-5 py-4 shadow-sm backdrop-blur">
                <div className="flex items-center gap-3">
                    <span className="grid size-11 place-items-center rounded-2xl bg-slate-950 text-white">
                        <Headphones aria-hidden="true" className="size-5" />
                    </span>
                    <div>
                        <p className="font-bold">Smart Service · {language === "zh-CN" ? "本地会话中心" : "Local conversation center"}</p>
                        <p className="text-xs text-slate-500">
                            {language === "zh-CN"
                                ? "仅使用浏览器内存样例，不连接 production，也不调用付费服务。"
                                : "Browser-memory fixtures only; no production or paid-provider calls."}
                        </p>
                    </div>
                </div>
                <nav className="flex rounded-full border border-slate-200 bg-slate-50 p-1 text-xs font-semibold">
                    <a className={language === "zh-CN" ? "rounded-full bg-slate-900 px-3 py-1.5 text-white" : "px-3 py-1.5"} href="/local/conversations?lang=zh-CN">中文</a>
                    <a className={language === "en" ? "rounded-full bg-slate-900 px-3 py-1.5 text-white" : "px-3 py-1.5"} href="/local/conversations?lang=en">English</a>
                </nav>
            </header>
            <div className="mx-auto max-w-[1800px]">
                <AgentWorkspace
                    api={previewApi}
                    initialConversationId={initialConversationId}
                    language={language}
                    onOpenConversation={(conversationId) =>
                    {
                        window.history.replaceState(
                            {},
                            "",
                            `/local/conversations/${conversationId}?lang=${language}`,
                        );
                    }}
                    session={previewSession}
                />
            </div>
        </main>
    );
}
