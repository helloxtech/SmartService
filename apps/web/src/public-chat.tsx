import type {
    ConversationLanguage,
    ConversationStatus,
    PublicCitation,
} from "@smartservice/contracts";
import { Button } from "@smartservice/ui";
import {
    ArrowLeft,
    BookOpen,
    Bot,
    CheckCircle2,
    ExternalLink,
    Headphones,
    LifeBuoy,
    LoaderCircle,
    MessageSquarePlus,
    Send,
    ShieldCheck,
    UserRound,
    X,
} from "lucide-react";
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type FormEvent,
    type JSX,
} from "react";
import { z } from "zod";

import {
    createPublicConversationWithFallback,
    getConfiguredDemoPublicKeys,
    pollPublicMessages,
    requestPublicHandoff,
    sendPublicMessage,
} from "./lib/public-conversation-api";
import {
    mergeChatMessages,
    type ChatMessage,
} from "./lib/public-chat-messages";
import {
    LanguageSwitch,
    type UiLanguage,
} from "./language";
import { TurnstileWidget } from "./turnstile-widget";

const storedSessionSchema = z.object({
    conversationId: z.uuid(),
    conversationToken: z.string().min(32),
    displayName: z.string().min(1).max(120),
    expiresAt: z.iso.datetime({ offset: true }),
    welcomeMessage: z.string().min(1).max(500),
});

type StoredSession = z.infer<typeof storedSessionSchema>;

type HumanSupportOfferReason =
    | "customer_frustration"
    | "repeated_clarification"
    | "request_error";

const publicChatCopy: Record<UiLanguage, {
    activeStatus: string;
    activeStatusShort: string;
    aiReadyNotice: string;
    askLabel: string;
    backLabel: string;
    busy: string;
    closedFooter: string;
    closedPlaceholder: string;
    closedStatus: string;
    footerHelp: string;
    handoffConnectedFooter: string;
    handoffConnectedStatus: string;
    handoffDefaultMessage: string;
    handoffRequestedFooter: string;
    handoffRequestedStatus: string;
    humanStatusShort: string;
    initialWelcome: string;
    messageFailed: string;
    needHumanHelp: string;
    newConversationConfirm: string;
    newConversationLabel: string;
    openWebpage: string;
    placeholderActive: string;
    placeholderHuman: string;
    secureSession: string;
    sendLabel: string;
    sourceAria: string;
    sourceClose: string;
    sourceEmpty: string;
    sourceHeading: string;
    sourcePrefix: string;
    subtitle: string;
    titleSuffix: string;
    verificationRequired: string;
}> = {
    en: {
        activeStatus: "AI ready",
        activeStatusShort: "AI ready",
        aiReadyNotice: "Smart Service answers only from approved knowledge. If evidence is missing, the assistant will explain the limitation and offer next steps.",
        askLabel: "Ask Smart Service support",
        backLabel: "Back to Smart Service",
        busy: "Checking approved knowledge…",
        closedFooter: "Conversation closed",
        closedPlaceholder: "Conversation is closed.",
        closedStatus: "Conversation closed",
        footerHelp: "Enter to send. Shift + Enter for a new line.",
        handoffConnectedFooter: "Human support connected",
        handoffConnectedStatus: "Human support connected",
        handoffDefaultMessage: "Your request was received. A human support specialist will take over this conversation.",
        handoffRequestedFooter: "Waiting for human support",
        handoffRequestedStatus: "Human support requested",
        humanStatusShort: "Human support",
        initialWelcome: "Hello, I'm the Smart Service Assistant. How can I help?",
        messageFailed: "The message could not be sent.",
        needHumanHelp: "Need human help?",
        newConversationConfirm: "Start a new conversation? This conversation will remain available to support, but it will no longer appear in this browser tab.",
        newConversationLabel: "New conversation",
        openWebpage: "Open webpage",
        placeholderActive: "Ask in Chinese or English…",
        placeholderHuman: "Add details for human support…",
        secureSession: "Secure conversation session active",
        sendLabel: "Send message",
        sourceAria: "Supporting source",
        sourceClose: "Close source",
        sourceEmpty: "Select a source below an answer to inspect the approved excerpt.",
        sourceHeading: "Supporting source",
        sourcePrefix: "Source",
        subtitle: "Grounded customer service",
        titleSuffix: "Support",
        verificationRequired: "Please complete the human verification before starting.",
    },
    "zh-CN": {
        activeStatus: "AI 已就绪",
        activeStatusShort: "AI 就绪",
        aiReadyNotice: "Smart Service 只使用已批准知识回答；证据不足时会说明限制并提供下一步选择。",
        askLabel: "咨询 Smart Service 客服",
        backLabel: "返回 Smart Service",
        busy: "正在检查已批准知识…",
        closedFooter: "会话已结束",
        closedPlaceholder: "会话已结束。",
        closedStatus: "会话已结束",
        footerHelp: "回车发送，Shift + 回车换行。",
        handoffConnectedFooter: "人工客服已接入",
        handoffConnectedStatus: "人工已接入",
        handoffDefaultMessage: "已收到您的请求，人工客服将接手此会话。",
        handoffRequestedFooter: "等待人工客服接入",
        handoffRequestedStatus: "已转人工",
        humanStatusShort: "人工客服",
        initialWelcome: "您好，我是 Smart Service 智能客服。请问有什么可以帮您？",
        messageFailed: "消息未发送。",
        needHumanHelp: "需要人工帮助？",
        newConversationConfirm: "开始新会话？当前会话仍会保留给客服查看，但不会继续显示在此浏览器标签页中。",
        newConversationLabel: "新建会话",
        openWebpage: "打开网页",
        placeholderActive: "请输入中文或英文问题…",
        placeholderHuman: "补充信息给人工客服…",
        secureSession: "安全会话已开启",
        sendLabel: "发送消息",
        sourceAria: "引用来源",
        sourceClose: "关闭来源",
        sourceEmpty: "点击答案下方的来源，可查看已批准的证据片段。",
        sourceHeading: "引用来源",
        sourcePrefix: "来源",
        subtitle: "有依据的客户服务",
        titleSuffix: "客服",
        verificationRequired: "请先完成人机验证。",
    },
};

