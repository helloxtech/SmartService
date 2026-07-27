import {
    conversationTokenClaimsSchema,
    type ConversationTokenClaims,
} from "@smartservice/contracts";
import { z } from "zod";

import { ApiError } from "./errors";

const jwtHeaderSchema = z.object({
    alg: z.literal("HS256"),
    typ: z.literal("JWT"),
});

export interface IssuedConversationToken
{
    expiresAt: string;
    token: string;
}

/**
 * encodeBase64Url
 * ----------------
 * Encodes bytes into unpadded URL-safe Base64 for compact conversation-token segments.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
 */
function encodeBase64Url(bytes: Uint8Array): string
{
    let binary = "";

    for (const byte of bytes)
    {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary)
        .replace(/\+/gu, "-")
        .replace(/\//gu, "_")
        .replace(/=+$/gu, "");
}

/**
 * decodeBase64Url
 * ----------------
 * Decodes one bounded URL-safe Base64 segment and rejects malformed token data.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
 */
function decodeBase64Url(value: string): Uint8Array
{
    if (value.length === 0 || value.length > 4096 || !/^[A-Za-z0-9_-]+$/u.test(value))
    {
        throw new ApiError(401, "CONVERSATION_TOKEN_INVALID", "The conversation session is not valid.");
    }

    const normalized = value
        .replace(/-/gu, "+")
        .replace(/_/gu, "/")
        .padEnd(Math.ceil(value.length / 4) * 4, "=");

    try
    {
        return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
    }
    catch
    {
        throw new ApiError(401, "CONVERSATION_TOKEN_INVALID", "The conversation session is not valid.");
    }
}

/**
 * encodeJsonSegment
 * ----------------
 * Serializes one trusted token object as UTF-8 URL-safe Base64.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
 */
function encodeJsonSegment(value: unknown): string
{
    return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * decodeJsonSegment
 * ----------------
 * Parses one untrusted token segment into an unknown JSON value for subsequent schema validation.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
 */
function decodeJsonSegment(value: string): unknown
{
    try
    {
        return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as unknown;
    }
    catch (error: unknown)
    {
        if (error instanceof ApiError)
        {
            throw error;
        }

        throw new ApiError(401, "CONVERSATION_TOKEN_INVALID", "The conversation session is not valid.");
    }
}

/**
 * importHmacKey
 * ----------------
 * Imports the server-only conversation secret for HMAC signing or verification without exposing its bytes.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
 */
async function importHmacKey(secret: string, usage: KeyUsage): Promise<CryptoKey>
{
    if (secret.length < 32)
    {
        throw new ApiError(
            503,
            "CONVERSATION_TOKEN_CONFIGURATION_INVALID",
            "The conversation-token signer is not configured securely.",
        );
    }

    return crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        {
            hash: "SHA-256",
            name: "HMAC",
        },
        false,
        [usage],
    );
}

/**
 * readConversationBearerToken
 * ----------------
 * Extracts the public conversation bearer token without logging or reflecting it.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
 */
export function readConversationBearerToken(request: Request): string
{
    const authorization = request.headers.get("authorization");

    if (authorization === null || !authorization.startsWith("Bearer "))
    {
        throw new ApiError(401, "CONVERSATION_TOKEN_REQUIRED", "Start or resume a customer conversation.");
    }

    const token = authorization.slice("Bearer ".length).trim();

    if (token.length === 0 || token.length > 8192)
    {
        throw new ApiError(401, "CONVERSATION_TOKEN_INVALID", "The conversation session is not valid.");
    }

    return token;
}

export class ConversationTokenService
{
    /**
     * ConversationTokenService
     * ----------------
     * Creates a scoped HMAC conversation-token service with a bounded time-to-live.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
     */
    public constructor(
        private readonly secret: string,
        private readonly ttlSeconds = 7_200,
    )
    {
        if (ttlSeconds < 60 || ttlSeconds > 86_400)
        {
            throw new ApiError(
                503,
                "CONVERSATION_TOKEN_TTL_INVALID",
                "The conversation-token lifetime is not valid.",
            );
        }
    }

    /**
     * issue
     * ----------------
     * Issues a two-scope token bound to exactly one organization and conversation.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
     */
    public async issue(
        conversationId: string,
        organizationId: string,
        nowSeconds = Math.floor(Date.now() / 1000),
    ): Promise<IssuedConversationToken>
    {
        const claims = conversationTokenClaimsSchema.parse({
            exp: nowSeconds + this.ttlSeconds,
            nonce: crypto.randomUUID(),
            org: organizationId,
            scope: ["conversation:read", "conversation:write"],
            sub: conversationId,
        });
        const header = encodeJsonSegment({
            alg: "HS256",
            typ: "JWT",
        });
        const payload = encodeJsonSegment(claims);
        const signingInput = `${header}.${payload}`;
        const key = await importHmacKey(this.secret, "sign");
        const signature = new Uint8Array(
            await crypto.subtle.sign(
                "HMAC",
                key,
                new TextEncoder().encode(signingInput),
            ),
        );

        return {
            expiresAt: new Date(claims.exp * 1000).toISOString(),
            token: `${signingInput}.${encodeBase64Url(signature)}`,
        };
    }

    /**
     * verify
     * ----------------
     * Verifies signature, expiry, exact URL subject, and required scope before a public conversation operation.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
     */
    public async verify(
        token: string,
        conversationId: string,
        requiredScope: "conversation:read" | "conversation:write",
        nowSeconds = Math.floor(Date.now() / 1000),
    ): Promise<ConversationTokenClaims>
    {
        const segments = token.split(".");

        if (segments.length !== 3)
        {
            throw new ApiError(401, "CONVERSATION_TOKEN_INVALID", "The conversation session is not valid.");
        }

        const [headerSegment, payloadSegment, signatureSegment] = segments;

        if (
            headerSegment === undefined
            || payloadSegment === undefined
            || signatureSegment === undefined
        )
        {
            throw new ApiError(401, "CONVERSATION_TOKEN_INVALID", "The conversation session is not valid.");
        }

        const headerResult = jwtHeaderSchema.safeParse(decodeJsonSegment(headerSegment));
        const claimsResult = conversationTokenClaimsSchema.safeParse(
            decodeJsonSegment(payloadSegment),
        );

        if (!headerResult.success || !claimsResult.success)
        {
            throw new ApiError(401, "CONVERSATION_TOKEN_INVALID", "The conversation session is not valid.");
        }

        const key = await importHmacKey(this.secret, "verify");
        const signature = new Uint8Array(decodeBase64Url(signatureSegment));
        const validSignature = await crypto.subtle.verify(
            "HMAC",
            key,
            signature,
            new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
        );
        const claims = claimsResult.data;

        if (
            !validSignature
            || claims.exp <= nowSeconds
            || claims.sub !== conversationId
            || !claims.scope.includes(requiredScope)
        )
        {
            throw new ApiError(401, "CONVERSATION_TOKEN_INVALID", "The conversation session is not valid.");
        }

        return claims;
    }
}
