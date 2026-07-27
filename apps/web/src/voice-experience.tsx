import type { ConversationLanguage } from "@smartservice/contracts";
import { Button } from "@smartservice/ui";
import {
    Headphones,
    Mic,
    MicOff,
    ShieldCheck,
} from "lucide-react";
import {
    useEffect,
    useRef,
    useState,
    type JSX,
} from "react";

import {
    createPublicConversation,
    createVoiceToken,
} from "./lib/public-conversation-api";
import {
    LiveKitVoiceRoomConnector,
    MockVoiceRoomConnector,
    type VoiceRoomConnection,
    type VoiceRoomConnector,
} from "./lib/voice-room";

type VoiceUiState =
    | "idle"
    | "warming"
    | "ready"
    | "listening"
    | "denied"
    | "failed"
    | "ended";

export interface VoiceExperienceProps
{
    connector?: VoiceRoomConnector;
    requestMicrophone?: () => Promise<void>;
}

/**
 * requestBrowserMicrophone
 * ----------------
 * Requests one audio track only after the connector reports that the Agent is Ready, then immediately releases the permission probe.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
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
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
function describeVoiceState(state: VoiceUiState): string
{
    const descriptions: Record<VoiceUiState, string> = {
        denied: "Microphone access was denied. You can continue securely by text.",
        ended: "Voice session ended. No audio recording was stored.",
        failed: "Voice could not start. Please use text chat or try again.",
        idle: "Click Start voice to create a private session. Nothing connects before your click.",
        listening: "Listening now. Ask your question in Chinese or English.",
        ready: "Agent Ready. Requesting microphone access…",
        warming: "Warming the voice agent…",
    };

    return descriptions[state];
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
    requestMicrophone = requestBrowserMicrophone,
}: VoiceExperienceProps): JSX.Element
{
    const [language, setLanguage] = useState<ConversationLanguage>("zh-CN");
    const [state, setState] = useState<VoiceUiState>("idle");
    const [transcript, setTranscript] = useState("");
    const connection = useRef<VoiceRoomConnection | null>(null);
    const publicKey = import.meta.env.VITE_DEMO_PUBLIC_KEY ?? "novaflow-public-demo";

    useEffect(() =>
    {
        return () =>
        {
            if (connection.current !== null)
            {
                void connection.current.disconnect();
            }
        };
    }, []);

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
        setTranscript("");

        try
        {
            const conversation = await createPublicConversation(
                publicKey,
                language,
                "local-demo-turnstile",
                "voice",
            );
            const token = await createVoiceToken(
                conversation.conversationId,
                conversation.conversationToken,
            );
            const selectedConnector = connector
                ?? (token.provider === "mock"
                    ? new MockVoiceRoomConnector()
                    : new LiveKitVoiceRoomConnector());
            connection.current = await selectedConnector.connect(token, {
                /**
                 * onDisconnected
                 * ----------------
                 * Reflects provider or customer room shutdown in the visible lifecycle.
                 *
                 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
                 */
                onDisconnected(): void
                {
                    setState("ended");
                },
                /**
                 * onReady
                 * ----------------
                 * Requests microphone permission only after the Agent is ready and exposes a friendly denial fallback.
                 *
                 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
                 */
                async onReady(): Promise<boolean>
                {
                    setState("ready");

                    try
                    {
                        await requestMicrophone();
                        setState("listening");
                        return true;
                    }
                    catch
                    {
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
            });
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
        await connection.current?.disconnect();
        connection.current = null;
        setState("ended");
    }

    return (
        <main className="min-h-screen bg-slate-950 px-5 py-10 text-white">
            <section className="mx-auto max-w-3xl rounded-[2rem] border border-white/10 bg-slate-900 p-7 shadow-2xl">
                <div className="flex items-center gap-3 text-cyan-300">
                    <Headphones aria-hidden="true" />
                    <span className="text-sm font-semibold uppercase tracking-[0.18em]">NovaFlow voice support</span>
                </div>
                <h1 className="mt-5 text-4xl font-semibold">Talk when the agent is Ready</h1>
                <p className="mt-3 text-slate-300">{describeVoiceState(state)}</p>

                <div className="mt-7 flex flex-wrap gap-3">
                    <label className="sr-only" htmlFor="voice-language">Voice language</label>
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
                        <option value="zh-CN">中文</option>
                        <option value="en">English</option>
                    </select>
                    {state === "idle" || state === "ended" || state === "failed"
                        ? (
                            <Button onClick={() => void startVoice()}>
                                <Mic aria-hidden="true" className="mr-2 size-4" />
                                Start voice
                            </Button>
                        )
                        : (
                            <Button onClick={() => void endVoice()} variant="outline">
                                <MicOff aria-hidden="true" className="mr-2 size-4" />
                                End voice
                            </Button>
                        )}
                    <a
                        className="inline-flex items-center rounded-xl border border-white/15 px-4 py-2 text-sm font-medium"
                        href="/chat"
                    >
                        Continue by text
                    </a>
                </div>

                <div aria-live="polite" className="mt-8 min-h-32 rounded-2xl bg-slate-950 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Live transcript</p>
                    <p className="mt-3 text-lg text-slate-100">
                        {transcript || "Your transcript will appear here after you speak."}
                    </p>
                </div>

                <p className="mt-5 flex items-center gap-2 text-sm text-slate-400">
                    <ShieldCheck aria-hidden="true" className="size-4" />
                    Browser microphone only. Audio recording is off by default.
                </p>
            </section>
        </main>
    );
}