const sessionStorageKey = "smartservice.publicConversation.v1";

/**
 * ignoreUiLanguageChange
 * ----------------
 * Provides a safe no-op callback for isolated public chat tests that do not mount the full app shell.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService Language Switch
 */
function ignoreUiLanguageChange(): void
{
}

/**
 * loadStoredSession
 * ----------------
 * Restores only a nonexpired conversation-scoped token from session storage and removes invalid state.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Chat
 */
function loadStoredSession(): StoredSession | null
{
    try
    {
        const raw = sessionStorage.getItem(sessionStorageKey);

        if (raw === null)
        {
            return null;
        }

        const result = storedSessionSchema.safeParse(JSON.parse(raw) as unknown);

        if (!result.success || Date.parse(result.data.expiresAt) <= Date.now())
        {
            sessionStorage.removeItem(sessionStorageKey);
            return null;
        }

        return result.data;
    }
    catch
    {
        sessionStorage.removeItem(sessionStorageKey);
        return null;
    }
}

/**
 * storeSession
 * ----------------
 * Keeps the short-lived scoped conversation token in the current browser tab only.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Chat
 */
function storeSession(session: StoredSession): void
{
    sessionStorage.setItem(sessionStorageKey, JSON.stringify(session));
}

/**
 * detectQuestionLanguage
 * ----------------
 * Selects the initial conversation language from the first customer question.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Chat
 */
function detectQuestionLanguage(question: string): ConversationLanguage
{
    return /\p{Script=Han}/u.test(question) ? "zh-CN" : "en";
}

/**
 * indicatesCustomerFrustration
 * ----------------
 * Detects a narrow set of explicit dissatisfaction phrases so the UI can offer human help without changing the server-owned handoff decision.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Conditional Human Support
 */
function indicatesCustomerFrustration(question: string): boolean
{
    return /(?:没解决|还是没回答|一直没解决|很生气|不满意|太差了|没有帮助|not helpful|still not (?:answered|resolved)|frustrat(?:ed|ing)|very angry|terrible service|not satisfied)/iu
        .test(question);
}

/**
 * describeStatus
 * ----------------
 * Maps the persisted conversation state to concise single-language customer-facing status copy.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Chat
 */
