import {
    createVoiceTokenResponseSchema,
    recordVoiceTranscriptResponseSchema,
    type CreateVoiceTokenResponse,
    type RecordVoiceTranscriptRequest,
    type RecordVoiceTranscriptResponse,
    type UpdateVoiceSessionStatusRequest,
    type VoiceSessionConfiguration,
} from "@smartservice/contracts";
import {
    AccessToken,
    RoomAgentDispatch,
    RoomConfiguration,
} from "livekit-server-sdk";

import type { SupabaseConversationRepository } from "./conversation-repository";
import {
    ConversationTokenService,
    readConversationBearerToken,
} from "./conversation-token";
import { ApiError } from "./errors";
import type {
    SmartServiceBindings,
    VoiceService,
} from "./types";
import type { SupabaseVoiceRepository } from "./voice-repository";

interface VoiceTokenProvider
{
    readonly mode: "live" | "mock";
    issue(
        roomName: string,
        participantIdentity: string,
        voiceSessionId: string,
    ): Promise<{ expiresAt: string; token: string; url: string }>;
}

const TOKEN_TTL_SECONDS = 600;

/**
 * requireVoiceBinding
 * ----------------
 * Reads one non-empty voice binding while keeping the value out of errors and logs.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
function requireVoiceBinding(
    bindings: SmartServiceBindings,
    name: "LIVEKIT_API_KEY" | "LIVEKIT_API_SECRET" | "LIVEKIT_URL" | "VOICE_INTERNAL_SERVICE_TOKEN",
): string
{
    const value = bindings[name];

    if (value === undefined || value.length === 0)
    {
        throw new ApiError(503, "VOICE_CONFIGURATION_MISSING", `The server binding ${name} is not configured.`);
    }

    return value;
}

/**
 * safeEqual
 * ----------------
 * Compares service-token bytes without returning early on matching-length content.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
async function safeEqual(left: string, right: string): Promise<boolean>
{
    if (left.length !== right.length || left.length < 32)
    {
        return false;
    }

    const [leftHash, rightHash] = await Promise.all([
        crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
        crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
    ]);
    const leftBytes = new Uint8Array(leftHash);
    const rightBytes = new Uint8Array(rightHash);
    let difference = 0;

    for (let index = 0; index < leftBytes.length; index += 1)
    {
        difference |= (leftBytes.at(index) ?? 0) ^ (rightBytes.at(index) ?? 0);
    }

    return difference === 0;
}

/**
 * readServiceBearerToken
 * ----------------
 * Extracts a bounded internal bearer token without logging or reflecting it.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
function readServiceBearerToken(request: Request): string
{
    const authorization = request.headers.get("authorization");

    if (authorization === null || !authorization.startsWith("Bearer "))
    {
        throw new ApiError(401, "VOICE_SERVICE_TOKEN_REQUIRED", "Voice-agent authentication is required.");
    }

    const token = authorization.slice("Bearer ".length).trim();

    if (token.length < 32 || token.length > 4096)
    {
        throw new ApiError(401, "VOICE_SERVICE_TOKEN_INVALID", "Voice-agent authentication is not valid.");
    }

    return token;
}

class MockVoiceTokenProvider implements VoiceTokenProvider
{
    public readonly mode = "mock";

    /**
     * issue
     * ----------------
     * Issues a deterministic local-only token envelope without contacting LiveKit or incurring provider cost.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public async issue(
        roomName: string,
        participantIdentity: string,
        voiceSessionId: string,
    ): Promise<{ expiresAt: string; token: string; url: string }>
    {
        const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString();
        const payload = btoa(JSON.stringify({
            participantIdentity,
            roomName,
            voiceSessionId,
        })).replace(/=+$/gu, "");

        return {
            expiresAt,
            token: `mock.${payload}.local-signature`,
            url: "https://mock-livekit.smartservice.local",
        };
    }
}

class LiveKitVoiceTokenProvider implements VoiceTokenProvider
{
    public readonly mode = "live";

    /**
     * LiveKitVoiceTokenProvider
     * ----------------
     * Creates the short-lived room token adapter from server-only LiveKit credentials and explicit agent dispatch.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public constructor(
        private readonly url: string,
        private readonly apiKey: string,
        private readonly apiSecret: string,
        private readonly agentName: string,
    )
    {
    }

    /**
     * issue
     * ----------------
     * Signs a microphone-only customer token that dispatches the named SmartService Agent with an ID-only metadata payload.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public async issue(
        roomName: string,
        participantIdentity: string,
        voiceSessionId: string,
    ): Promise<{ expiresAt: string; token: string; url: string }>
    {
        const accessToken = new AccessToken(
            this.apiKey,
            this.apiSecret,
            {
                identity: participantIdentity,
                metadata: JSON.stringify({
                    voiceSessionId,
                }),
                ttl: TOKEN_TTL_SECONDS,
            },
        );
        accessToken.addGrant({
            canPublish: true,
            canPublishData: true,
            canSubscribe: true,
            room: roomName,
            roomJoin: true,
        });
        accessToken.roomConfig = new RoomConfiguration({
            agents: [
                new RoomAgentDispatch({
                    agentName: this.agentName,
                    metadata: JSON.stringify({
                        voiceSessionId,
                    }),
                }),
            ],
        });

        return {
            expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString(),
            token: await accessToken.toJwt(),
            url: this.url,
        };
    }
}

/**
 * createVoiceTokenProvider
 * ----------------
 * Selects the explicit live or zero-cost mock voice token provider and fails closed for incomplete live settings.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
function createVoiceTokenProvider(bindings: SmartServiceBindings): VoiceTokenProvider
{
    if (bindings.VOICE_PROVIDER_MODE !== "live")
    {
        return new MockVoiceTokenProvider();
    }

    return new LiveKitVoiceTokenProvider(
        requireVoiceBinding(bindings, "LIVEKIT_URL"),
        requireVoiceBinding(bindings, "LIVEKIT_API_KEY"),
        requireVoiceBinding(bindings, "LIVEKIT_API_SECRET"),
        bindings.LIVEKIT_AGENT_NAME ?? "smartservice-voice-agent",
    );
}

export class DefaultVoiceService implements VoiceService
{
    private readonly tokenProvider: VoiceTokenProvider;
    private readonly conversationTokens: ConversationTokenService;

    /**
     * DefaultVoiceService
     * ----------------
     * Creates the public-token and internal-agent voice boundary with tenant checks and explicit provider selection.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public constructor(
        private readonly bindings: SmartServiceBindings,
        private readonly conversations: SupabaseConversationRepository,
        private readonly repository: SupabaseVoiceRepository,
    )
    {
        this.tokenProvider = createVoiceTokenProvider(bindings);
        this.conversationTokens = new ConversationTokenService(
            bindings.CONVERSATION_TOKEN_SECRET ?? "",
            7_200,
        );
    }

    /**
     * createToken
     * ----------------
     * Verifies the scoped conversation token, creates the exact voice session, and returns a ten-minute room token.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public async createToken(
        request: Request,
        conversationId: string,
        requestId: string,
    ): Promise<CreateVoiceTokenResponse>
    {
        const claims = await this.conversationTokens.verify(
            readConversationBearerToken(request),
            conversationId,
            "conversation:write",
        );
        const conversation = await this.conversations.getConversation(
            claims.org,
            conversationId,
        );

        if (
            conversation === null
            || conversation.channel !== "voice"
            || conversation.status !== "active_ai"
        )
        {
            throw new ApiError(409, "VOICE_CONVERSATION_NOT_ACTIVE", "This conversation cannot start a voice session.");
        }

        const roomName = `ss-${conversation.organizationId.slice(0, 8)}-${conversation.id}`;
        const participantIdentity = `customer-${conversation.id}`;
        const created = await this.repository.createSession(
            conversation.organizationId,
            conversation.id,
            roomName,
            participantIdentity,
            this.tokenProvider.mode === "live" ? "livekit" : "mock",
            requestId,
        );
        const issued = await this.tokenProvider.issue(
            roomName,
            participantIdentity,
            created.voiceSessionId,
        );

        return createVoiceTokenResponseSchema.parse({
            agentName: this.bindings.LIVEKIT_AGENT_NAME ?? "smartservice-voice-agent",
            expiresAt: issued.expiresAt,
            provider: this.tokenProvider.mode,
            roomName,
            token: issued.token,
            url: issued.url,
            voiceSessionId: created.voiceSessionId,
        });
    }

    /**
     * getConfiguration
     * ----------------
     * Authorizes the voice Agent and returns the minimum session configuration bound to one voice-session ID.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public async getConfiguration(
        request: Request,
        voiceSessionId: string,
    ): Promise<VoiceSessionConfiguration>
    {
        await this.authorizeInternal(request);
        const session = await this.repository.getSession(voiceSessionId);

        if (session === null)
        {
            throw new ApiError(404, "VOICE_SESSION_NOT_FOUND", "The voice session does not exist.");
        }

        return session;
    }

    /**
     * recordTranscript
     * ----------------
     * Authorizes the Agent and records only final tenant-bound STT text with idempotent message identity.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public async recordTranscript(
        request: Request,
        voiceSessionId: string,
        input: RecordVoiceTranscriptRequest,
    ): Promise<RecordVoiceTranscriptResponse>
    {
        const session = await this.getConfiguration(request, voiceSessionId);

        if (input.language !== session.language)
        {
            throw new ApiError(409, "VOICE_LANGUAGE_MISMATCH", "The transcript language does not match the session.");
        }

        return recordVoiceTranscriptResponseSchema.parse(
            await this.repository.recordTranscript(
                session,
                input.clientMessageId,
                input.text,
                input.language,
            ),
        );
    }

    /**
     * updateStatus
     * ----------------
     * Authorizes the Agent and persists one validated lifecycle status without accepting tenant identity from the caller.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    public async updateStatus(
        request: Request,
        voiceSessionId: string,
        input: UpdateVoiceSessionStatusRequest,
        requestId: string,
    ): Promise<void>
    {
        await this.authorizeInternal(request);
        await this.repository.updateStatus(
            voiceSessionId,
            input.status,
            input.errorCode,
            requestId,
        );
    }

    /**
     * authorizeInternal
     * ----------------
     * Validates the internal Agent bearer credential with a bounded constant-work comparison.
     *
     * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
     */
    private async authorizeInternal(request: Request): Promise<void>
    {
        const expected = requireVoiceBinding(this.bindings, "VOICE_INTERNAL_SERVICE_TOKEN");
        const supplied = readServiceBearerToken(request);

        if (!await safeEqual(supplied, expected))
        {
            throw new ApiError(401, "VOICE_SERVICE_TOKEN_INVALID", "Voice-agent authentication is not valid.");
        }
    }
}
