import {
    Room,
    RoomEvent,
    Track,
    type Participant,
    type RemoteTrack,
    type TranscriptionSegment,
} from "livekit-client";

import type { CreateVoiceTokenResponse } from "@smartservice/contracts";

export interface VoiceRoomCallbacks
{
    onAudioPlaybackStarted(startedAt: string): void;
    onDisconnected(): void;
    onReady(): Promise<boolean>;
    onTranscript(text: string, final: boolean): void;
}

export interface VoiceRoomConnection
{
    disconnect(): Promise<void>;
}

export interface VoiceRoomConnector
{
    connect(
        token: CreateVoiceTokenResponse,
        callbacks: VoiceRoomCallbacks,
    ): Promise<VoiceRoomConnection>;
}

/**
 * isReadyAgentState
 * ----------------
 * Treats all post-initialization Agent states as Ready so microphone permission is never requested during warming.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
function isReadyAgentState(state: string | undefined): boolean
{
    return state === "idle"
        || state === "listening"
        || state === "thinking"
        || state === "speaking";
}

/**
 * readAgentReady
 * ----------------
 * Reads the documented LiveKit Agent state attribute from one participant without trusting arbitrary metadata.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
function readAgentReady(participant: Participant): boolean
{
    return isReadyAgentState(participant.attributes["lk.agent.state"]);
}

class BrowserAudioPlaybackProbe
{
    private readonly analyser: AnalyserNode;
    private readonly audioContext: AudioContext;
    private active = false;
    private animationFrame: number | null = null;
    private lastAudibleAt = 0;
    private readonly samples: Uint8Array<ArrayBuffer>;

    /**
     * BrowserAudioPlaybackProbe
     * ----------------
     * Creates a non-output Web Audio analyser over the exact subscribed Agent track so reported playback starts come from browser-received audio samples.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 8 Browser Playback Timing
     */
    public constructor(
        track: RemoteTrack,
        private readonly onPlaybackStarted: (startedAt: string) => void,
    )
    {
        this.audioContext = new AudioContext();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.samples = new Uint8Array(this.analyser.fftSize);
        this.audioContext
            .createMediaStreamSource(new MediaStream([track.mediaStreamTrack]))
            .connect(this.analyser);
    }

    /**
     * start
     * ----------------
     * Samples browser-received PCM energy and emits once at the beginning of each audible speech burst.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 8 Browser Playback Timing
     */
    public start(): void
    {
        /**
         * sample
         * ----------------
         * Distinguishes audible playback from silence with a conservative energy threshold and rearms after 250 milliseconds of silence.
         *
         * July 27, 2026: Created by Forrest Zhang for SmartService Day 8 Browser Playback Timing
         */
        const sample = (): void =>
        {
            this.analyser.getByteTimeDomainData(this.samples);
            let peak = 0;

            for (const value of this.samples)
            {
                peak = Math.max(peak, Math.abs(value - 128));
            }

            const now = performance.now();

            if (peak >= 4)
            {
                this.lastAudibleAt = now;

                if (!this.active)
                {
                    this.active = true;
                    this.onPlaybackStarted(new Date().toISOString());
                }
            }
            else if (this.active && now - this.lastAudibleAt >= 250)
            {
                this.active = false;
            }

            this.animationFrame = window.requestAnimationFrame(sample);
        };

        this.animationFrame = window.requestAnimationFrame(sample);
    }

    /**
     * stop
     * ----------------
     * Stops sampling and releases the browser audio context during room shutdown.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 8 Browser Playback Timing
     */
    public async stop(): Promise<void>
    {
        if (this.animationFrame !== null)
        {
            window.cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        await this.audioContext.close();
    }
}

class LiveKitVoiceRoomConnection implements VoiceRoomConnection
{
    /**
     * LiveKitVoiceRoomConnection
     * ----------------
     * Wraps one connected room with a narrow asynchronous shutdown contract.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public constructor(
        private readonly room: Room,
        private readonly audioElements: HTMLMediaElement[],
        private readonly playbackProbes: BrowserAudioPlaybackProbe[],
    )
    {
    }

    /**
     * disconnect
     * ----------------
     * Disables the local microphone before leaving the room and releases LiveKit media resources.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public async disconnect(): Promise<void>
    {
        await this.room.localParticipant.setMicrophoneEnabled(false);
        await Promise.all(this.playbackProbes.map((probe) => probe.stop()));

        for (const element of this.audioElements)
        {
            element.remove();
        }

        await this.room.disconnect();
    }
}

export class LiveKitVoiceRoomConnector implements VoiceRoomConnector
{
    /**
     * connect
     * ----------------
     * Joins muted, watches Agent state and transcripts, then enables the microphone only after the Agent reports Ready.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public async connect(
        token: CreateVoiceTokenResponse,
        callbacks: VoiceRoomCallbacks,
    ): Promise<VoiceRoomConnection>
    {
        const room = new Room({
            adaptiveStream: true,
            dynacast: true,
        });
        const audioElements: HTMLMediaElement[] = [];
        const playbackProbes: BrowserAudioPlaybackProbe[] = [];
        let microphoneEnabled = false;

        /**
         * markReady
         * ----------------
         * Enables microphone capture once after a documented post-warm Agent state becomes visible.
         *
         * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
         */
        async function markReady(): Promise<void>
        {
            if (microphoneEnabled)
            {
                return;
            }

            microphoneEnabled = true;
            const permissionGranted = await callbacks.onReady();

            if (permissionGranted)
            {
                await room.localParticipant.setMicrophoneEnabled(true);
            }
        }

        room.on(RoomEvent.ParticipantAttributesChanged, (_attributes, participant) =>
        {
            if (readAgentReady(participant))
            {
                void markReady();
            }
        });
        room.on(RoomEvent.ParticipantConnected, (participant) =>
        {
            if (readAgentReady(participant))
            {
                void markReady();
            }
        });
        room.on(RoomEvent.TranscriptionReceived, (
            segments: TranscriptionSegment[],
        ) =>
        {
            for (const segment of segments)
            {
                callbacks.onTranscript(segment.text, segment.final);
            }
        });
        room.on(RoomEvent.TrackSubscribed, (track) =>
        {
            if (track.kind !== Track.Kind.Audio)
            {
                return;
            }

            const element = document.createElement("audio");
            element.autoplay = true;
            element.hidden = true;
            document.body.append(element);
            track.attach(element);
            audioElements.push(element);

            const probe = new BrowserAudioPlaybackProbe(
                track,
                callbacks.onAudioPlaybackStarted,
            );
            probe.start();
            playbackProbes.push(probe);
        });
        room.on(RoomEvent.Disconnected, callbacks.onDisconnected);
        await room.connect(token.url, token.token, {
            autoSubscribe: true,
        });

        for (const participant of room.remoteParticipants.values())
        {
            if (readAgentReady(participant))
            {
                await markReady();
                break;
            }
        }

        return new LiveKitVoiceRoomConnection(
            room,
            audioElements,
            playbackProbes,
        );
    }
}

export class MockVoiceRoomConnector implements VoiceRoomConnector
{
    /**
     * connect
     * ----------------
     * Simulates a zero-cost Ready transition for deterministic local and browser tests without contacting WebRTC providers.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public async connect(
        _token: CreateVoiceTokenResponse,
        callbacks: VoiceRoomCallbacks,
    ): Promise<VoiceRoomConnection>
    {
        await callbacks.onReady();

        return {
            /**
             * disconnect
             * ----------------
             * Completes local mock shutdown without external side effects.
             *
             * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
             */
            async disconnect(): Promise<void>
            {
                callbacks.onDisconnected();
            },
        };
    }
}
