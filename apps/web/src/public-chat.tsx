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
    Send,
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
    createPublicConversation,
    pollPublicMessages,
    requestPublicHandoff,
    sendPublicMessage,
} from "./lib/public-conversation-api";
import { TurnstileWidget } from "./turnstile-widget";

const storedSessionSchema = z.object({
    conversationId: z.uuid(),
    conversationToken: z.string().min(32),
    displayName: z.string().min(1).max(120),
    expiresAt: z.iso.datetime({ offset: true }),
    welcomeMessage: z.string().min(1).max(500),
});

type StoredSession = z.infer<typeof storedSessionSchema>;

interface ChatMessage
{
    citations: PublicCitation[];
    id: string;
    sender: "ai" | "customer" | "human" | "system";
    text: string;
}

type HumanSupportOfferReason =
    | "customer_frustration"
    | "repeated_clarification"
    | "request_error";

const sessionStorageKey = "smartservice.publicConversation.v1";

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
 * Maps the persisted conversation state to concise bilingual customer-facing status copy.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Chat
 */
function describeStatus(status: ConversationStatus): string
{
    if (status === "handoff_requested")
    {
        return "Human support requested · 已转人工";
    }

    if (status === "active_human")
    {
        return "Human support connected · 人工已接入";
    }

    if (status === "closed")
    {
        return "Conversation closed · 会话已结束";
    }

    return "AI ready · AI 已就绪";
}

/**
 * canCustomerSend
 * ----------------
 * Allows customer updates while AI is active, while waiting for human support, and after a human operator connects.
 *
 * July 30, 2026: Updated by Forrest Zhang for SmartService XFlow Chinese UI
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
function describeComposerPlaceholder(status: ConversationStatus): string
{
    if (status === "active_ai")
    {
        return "Ask in 中文 or English…";
    }

    if (status === "closed")
    {
        return "Conversation is closed. · 会话已结束。";
    }

    return "Add details for human support… · 补充信息给人工客服…";
}

/**
 * describeHumanSupportFooter
 * ----------------
 * Separates waiting-for-human and human-connected states so opening the Agent view never looks like an implicit claim.
 *
 * July 29, 2026: Created by Forrest Zhang for SmartService Pending Handoff Customer Messages
 */
function describeHumanSupportFooter(status: ConversationStatus): string
{
    if (status === "handoff_requested")
    {
        return "Waiting for human support · 等待人工客服接入";
    }

    if (status === "active_human")
    {
        return "Human support connected · 人工客服已接入";
    }

    return "Conversation closed · 会话已结束";
}

/**
 * CitationPanel
 * ----------------
 * Shows the exact supporting excerpt and customer-safe source locator for one selected citation.
 *
 * July 30, 2026: Updated by Forrest Zhang for SmartService XFlow Chinese UI
 */