function describeStatus(status: ConversationStatus, language: UiLanguage): string
{
    const copy = publicChatCopy[language];

    if (status === "handoff_requested")
    {
        return copy.handoffRequestedStatus;
    }

    if (status === "active_human")
    {
        return copy.handoffConnectedStatus;
    }

    if (status === "closed")
    {
        return copy.closedStatus;
    }

    return copy.activeStatus;
}

/**
 * canCustomerSend
 * ----------------
 * Allows customer updates while AI is active, while waiting for human support, and after a human operator connects.
 *
 * July 30, 2026: Updated by Forrest Zhang for SmartService Chinese UI
 */
function canCustomerSend(status: ConversationStatus): boolean
{
    return status === "active_ai"
        || status === "handoff_requested"
        || status === "active_human";
}

/**
 * describeComposerPlaceholder
 * ----------------
 * Explains where the next customer message will go without implying AI is still active after handoff.
 *
 * July 29, 2026: Created by Forrest Zhang for SmartService Pending Handoff Customer Messages
 */
function describeComposerPlaceholder(status: ConversationStatus, language: UiLanguage): string
{
    const copy = publicChatCopy[language];

    if (status === "active_ai")
    {
        return copy.placeholderActive;
    }

    if (status === "closed")
    {
        return copy.closedPlaceholder;
    }

    return copy.placeholderHuman;
}

/**
 * describeHumanSupportFooter
 * ----------------
 * Separates waiting-for-human and human-connected states so opening the Agent view never looks like an implicit claim.
 *
 * July 29, 2026: Created by Forrest Zhang for SmartService Pending Handoff Customer Messages
 */
function describeHumanSupportFooter(status: ConversationStatus, language: UiLanguage): string
{
    const copy = publicChatCopy[language];

    if (status === "handoff_requested")
    {
        return copy.handoffRequestedFooter;
    }

    if (status === "active_human")
    {
        return copy.handoffConnectedFooter;
    }

    return copy.closedFooter;
}

/**
 * CitationPanel
 * ----------------
 * Shows the exact supporting excerpt and customer-safe source locator for one selected citation.
 *
 * July 30, 2026: Updated by Forrest Zhang for SmartService branding cleanup
 */
function CitationPanel({
    citation,
    language,
    onClose,
}: {
    citation: PublicCitation | null;
    language: UiLanguage;
    onClose: () => void;
}): JSX.Element
{
    const copy = publicChatCopy[language];

    return (
        <aside
            aria-label={copy.sourceAria}
            className={`rounded-[1.75rem] border bg-white/80 p-5 shadow-[0_18px_50px_rgb(15_23_42/0.08)] backdrop-blur-xl lg:sticky lg:top-6 lg:self-start ${
                citation === null ? "border-dashed border-white/70" : "border-sky-100"
            }`}
        >
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <BookOpen aria-hidden="true" className="size-4 text-sky-700" />
                    <h2 className="text-sm font-bold">{copy.sourceHeading}</h2>
                </div>
                {citation === null
                    ? null
                    : (
                        <button
                            aria-label={copy.sourceClose}
                            className="rounded-full p-1 text-slate-500 hover:bg-slate-100"
                            onClick={onClose}
                            type="button"
                        >
                            <X aria-hidden="true" className="size-4" />
                        </button>
                    )}
            </div>

            {citation === null
                ? (
                    <p className="mt-4 text-sm leading-6 text-slate-500">
                        {copy.sourceEmpty}
                    </p>
                )
                : (
                    <div className="mt-4">
                        <p className="text-sm font-semibold text-slate-900">{citation.label}</p>
                        <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                            {citation.sourceType}
                        </p>
                        <blockquote className="mt-4 rounded-2xl bg-sky-50/80 p-4 text-sm leading-6 text-slate-700">
                            {citation.supportingExcerpt}
                        </blockquote>
                        {citation.sourceUrl === null
                            ? null
                            : (
                                <a
                                    className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-sky-700 hover:text-sky-900"
                                    href={citation.sourceUrl}
                                    rel="noreferrer"
                                    target="_blank"
                                >
                                    {copy.openWebpage}
                                    <ExternalLink aria-hidden="true" className="size-3.5" />
                                </a>
                            )}
                    </div>
                )}
        </aside>
    );
}

