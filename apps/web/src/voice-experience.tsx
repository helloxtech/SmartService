import type {
    ConversationLanguage,
    PublicMessage,
} from "@smartservice/contracts";
import { Button } from "@smartservice/ui";
import {
    Headphones,
    Mic,
    MicOff,
    ShieldCheck,
    Volume2,
} from "lucide-react";
import {
    useEffect,
    useRef,
    useState,
    type JSX,
} from "react";

import {
    createPublicConversationWithFallback,
    createVoiceToken,
    endVoiceSession,
    getConfiguredDemoPublicKeys,
    pollPublicMessages,
} from "./lib/public-conversation-api";
import {
    LanguageSwitch,
    type UiLanguage,
} from "./language";
import {
    LiveKitVoiceRoomConnector,
    type VoiceRoomConnection,
    type VoiceRoomConnector,
} from "./lib/voice-room";

type VoiceUiState =
    | "idle"
    | "warming"
    | "ready"
    | "listening"
    | "reconnecting"
    | "handoff"
    | "denied"
    | "unavailable"
    | "failed"
    | "ended";

export interface VoiceExperienceProps
{
    connector?: VoiceRoomConnector;
    onUiLanguageChange?: (language: UiLanguage) => void;
    requestMicrophone?: () => Promise<void>;
    uiLanguage?: UiLanguage;
}

const voiceCopy: Record<UiLanguage, {
    audioBlockedNotice: string;
    enableAudio: string;
    answersLabel: string;
    continueText: string;
    endVoice: string;
    languageLabel: string;
    languageOptionEnglish: string;
    languageOptionZh: string;
    microphoneNotice: string;
    playbackFallback: string;
    startVoice: string;
    state: Record<VoiceUiState, string>;
    subtitle: string;
    title: string;
    transcriptEmpty: string;
    transcriptTitle: string;
    voiceTitle: string;
}> = {
    en: {
        audioBlockedNotice: "Your browser blocked customer-service audio. Tap once to hear replies.",
        answersLabel: "Customer service answers",
        continueText: "Continue by text",
        enableAudio: "Enable reply audio",
        endVoice: "End voice",
        languageLabel: "Voice language",
        languageOptionEnglish: "English",
        languageOptionZh: "Chinese",
        microphoneNotice: "Browser microphone only. Audio recording is off by default.",
        playbackFallback: "No browser playback observed",
        startVoice: "Start voice",
        state: {
            denied: "Microphone access was denied. You can continue securely by text.",
            ended: "Voice session ended. No audio recording was stored.",
            failed: "Voice could not start. Please continue in text customer service.",
            handoff: "Voice has paused. A support specialist can now review your transcript and enquiry.",
            idle: "Click Start voice to create a private session. Nothing connects before your click.",
            listening: "Listening now. Ask your question in Chinese or English.",
            ready: "Customer service ready. Requesting microphone access…",
            reconnecting: "Connection interrupted. Refreshing the secure token and reconnecting…",
            unavailable: "Voice service is not connected in this environment. Please continue by text.",
            warming: "Preparing your customer-service conversation…",
        },
        subtitle: "Talk with customer service when ready",
        title: "Smart Service customer-service voice",
        transcriptEmpty: "Your transcript will appear here after you speak.",
        transcriptTitle: "Live transcript",
        voiceTitle: "A support specialist can now review the transcript and continue with your enquiry.",
    },
    "zh-CN": {
        audioBlockedNotice: "浏览器阻止了客服语音播放，请点击一次开启声音。",
        answersLabel: "客服回答",
        continueText: "继续文字聊天",
        enableAudio: "开启回复声音",
        endVoice: "结束语音",
        languageLabel: "语音语言",
        languageOptionEnglish: "英文",
        languageOptionZh: "中文",
        microphoneNotice: "仅使用浏览器麦克风，默认不录音。",
        playbackFallback: "尚未检测到浏览器播放",
        startVoice: "开始语音",
        state: {
            denied: "麦克风权限被拒绝，您可以继续使用文字聊天。",
            ended: "语音会话已结束，未保存录音。",
            failed: "语音暂时无法启动，请继续使用文字在线客服。",
            handoff: "语音咨询已暂停，客服专员现在可以查看您的文字记录和咨询内容。",
            idle: "点击开始语音后才会创建私密会话。",
            listening: "正在聆听，请用中文或英文提问。",
            ready: "在线客服已就绪，正在请求麦克风权限…",
            reconnecting: "连接中断，正在刷新安全令牌并重连…",
            unavailable: "当前环境尚未连接语音服务，请继续使用文字在线客服。",
            warming: "正在准备您的客服咨询…",
        },
        subtitle: "在线客服就绪后开始咨询",
        title: "Smart Service 语音在线客服",
        transcriptEmpty: "开始说话后，这里会显示实时文字。",
        transcriptTitle: "实时文字",
        voiceTitle: "客服专员现在可以查看文字记录并继续跟进您的咨询。",
    },
};