function CitationPanel({
    citation,
    onClose,
}: {
    citation: PublicCitation | null;
    onClose: () => void;
}): JSX.Element
{
    return (
        <aside
            aria-label="Supporting source · 引用来源"
            className={`rounded-2xl border bg-white p-5 shadow-sm lg:sticky lg:top-6 lg:self-start ${
                citation === null ? "border-dashed border-slate-300" : "border-sky-200"
            }`}
        >
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <BookOpen aria-hidden="true" className="size-4 text-sky-700" />
                    <h2 className="text-sm font-bold">Supporting source · 引用来源</h2>
                </div>
                {citation === null
                    ? null
                    : (
                        <button
                            aria-label="Close source · 关闭来源"
                            className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
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
                        Select a source below an answer to inspect the approved excerpt.
                        点击答案下方的来源，可查看已批准的证据片段。
                    </p>
                )
                : (
                    <div className="mt-4">
                        <p className="text-sm font-semibold text-slate-900">{citation.label}</p>
                        <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                            {citation.sourceType}
                        </p>
                        <blockquote className="mt-4 rounded-xl bg-sky-50 p-4 text-sm leading-6 text-slate-700">
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
                                    Open webpage · 打开网页
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
 * Renders the responsive bilingual customer chat with grounded citations, scoped polling, automatic escalation, and contextual human support.
 *
 * July 30, 2026: Updated by Forrest Zhang for SmartService XFlow Chinese UI
 */
export function PublicChat(): JSX.Element
{
    const initialSession = loadStoredSession();
    const [session, setSession] = useState<StoredSession | null>(initialSession);
    const [messages, setMessages] = useState<ChatMessage[]>([{
        citations: [],
        id: "local-welcome",
        sender: "ai",
        text: initialSession?.welcomeMessage
            ?? "您好！我是 XFlow 智能客服。您也可以用 English 提问。",
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
    const publicKey = import.meta.env.VITE_DEMO_PUBLIC_KEY ?? "xflow-public-demo";

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
                        setMessages((current) => [...current, ...additions]);
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
            throw new Error("Please complete the human verification before starting.");
        }

        const created = await createPublicConversation(
            publicKey,
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
                setMessages((current) => [...current, {
                    citations: [],
                    id: pending.clientMessageId,
                    sender: "customer",
                    text: pending.text,
                }]);
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
                setMessages((current) => [...current, {
                    citations: response.citations,
                    id: response.messageId,
                    sender: "ai",
                    text: response.answer,
                }]);
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
                : "The message could not be sent. · 消息未发送。");
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
            setMessages((current) => [...current, {
                citations: [],
                id: response.messageId,
                sender: "system",
                text: "已收到您的请求，人工客服将接手此会话。",
            }]);
        }
        catch (caught: unknown)
        {
            setError(caught instanceof Error
                ? caught.message
                : "Human support could not be requested. · 暂时无法请求人工客服。");
            setHumanSupportOfferReason("request_error");
        }
        finally
        {
            setBusy(false);
        }
    }

    return (
        <main className="min-h-screen bg-slate-100 text-slate-950">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                        <a
                            aria-label="Back to SmartService"
                            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                            href="/"
                        >
                            <ArrowLeft aria-hidden="true" className="size-5" />
                        </a>
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-700 text-white">
                            <Headphones aria-hidden="true" className="size-5" />
                        </div>
                        <div className="min-w-0">
                            <h1 className="truncate font-bold">{session?.displayName ?? "XFlow"} Support · 客服</h1>
                            <p className="hidden truncate text-xs text-slate-500 sm:block">
                                Grounded bilingual customer service · 有依据的中英文客服
                            </p>
                        </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                        status === "active_ai"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-800"
                    }`}>
                        <span className="sm:hidden">
                            {status === "active_ai" ? "AI · 就绪" : "Human · 人工"}
                        </span>
                        <span className="hidden sm:inline">{describeStatus(status)}</span>
                    </span>
                </div>
            </header>

            <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <section className="flex min-h-[calc(100vh-8.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div
                        aria-live="polite"
                        className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6"
                    >
                        <div className="mx-auto max-w-3xl rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-900">
                            Answers use approved XFlow knowledge. If evidence is missing, the assistant will request human support.
                            回答只使用已批准的 XFlow 知识；证据不足时会请求人工客服。
                        </div>

                        {messages.map((message) => (
                            <article
                                className={`mx-auto flex max-w-3xl gap-3 ${
                                    message.sender === "customer" ? "flex-row-reverse" : ""
                                }`}
                                key={message.id}
                            >
                                <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
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
                                    <div className={`inline-block rounded-2xl px-4 py-3 text-left text-sm leading-6 ${
                                        message.sender === "customer"
                                            ? "rounded-tr-sm bg-slate-900 text-white"
                                            : message.sender === "system"
                                                ? "border border-amber-200 bg-amber-50 text-amber-950"
                                                : "rounded-tl-sm bg-slate-100 text-slate-800"
                                    }`}>
                                        {message.text}
                                    </div>
                                    {message.citations.length === 0
                                        ? null
                                        : (
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {message.citations.map((citation, index) => (
                                                    <button
                                                        className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-left text-xs font-semibold text-sky-800 hover:border-sky-400 hover:bg-sky-50"
                                                        key={citation.citationId}
                                                        onClick={() => setSelectedCitation(citation)}
                                                        type="button"
                                                    >
                                                        <BookOpen aria-hidden="true" className="size-3.5" />
                                                        Source {index + 1} · 来源 {index + 1}: {citation.label}
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
                                    Checking approved knowledge… · 正在检查已批准知识…
                                </div>
                            )
                            : null}
                        <div ref={transcriptEnd} />
                    </div>

                    <div className="border-t border-slate-200 bg-slate-50 p-4 sm:p-5">
                        {session === null
                            ? <TurnstileWidget onToken={handleTurnstileToken} />
                            : (
                                <p className="mb-2 flex items-center gap-1.5 text-xs text-emerald-700">
                                    <CheckCircle2 aria-hidden="true" className="size-3.5" />
                                    Secure conversation session active · 安全会话已开启
                                </p>
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
                                Ask XFlow support · 咨询 XFlow 客服
                            </label>
                            <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-2 focus-within:border-sky-600 focus-within:ring-2 focus-within:ring-sky-100">
                                <textarea
                                    className="max-h-36 min-h-11 flex-1 resize-none border-0 px-2 py-2 text-sm outline-none"
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
                                    placeholder={describeComposerPlaceholder(status)}
                                    rows={1}
                                    value={input}
                                />
                                <Button
                                    aria-label="Send message · 发送消息"
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
                                Enter to send · Shift + Enter for a new line · 回车发送，Shift + 回车换行
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
                                        Need human help? · 需要人工帮助？
                                    </button>
                                )
                                : status === "active_ai"
                                    ? null
                                    : (
                                        <p className="text-right text-xs font-semibold text-amber-800">
                                            {describeHumanSupportFooter(status)}
                                        </p>
                                    )}
                        </div>
                    </div>
                </section>

                <CitationPanel
                    citation={selectedCitation}
                    onClose={() => setSelectedCitation(null)}
                />
            </div>
        </main>
    );
}