/**
 * PublicChat
 * ----------------
 * Renders the responsive customer chat with language-switched copy, grounded citations, scoped polling, customer-controlled handoff, and contextual human support.
 *
 * July 30, 2026: Updated by Forrest Zhang for SmartService Apple-inspired UI
 */
export function PublicChat({
    onUiLanguageChange = ignoreUiLanguageChange,
    uiLanguage = "en",
}: {
    onUiLanguageChange?: (language: UiLanguage) => void;
    uiLanguage?: UiLanguage;
}): JSX.Element
{
    const copy = publicChatCopy[uiLanguage];
    const initialSession = loadStoredSession();
    const [session, setSession] = useState<StoredSession | null>(initialSession);
    const [messages, setMessages] = useState<ChatMessage[]>([{
        citations: [],
        id: "local-welcome",
        sender: "ai",
        text: initialSession?.welcomeMessage
            ?? copy.initialWelcome,
    }]);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<ConversationStatus>("active_ai");
    const [turnstileToken, setTurnstileToken] = useState("");
    const [selectedCitation, setSelectedCitation] = useState<PublicCitation | null>(null);
    const [humanSupportOfferReason, setHumanSupportOfferReason] =
        useState<HumanSupportOfferReason | null>(null);
    const consecutiveClarifications = useRef(0);
    const cursorRef = useRef<string | null>(null);
    const etagRef = useRef<string | null>(null);
    const seenMessageIds = useRef(new Set<string>());
    const retryMessage = useRef<{ clientMessageId: string; text: string } | null>(null);
    const transcriptEnd = useRef<HTMLDivElement>(null);
    const publicKeys = getConfiguredDemoPublicKeys();

    const handleTurnstileToken = useCallback((token: string) =>
    {
        setTurnstileToken(token);
    }, []);

    useEffect(() =>
    {
        transcriptEnd.current?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
        });
    }, [messages, busy]);

    useEffect(() =>
    {
        if (session === null)
        {
            return;
        }

        const activeSession = session;
        let active = true;
        let timer: number | undefined;

        /**
         * poll
         * ----------------
         * Performs one cursor/ETag poll and schedules the next request while this mounted session remains active.
         *
         * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Chat
         */
        async function poll(): Promise<void>
        {
            try
            {
                const result = await pollPublicMessages(
                    activeSession.conversationId,
                    activeSession.conversationToken,
                    cursorRef.current,
                    etagRef.current,
                );

                if (active && result.response !== null)
                {
                    cursorRef.current = result.response.nextCursor;
                    etagRef.current = result.etag;
                    setStatus(result.response.status);
                    const additions: ChatMessage[] = [];

                    for (const message of result.response.messages)
                    {
                        if (seenMessageIds.current.has(message.messageId))
                        {
                            continue;
                        }

                        seenMessageIds.current.add(message.messageId);
                        additions.push({
                            citations: message.citations,
                            id: message.messageId,
                            sender: message.senderType,
                            text: message.text,
                        });
                    }

                    if (additions.length > 0)
                    {
                        setMessages((current) => mergeChatMessages(current, additions));
                    }
                }
            }
            catch
            {
                // Polling is retried quietly; explicit customer actions still surface actionable errors.
            }
            finally
            {
                if (active)
                {
                    timer = window.setTimeout(() =>
                    {
                        void poll();
                    }, 1_000);
                }
            }
        }

        void poll();

        return () =>
        {
            active = false;

            if (timer !== undefined)
            {
                window.clearTimeout(timer);
            }
        };
    }, [session]);

    /**
     * ensureSession
     * ----------------
     * Reuses the current scoped conversation or creates one after local/live human verification.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Chat
     */
    async function ensureSession(language: ConversationLanguage): Promise<StoredSession>
    {
        if (session !== null)
        {
            return session;
        }

        if (turnstileToken.length === 0)
        {
            throw new Error(copy.verificationRequired);
        }

        const created = await createPublicConversationWithFallback(
            publicKeys,
            language,
            turnstileToken,
        );
        const nextSession: StoredSession = created;
        storeSession(nextSession);
        setSession(nextSession);
        setMessages([{
            citations: [],
            id: "local-welcome",
            sender: "ai",
            text: created.welcomeMessage,
        }]);
        return nextSession;
    }

    /**
     * handleSubmit
     * ----------------
     * Sends one optimistic retry-safe customer turn, appends the validated response, and exposes human help only after a contextual signal.
     *
     * July 27, 2026: Updated by Forrest Zhang for SmartService Conditional Human Support
     */
    async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void>
    {
        event.preventDefault();
        const question = input.trim();

        if (question.length === 0 || busy || !canCustomerSend(status))
        {
            return;
        }

        setBusy(true);
        setError(null);
        const customerAppearsFrustrated = indicatesCustomerFrustration(question);

        if (customerAppearsFrustrated)
        {
            setHumanSupportOfferReason("customer_frustration");
        }

        try
        {
            const activeSession = await ensureSession(detectQuestionLanguage(question));
            const pending = retryMessage.current?.text === question
                ? retryMessage.current
                : {
                    clientMessageId: crypto.randomUUID(),
                    text: question,
                };

            if (retryMessage.current?.clientMessageId !== pending.clientMessageId)
            {
                setMessages((current) => mergeChatMessages(current, [{
                    citations: [],
                    id: pending.clientMessageId,
                    sender: "customer",
                    text: pending.text,
                }]));
            }

            retryMessage.current = pending;
            const response = await sendPublicMessage(
                activeSession.conversationId,
                activeSession.conversationToken,
                pending.text,
                pending.clientMessageId,
            );
            seenMessageIds.current.add(response.messageId);

            if (response.decision !== "human")
            {
                setMessages((current) => mergeChatMessages(current, [{
                    citations: response.citations,
                    id: response.messageId,
                    sender: "ai",
                    text: response.answer,
                }]));
            }

            if (response.handoff !== null)
            {
                setStatus(response.handoff.status);
                consecutiveClarifications.current = 0;
                setHumanSupportOfferReason(null);
            }
            else if (response.decision === "human")
            {
                consecutiveClarifications.current = 0;
                setHumanSupportOfferReason(null);
            }
            else if (response.decision === "clarify")
            {
                consecutiveClarifications.current += 1;

                if (consecutiveClarifications.current >= 2)
                {
                    setHumanSupportOfferReason("repeated_clarification");
                }
            }
            else
            {
                consecutiveClarifications.current = 0;

                if (!customerAppearsFrustrated)
                {
                    setHumanSupportOfferReason(null);
                }
            }

            retryMessage.current = null;
            setInput("");
        }
        catch (caught: unknown)
        {
            setError(caught instanceof Error
                ? caught.message
                : copy.messageFailed);
            setHumanSupportOfferReason("request_error");
        }
        finally
        {
            setBusy(false);
        }
    }

    /**
     * handleHandoff
     * ----------------
     * Starts a conversation if needed, then accepts the contextual human-support offer through the scoped Worker endpoint.
     *
     * July 27, 2026: Updated by Forrest Zhang for SmartService Conditional Human Support
     */
    async function handleHandoff(): Promise<void>
    {
        if (busy || status !== "active_ai")
        {
            return;
        }

        setBusy(true);
        setError(null);

        try
        {
            const activeSession = await ensureSession("zh-CN");
            const response = await requestPublicHandoff(
                activeSession.conversationId,
                activeSession.conversationToken,
            );
            seenMessageIds.current.add(response.messageId);
            setStatus(response.handoff.status);
            setHumanSupportOfferReason(null);
            setMessages((current) => mergeChatMessages(current, [{
                citations: [],
                id: response.messageId,
                sender: "system",
                text: copy.handoffDefaultMessage,
            }]));
        }
        catch (caught: unknown)
        {
            setError(caught instanceof Error
                ? caught.message
                : copy.messageFailed);
            setHumanSupportOfferReason("request_error");
        }
        finally
        {
            setBusy(false);
        }
    }

    /**
     * handleNewConversation
     * ----------------
     * Clears only this browser tab's scoped session and client state so the customer can start fresh without deleting the retained support record.
     *
     * August 03, 2026: Created by Forrest Zhang for SmartService Customer Conversation Reset
     */
    function handleNewConversation(): void
    {
        if (
            session === null
            || busy
            || !window.confirm(copy.newConversationConfirm)
        )
        {
            return;
        }

        sessionStorage.removeItem(sessionStorageKey);
        setSession(null);
        setMessages([{
            citations: [],
            id: "local-welcome",
            sender: "ai",
            text: copy.initialWelcome,
        }]);
        setInput("");
        setError(null);
        setStatus("active_ai");
        setTurnstileToken("");
        setSelectedCitation(null);
        setHumanSupportOfferReason(null);
        consecutiveClarifications.current = 0;
        cursorRef.current = null;
        etagRef.current = null;
        seenMessageIds.current.clear();
        retryMessage.current = null;
    }

    return (
        <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_#dff6ff_0,_transparent_34rem),linear-gradient(135deg,_#f8fafc_0%,_#eef4ff_45%,_#f8fafc_100%)] text-slate-950">
            <header className="sticky top-0 z-20 border-b border-white/70 bg-white/75 backdrop-blur-2xl">
                <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                        <a
                            aria-label={copy.backLabel}
                            className="rounded-full p-2 text-slate-500 hover:bg-white"
                            href="/"
                        >
                            <ArrowLeft aria-hidden="true" className="size-5" />
                        </a>
                        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg shadow-slate-950/15">
                            <Headphones aria-hidden="true" className="size-5" />
                        </div>
                        <div className="min-w-0">
                            <h1 className="truncate text-base font-semibold tracking-tight">Smart Service {copy.titleSuffix}</h1>
                            <p className="hidden truncate text-xs text-slate-500 sm:block">
                                {copy.subtitle}
                            </p>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <LanguageSwitch
                            language={uiLanguage}
                            onLanguageChange={onUiLanguageChange}
                        />
                        <span className={`rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm ${
                            status === "active_ai"
                                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                                : "bg-amber-50 text-amber-800 ring-1 ring-amber-100"
                        }`}>
                            <span className="sm:hidden">
                                {status === "active_ai" ? copy.activeStatusShort : copy.humanStatusShort}
                            </span>
                            <span className="hidden sm:inline">{describeStatus(status, uiLanguage)}</span>
                        </span>
                    </div>
                </div>
            </header>

            <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <section className="flex min-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-[2rem] border border-white/70 bg-white/78 shadow-[0_24px_80px_rgb(15_23_42/0.12)] backdrop-blur-2xl">
                    <div
                        aria-live="polite"
                        className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-7"
                    >
                        <div className="mx-auto flex max-w-3xl items-start gap-3 rounded-2xl border border-sky-100 bg-sky-50/80 px-4 py-3 text-sm leading-6 text-sky-950">
                            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sky-700" />
                            <span>{copy.aiReadyNotice}</span>
                        </div>

                        {messages.map((message) => (
                            <article
                                className={`mx-auto flex max-w-3xl gap-3 ${
                                    message.sender === "customer" ? "flex-row-reverse" : ""
                                }`}
                                key={message.id}
                            >
                                <div className={`flex size-9 shrink-0 items-center justify-center rounded-full shadow-sm ${
                                    message.sender === "customer"
                                        ? "bg-slate-800 text-white"
                                        : message.sender === "human"
                                            ? "bg-violet-100 text-violet-700"
                                            : "bg-sky-100 text-sky-700"
                                }`}>
                                    {message.sender === "customer"
                                        ? <UserRound aria-hidden="true" className="size-4" />
                                        : message.sender === "human"
                                            ? <Headphones aria-hidden="true" className="size-4" />
                                            : <Bot aria-hidden="true" className="size-4" />}
                                </div>
                                <div className={`max-w-[85%] ${
                                    message.sender === "customer" ? "text-right" : ""
                                }`}>
                                    <div className={`inline-block rounded-[1.35rem] px-4 py-3 text-left text-sm leading-6 shadow-sm ${
                                        message.sender === "customer"
                                            ? "rounded-tr-sm bg-slate-900 text-white"
                                            : message.sender === "system"
                                                ? "border border-amber-200 bg-amber-50 text-amber-950"
                                                : "rounded-tl-sm bg-white text-slate-800 ring-1 ring-slate-200/70"
                                    }`}>
                                        {message.id === "local-welcome"
                                            ? copy.initialWelcome
                                            : message.text}
                                    </div>
                                    {message.citations.length === 0
                                        ? null
                                        : (
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {message.citations.map((citation, index) => (
                                                    <button
                                                        className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-white/90 px-3 py-1.5 text-left text-xs font-semibold text-sky-800 shadow-sm hover:border-sky-400 hover:bg-sky-50"
                                                        key={citation.citationId}
                                                        onClick={() => setSelectedCitation(citation)}
                                                        type="button"
                                                    >
                                                        <BookOpen aria-hidden="true" className="size-3.5" />
                                                        {copy.sourcePrefix} {index + 1}: {citation.label}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                </div>
                            </article>
                        ))}

                        {busy
                            ? (
                                <div className="mx-auto flex max-w-3xl items-center gap-3 text-sm text-slate-500" role="status">
                                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-sky-700" />
                                    {copy.busy}
                                </div>
                            )
                            : null}
                        <div ref={transcriptEnd} />
                    </div>

                    <div className="border-t border-white/70 bg-white/70 p-4 backdrop-blur-xl sm:p-5">
                        {session === null
                            ? (
                                <TurnstileWidget
                                    language={uiLanguage}
                                    onToken={handleTurnstileToken}
                                />
                            )
                            : (
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <p className="flex items-center gap-1.5 text-xs text-emerald-700">
                                        <CheckCircle2 aria-hidden="true" className="size-3.5" />
                                        {copy.secureSession}
                                    </p>
                                    <Button
                                        disabled={busy}
                                        onClick={handleNewConversation}
                                        size="sm"
                                        type="button"
                                        variant="outline"
                                    >
                                        <MessageSquarePlus aria-hidden="true" className="size-3.5" />
                                        {copy.newConversationLabel}
                                    </Button>
                                </div>
                            )}

                        {error === null
                            ? null
                            : (
                                <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
                                    {error}
                                </p>
                            )}

                        <form className="mx-auto max-w-3xl" onSubmit={handleSubmit}>
                            <label className="sr-only" htmlFor="customer-message">
                                {copy.askLabel}
                            </label>
                            <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-inner shadow-slate-200/50 focus-within:border-slate-400 focus-within:ring-4 focus-within:ring-slate-200/60">
                                <textarea
                                    className="max-h-36 min-h-11 flex-1 resize-none border-0 bg-transparent px-3 py-2 text-sm outline-none"
                                    disabled={!canCustomerSend(status)}
                                    id="customer-message"
                                    maxLength={5000}
                                    onChange={(event) => setInput(event.target.value)}
                                    onKeyDown={(event) =>
                                    {
                                        if (event.key === "Enter" && !event.shiftKey)
                                        {
                                            event.preventDefault();
                                            event.currentTarget.form?.requestSubmit();
                                        }
                                    }}
                                    placeholder={describeComposerPlaceholder(status, uiLanguage)}
                                    rows={1}
                                    value={input}
                                />
                                <Button
                                    aria-label={copy.sendLabel}
                                    disabled={
                                        busy
                                        || input.trim().length === 0
                                        || !canCustomerSend(status)
                                        || (session === null && turnstileToken.length === 0)
                                    }
                                    size="icon"
                                    type="submit"
                                >
                                    <Send aria-hidden="true" className="size-4" />
                                </Button>
                            </div>
                        </form>

                        <div className="mx-auto mt-3 flex max-w-3xl items-center justify-between gap-3">
                            <p className="text-xs text-slate-500">
                                {copy.footerHelp}
                            </p>
                            {status === "active_ai" && humanSupportOfferReason !== null
                                ? (
                                    <button
                                        className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:border-amber-400 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                                        disabled={busy}
                                        onClick={() => void handleHandoff()}
                                        type="button"
                                    >
                                        <LifeBuoy aria-hidden="true" className="size-3.5" />
                                        {copy.needHumanHelp}
                                    </button>
                                )
                                : status === "active_ai"
                                    ? null
                                    : (
                                        <p className="text-right text-xs font-semibold text-amber-800">
                                            {describeHumanSupportFooter(status, uiLanguage)}
                                        </p>
                                    )}
                        </div>
                    </div>
                </section>

                <CitationPanel
                    citation={selectedCitation}
                    language={uiLanguage}
                    onClose={() => setSelectedCitation(null)}
                />
            </div>
        </main>
    );
}