/**
 * ignoreLanguageChange
 * ----------------
 * Provides a safe no-op callback for isolated voice component tests that do not mount the full app shell.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService Language Switch
 */
function ignoreLanguageChange(): void
{
}

/**
 * requestBrowserMicrophone
 * ----------------
 * Requests one audio track only after the connector reports that the Agent is Ready, then immediately releases the permission probe.
 *
 * July 30, 2026: Updated by Forrest Zhang for SmartService Chinese UI
 */
async function requestBrowserMicrophone(): Promise<void>
{
    if (navigator.mediaDevices?.getUserMedia === undefined)
    {
        throw new Error("Microphone access is unavailable.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
    });

    for (const track of stream.getTracks())
    {
        track.stop();
    }
}

/**
 * describeVoiceState
 * ----------------
 * Maps each lifecycle state to concise bilingual-ready customer guidance.
 *
 * July 30, 2026: Updated by Forrest Zhang for SmartService Chinese UI
 */
function describeVoiceState(state: VoiceUiState, language: UiLanguage): string
{
    return voiceCopy[language].state[state];
}

/**
 * VoiceExperience
 * ----------------
 * Runs the explicit-click voice lifecycle with muted warming, Ready-gated microphone permission, transcripts, and a text fallback.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
export function VoiceExperience({
    connector,
    onUiLanguageChange = ignoreLanguageChange,
    requestMicrophone = requestBrowserMicrophone,
    uiLanguage = "en",
}: VoiceExperienceProps): JSX.Element
{
    const copy = voiceCopy[uiLanguage];
    const [language, setLanguage] = useState<ConversationLanguage>("zh-CN");
    const [state, setState] = useState<VoiceUiState>("idle");
    const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [lastPlaybackStartedAt, setLastPlaybackStartedAt] = useState<string | null>(null);
    const [messages, setMessages] = useState<PublicMessage[]>([]);
    const [voiceConversation, setVoiceConversation] = useState<{
        conversationId: string;
        conversationToken: string;
        voiceSessionId: string;
    } | null>(null);
    const voiceConversationRef = useRef<{
        conversationId: string;
        conversationToken: string;
        voiceSessionId: string;
    } | null>(null);
    const connection = useRef<VoiceRoomConnection | null>(null);
    const activeConnector = useRef<VoiceRoomConnector | null>(null);
    const reconnectAttempts = useRef(0);
    const reconnectInFlight = useRef(false);
    const reconnectTimer = useRef<number | null>(null);
    const intentionalShutdown = useRef(false);
    const handoffActive = useRef(false);
    const cursor = useRef<string | null>(null);
    const etag = useRef<string | null>(null);
    const publicKeys = getConfiguredDemoPublicKeys();

    useEffect(() =>
    {
        return () =>
        {
            if (connection.current !== null)
            {
                intentionalShutdown.current = true;
                void connection.current.disconnect();
            }

            if (reconnectTimer.current !== null)
            {
                window.clearTimeout(reconnectTimer.current);
            }
        };
    }, []);

    useEffect(() =>
    {
        if (voiceConversation === null)
        {
            return;
        }

        let active = true;
        const activeConversation = voiceConversation;

        /**
         * pollAnswers
         * ----------------
         * Polls only public AI, handoff, or human messages so citations appear on screen without traveling through the audio channel.
         *
         * July 27, 2026: Created by Forrest Zhang for SmartService Day 7 Voice RAG and TTS
         */
        async function pollAnswers(): Promise<void>
        {
            try
            {
                const result = await pollPublicMessages(
                    activeConversation.conversationId,
                    activeConversation.conversationToken,
                    cursor.current,
                    etag.current,
                );

                if (!active || result.response === null)
                {
                    return;
                }

                const response = result.response;
                etag.current = result.etag;
                cursor.current = response.nextCursor;

                if (
                    response.status === "handoff_requested"
                    || response.status === "active_human"
                )
                {
                    handoffActive.current = true;
                    setState("handoff");
                }

                setMessages((current) =>
                {
                    const known = new Set(current.map((message) => message.messageId));
                    return [
                        ...current,
                        ...response.messages.filter(
                            (message) => !known.has(message.messageId),
                        ),
                    ];
                });
            }
            catch
            {
                // Voice audio remains usable when a bounded display-only poll fails.
            }
        }

        void pollAnswers();
        const timer = window.setInterval(() =>
        {
            void pollAnswers();
        }, 1_000);

        return () =>
        {
            active = false;
            window.clearInterval(timer);
        };
    }, [voiceConversation]);

    /**
     * recoverVoiceConnection
     * ----------------
     * Refreshes the short-lived room token and reconnects at most twice after an unrecoverable room disconnect.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 9 Voice Reconnection
     */
    async function recoverVoiceConnection(): Promise<void>
    {
        const currentConversation = voiceConversationRef.current;
        const currentConnector = activeConnector.current;

        if (
            intentionalShutdown.current
            || handoffActive.current
            || reconnectInFlight.current
            || currentConversation === null
            || currentConnector === null
        )
        {
            return;
        }

        if (reconnectAttempts.current >= 2)
        {
            setState("failed");
            return;
        }

        reconnectInFlight.current = true;
        reconnectAttempts.current += 1;
        setState("reconnecting");

        try
        {
            const refreshedToken = await createVoiceToken(
                currentConversation.conversationId,
                currentConversation.conversationToken,
            );
            connection.current = await currentConnector.connect(
                refreshedToken,
                createRoomCallbacks(),
            );
        }
        catch
        {
            if (reconnectAttempts.current >= 2)
            {
                setState("failed");
            }
            else
            {
                reconnectTimer.current = window.setTimeout(() =>
                {
                    void recoverVoiceConnection();
                }, 750);
            }
        }
        finally
        {
            reconnectInFlight.current = false;
        }
    }

    /**
     * createRoomCallbacks
     * ----------------
     * Creates one bounded callback set for initial connection, native reconnect, token refresh, playback timing, and microphone safety.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 9 Voice Reconnection
     */
    function createRoomCallbacks(): Parameters<VoiceRoomConnector["connect"]>[1]
    {
        return {
            /**
             * onAudioPlaybackBlocked
             * ----------------
             * Exposes the browser's autoplay restriction so mobile customers receive a direct tap-to-enable control.
             *
             * August 07, 2026: Created by Forrest Zhang for SmartService Mobile Voice Playback
             */
            onAudioPlaybackBlocked(): void
            {
                setAudioPlaybackBlocked(true);
            },
            /**
             * onAudioPlaybackReady
             * ----------------
             * Hides the manual playback control as soon as LiveKit confirms that remote speech may play.
             *
             * August 07, 2026: Created by Forrest Zhang for SmartService Mobile Voice Playback
             */
            onAudioPlaybackReady(): void
            {
                setAudioPlaybackBlocked(false);
            },
            /**
             * onAudioPlaybackStarted
             * ----------------
             * Stores the browser-observed start of each audible Agent speech burst for honest latency evidence.
             *
             * July 27, 2026: Created by Forrest Zhang for SmartService Day 8 Browser Playback Timing
             */
            onAudioPlaybackStarted(startedAt): void
            {
                setLastPlaybackStartedAt(startedAt);
            },
            /**
             * onDisconnected
             * ----------------
             * Keeps intentional and handoff shutdown terminal, otherwise starts one bounded secure-token recovery sequence.
             *
             * July 27, 2026: Updated by Forrest Zhang for SmartService Day 9 Voice Reconnection
             */
            onDisconnected(): void
            {
                if (intentionalShutdown.current)
                {
                    setState("ended");
                }
                else if (handoffActive.current)
                {
                    setState("handoff");
                }
                else
                {
                    void recoverVoiceConnection();
                }
            },
            /**
             * onReconnected
             * ----------------
             * Restores the listening state after LiveKit completes its native reconnect.
             *
             * July 27, 2026: Created by Forrest Zhang for SmartService Day 9 Voice Reconnection
             */
            onReconnected(): void
            {
                reconnectAttempts.current = 0;
                setState("listening");
            },
            /**
             * onReconnecting
             * ----------------
             * Makes a transient LiveKit network recovery visible without starting an application-level retry loop.
             *
             * July 27, 2026: Created by Forrest Zhang for SmartService Day 9 Voice Reconnection
             */
            onReconnecting(): void
            {
                setState("reconnecting");
            },
            /**
             * onReady
             * ----------------
             * Requests microphone permission only after the Agent is ready and exposes a friendly denial fallback.
             *
             * July 27, 2026: Updated by Forrest Zhang for SmartService Day 9 Voice Reconnection
             */
            async onReady(): Promise<boolean>
            {
                setState("ready");

                try
                {
                    await requestMicrophone();
                    reconnectAttempts.current = 0;
                    setState("listening");
                    return true;
                }
                catch
                {
                    intentionalShutdown.current = true;
                    setState("denied");
                    return false;
                }
            },
            /**
             * onTranscript
             * ----------------
             * Displays the latest bounded interim or final provider transcript without storing browser audio.
             *
             * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
             */
            onTranscript(text: string): void
            {
                setTranscript(text.slice(0, 5000));
            },
        };
    }

    /**
     * startVoice
     * ----------------
     * Creates conversation and room credentials only after the button click, waits for Ready, then handles microphone permission safely.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    async function startVoice(): Promise<void>
    {
        setState("warming");
        setAudioPlaybackBlocked(false);
        setTranscript("");
        setLastPlaybackStartedAt(null);
        setMessages([]);
        setVoiceConversation(null);
        voiceConversationRef.current = null;
        cursor.current = null;
        etag.current = null;
        intentionalShutdown.current = false;
        handoffActive.current = false;
        reconnectAttempts.current = 0;
        reconnectInFlight.current = false;

        try
        {
            const conversation = await createPublicConversationWithFallback(
                publicKeys,
                language,
                "local-demo-turnstile",
                "voice",
            );
            const token = await createVoiceToken(
                conversation.conversationId,
                conversation.conversationToken,
            );

            if (token.provider === "mock" && connector === undefined)
            {
                try
                {
                    await endVoiceSession(
                        conversation.conversationId,
                        conversation.conversationToken,
                        token.voiceSessionId,
                    );
                }
                catch
                {
                    // The public UI still fails closed when best-effort mock-session cleanup is unavailable.
                }

                setState("unavailable");
                return;
            }

            setVoiceConversation({
                conversationId: conversation.conversationId,
                conversationToken: conversation.conversationToken,
                voiceSessionId: token.voiceSessionId,
            });
            voiceConversationRef.current = {
                conversationId: conversation.conversationId,
                conversationToken: conversation.conversationToken,
                voiceSessionId: token.voiceSessionId,
            };
            const selectedConnector = connector ?? new LiveKitVoiceRoomConnector();
            activeConnector.current = selectedConnector;
            connection.current = await selectedConnector.connect(
                token,
                createRoomCallbacks(),
            );
        }
        catch
        {
            setState("failed");
        }
    }

    /**
     * endVoice
     * ----------------
     * Disconnects the active room, releases media, and returns a visible closed state.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    async function endVoice(): Promise<void>
    {
        intentionalShutdown.current = true;
        const currentConversation = voiceConversationRef.current;
        let failed = false;

        if (reconnectTimer.current !== null)
        {
            window.clearTimeout(reconnectTimer.current);
            reconnectTimer.current = null;
        }

        try
        {
            await connection.current?.disconnect();
        }
        catch
        {
            failed = true;
        }

        try
        {
            if (currentConversation !== null)
            {
                await endVoiceSession(
                    currentConversation.conversationId,
                    currentConversation.conversationToken,
                    currentConversation.voiceSessionId,
                );
            }
        }
        catch
        {
            failed = true;
        }

        setState(failed ? "failed" : "ended");
        connection.current = null;
        activeConnector.current = null;
        voiceConversationRef.current = null;
    }

    /**
     * enableAudioPlayback
     * ----------------
     * Retries LiveKit playback directly from the customer's tap, which satisfies restrictive mobile autoplay policies.
     *
     * August 07, 2026: Created by Forrest Zhang for SmartService Mobile Voice Playback
     */
    async function enableAudioPlayback(): Promise<void>
    {
        try
        {
            await connection.current?.enableAudioPlayback();
            setAudioPlaybackBlocked(false);
        }
        catch
        {
            setAudioPlaybackBlocked(true);
        }
    }

    return (
        <main className="min-h-screen bg-slate-950 px-5 py-10 text-white">
            <section className="mx-auto max-w-3xl rounded-[2rem] border border-white/10 bg-slate-900 p-7 shadow-2xl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 text-cyan-300">
                        <Headphones aria-hidden="true" />
                        <span className="text-sm font-semibold uppercase tracking-[0.18em]">{copy.title}</span>
                    </div>
                    <LanguageSwitch
                        language={uiLanguage}
                        onLanguageChange={onUiLanguageChange}
                    />
                </div>
                <h1 className="mt-5 text-4xl font-semibold">{copy.subtitle}</h1>
                <p
                    className="mt-3 text-slate-300"
                    role={state === "denied" || state === "failed" || state === "unavailable"
                        ? "alert"
                        : undefined}
                >
                    {describeVoiceState(state, uiLanguage)}
                </p>

                <div className="mt-7 flex flex-wrap gap-3">
                    <label className="sr-only" htmlFor="voice-language">{copy.languageLabel}</label>
                    <select
                        className="rounded-xl border border-white/15 bg-slate-950 px-4 py-3"
                        disabled={state === "warming" || state === "ready" || state === "listening"}
                        id="voice-language"
                        onChange={(event) =>
                        {
                            setLanguage(event.target.value as ConversationLanguage);
                        }}
                        value={language}
                    >
                        <option value="zh-CN">{copy.languageOptionZh}</option>
                        <option value="en">{copy.languageOptionEnglish}</option>
                    </select>
                    {state === "idle" || state === "ended" || state === "failed" || state === "unavailable"
                        ? (
                            <Button onClick={() => void startVoice()}>
                                <Mic aria-hidden="true" className="mr-2 size-4" />
                                {copy.startVoice}
                            </Button>
                        )
                        : (
                            <Button onClick={() => void endVoice()} variant="outline">
                                <MicOff aria-hidden="true" className="mr-2 size-4" />
                                {copy.endVoice}
                            </Button>
                        )}
                    <a
                        className="inline-flex items-center rounded-xl border border-white/15 px-4 py-2 text-sm font-medium"
                        href="/chat"
                    >
                        {copy.continueText}
                    </a>
                </div>

                {audioPlaybackBlocked
                    ? (
                        <div
                            className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/30 bg-amber-950/40 p-4 text-amber-100"
                            role="status"
                        >
                            <p>{copy.audioBlockedNotice}</p>
                            <Button onClick={() => void enableAudioPlayback()} variant="outline">
                                <Volume2 aria-hidden="true" className="mr-2 size-4" />
                                {copy.enableAudio}
                            </Button>
                        </div>
                    )
                    : null}

                <div aria-live="polite" className="mt-8 min-h-32 rounded-2xl bg-slate-950 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{copy.transcriptTitle}</p>
                    <p className="mt-3 text-lg text-slate-100">
                        {transcript || copy.transcriptEmpty}
                    </p>
                </div>

                {state === "handoff"
                    ? (
                        <div className="mt-5 rounded-2xl border border-amber-300/30 bg-amber-950/40 p-5 text-amber-100" role="status">
                            {copy.voiceTitle}
                        </div>
                    )
                    : null}

                {messages.length > 0
                    ? (
                        <section aria-label={copy.answersLabel} className="mt-5 space-y-4">
                            {messages.map((message) => (
                                <article className="rounded-2xl border border-white/10 bg-slate-800 p-5" key={message.messageId}>
                                    <p className="text-slate-100">{message.text}</p>
                                    {message.citations.length > 0
                                        ? (
                                            <div className="mt-4 flex flex-wrap gap-2">
                                                {message.citations.map((citation) => (
                                                    <span
                                                        className="rounded-full bg-cyan-950 px-3 py-1 text-xs text-cyan-200"
                                                        key={citation.citationId}
                                                        title={citation.supportingExcerpt}
                                                    >
                                                        {citation.label}
                                                    </span>
                                                ))}
                                            </div>
                                        )
                                        : null}
                                </article>
                            ))}
                        </section>
                    )
                    : null}

                <p className="mt-5 flex items-center gap-2 text-sm text-slate-400">
                    <ShieldCheck aria-hidden="true" className="size-4" />
                    {copy.microphoneNotice}
                </p>
                <p className="sr-only" data-testid="voice-playback-clock">
                    {lastPlaybackStartedAt ?? copy.playbackFallback}
                </p>
            </section>
        </main>
    );
}
