import {
    Room,
    RoomEvent,
    type Participant,
    type TranscriptionSegment,
} from "livekit-client";

import type { CreateVoiceTokenResponse } from "@smartservice/contracts";

export interface VoiceRoomCallbacks
{
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

class LiveKitVoiceRoomConnection implements VoiceRoomConnection
{
    /**
     * LiveKitVoiceRoomConnection
     * ----------------
     * Wraps one connected room with a narrow asynchronous shutdown contract.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public constructor(private readonly room: Room)
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

        return new LiveKitVoiceRoomConnection(room);
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
