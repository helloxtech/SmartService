import {
    createPublicConversationResponseSchema,
    publicMessageListResponseSchema,
    requestPublicHandoffResponseSchema,
    sendPublicMessageResponseSchema,
    type ConversationLanguage,
    type CreateVoiceTokenResponse,
    type CreatePublicConversationResponse,
    type PublicMessageListResponse,
    type RequestPublicHandoffResponse,
    type SendPublicMessageResponse,
    createVoiceTokenResponseSchema,
} from "@smartservice/contracts";
import { z } from "zod";

const apiErrorSchema = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
    }),
});

const defaultDemoPublicKey = "xflow-public-demo";
const legacyDemoPublicKey = "novaflow-public-demo";

type PublicApiFailure = Error & {
    code: string;
};

export interface PollResult
{
    etag: string | null;
    response: PublicMessageListResponse | null;
}

/**
 * getApiUrl
 * ----------------
 * Resolves a same-origin public API path unless an explicit development API base URL is configured.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Chat
 */
function getApiUrl(path: string): string
{
    const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/u, "") ?? "";
    return `${baseUrl}${path}`;
}

/**
 * createApiFailure
 * ----------------
 * Creates a typed public API error while preserving the server's stable error code for bounded recovery decisions.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService hosted XFlow compatibility
 */
function createApiFailure(code: string, message: string): PublicApiFailure
{
    return Object.assign(new Error(message), {
        code,
    });
}

/**
 * isWidgetNotFoundError
 * ----------------
 * Detects the one safe retry case for demo public-key migration without masking unrelated customer-service failures.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService hosted XFlow compatibility
 */
function isWidgetNotFoundError(error: unknown): boolean
{
    return error instanceof Error
        && "code" in error
        && error.code === "WIDGET_NOT_FOUND";
}

/**
 * normalizeHostedDemoBrand
 * ----------------
 * Replaces stale hosted demo branding in browser-visible session text while the hosted database is awaiting the XFlow seed refresh.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService hosted XFlow compatibility
 */
function normalizeHostedDemoBrand(value: string): string
{
    return value.replaceAll("NovaFlow", "XFlow");
}

/**
 * normalizeDemoConversationResponse
 * ----------------
 * Keeps the temporary legacy-key fallback from showing the old demo tenant name in public chat or voice headers.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService hosted XFlow compatibility
 */
function normalizeDemoConversationResponse(
    response: CreatePublicConversationResponse,
): CreatePublicConversationResponse
{
    return {
        ...response,
        displayName: normalizeHostedDemoBrand(response.displayName),
        welcomeMessage: normalizeHostedDemoBrand(response.welcomeMessage),
    };
}

/**
 * normalizeDemoCitations
 * ----------------
 * Normalizes browser-visible citation display fields during the temporary hosted demo key fallback.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService hosted XFlow compatibility
 */
function normalizeDemoCitations(
    citations: SendPublicMessageResponse["citations"],
): SendPublicMessageResponse["citations"]
{
    return citations.map((citation) =>
    {
        return {
            ...citation,
            label: normalizeHostedDemoBrand(citation.label),
            supportingExcerpt: normalizeHostedDemoBrand(citation.supportingExcerpt),
        };
    });
}

/**
 * normalizeDemoMessageResponse
 * ----------------
 * Normalizes browser-visible answer and citation fields that can still contain stale hosted demo branding.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService hosted XFlow compatibility
 */
function normalizeDemoMessageResponse(response: SendPublicMessageResponse): SendPublicMessageResponse
{
    return {
        ...response,
        answer: normalizeHostedDemoBrand(response.answer),
        citations: normalizeDemoCitations(response.citations),
    };
}

/**
 * normalizeDemoMessageListResponse
 * ----------------
 * Normalizes polled public messages so resumed sessions do not re-display stale hosted demo branding.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService hosted XFlow compatibility
 */
function normalizeDemoMessageListResponse(response: PublicMessageListResponse): PublicMessageListResponse
{
    return {
        ...response,
        messages: response.messages.map((message) =>
        {
            return {
                ...message,
                citations: normalizeDemoCitations(message.citations),
                text: normalizeHostedDemoBrand(message.text),
            };
        }),
    };
}

/**
 * readApiFailure
 * ----------------
 * Converts a bounded server error envelope into customer-safe text without reflecting raw response data.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Chat
 */
async function readApiFailure(response: Response): Promise<PublicApiFailure>
{
    try
    {
        const parsed = apiErrorSchema.safeParse(await response.json());

        if (parsed.success)
        {
            return createApiFailure(parsed.data.error.code, parsed.data.error.message);
        }
    }
    catch
    {
        // The stable fallback below intentionally hides invalid or non-JSON upstream bodies.
    }

    return createApiFailure("UNKNOWN", "The customer service request could not be completed.");
}

/**
 * getConfiguredDemoPublicKeys
 * ----------------
 * Returns the current XFlow demo public key plus a temporary legacy key fallback for hosted deployments whose Supabase seed has not been refreshed yet.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService hosted XFlow compatibility
 */
export function getConfiguredDemoPublicKeys(): readonly string[]
{
    const configuredPublicKey = import.meta.env.VITE_DEMO_PUBLIC_KEY ?? defaultDemoPublicKey;
    return Array.from(new Set([
        configuredPublicKey,
        defaultDemoPublicKey,
        legacyDemoPublicKey,
    ]));
}

/**
 * createPublicConversation
 * ----------------
 * Starts one idempotent public text conversation after the browser receives a Turnstile token.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Chat
 */
export async function createPublicConversation(
    publicKey: string,
    language: ConversationLanguage,
    turnstileToken: string,
    channel: "text" | "voice" = "text",
): Promise<CreatePublicConversationResponse>
{
    const response = await fetch(getApiUrl("/api/v1/public/conversations"), {
        body: JSON.stringify({
            channel,
            customer: {
                language,
            },
            publicKey,
            turnstileToken,
        }),
        headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
        },
        method: "POST",
    });

    if (!response.ok)
    {
        throw await readApiFailure(response);
    }

    return createPublicConversationResponseSchema.parse(await response.json());
}

/**
 * createPublicConversationWithFallback
 * ----------------
 * Starts a public conversation with the current XFlow key and retries only the legacy demo key when hosted Supabase still has the older tenant key.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService hosted XFlow compatibility
 */
export async function createPublicConversationWithFallback(
    publicKeys: readonly string[],
    language: ConversationLanguage,
    turnstileToken: string,
    channel: "text" | "voice" = "text",
): Promise<CreatePublicConversationResponse>
{
    let lastFailure: unknown;

    for (const publicKey of publicKeys)
    {
        try
        {
            const response = await createPublicConversation(
                publicKey,
                language,
                turnstileToken,
                channel,
            );

            return publicKey === legacyDemoPublicKey
                ? normalizeDemoConversationResponse(response)
                : response;
        }
        catch (error)
        {
            if (!isWidgetNotFoundError(error))
            {
                throw error;
            }

            lastFailure = error;
        }
    }

    if (lastFailure instanceof Error)
    {
        throw lastFailure;
    }

    throw createApiFailure("WIDGET_NOT_FOUND", "The customer service widget is not available.");
}

/**
 * createVoiceToken
 * ----------------
 * Exchanges one scoped voice-conversation token for a short-lived LiveKit room credential after an explicit customer click.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
export async function createVoiceToken(
    conversationId: string,
    conversationToken: string,
): Promise<CreateVoiceTokenResponse>
{
    const response = await fetch(getApiUrl("/api/v1/public/voice/token"), {
        body: JSON.stringify({
            conversationId,
        }),
        headers: {
            authorization: `Bearer ${conversationToken}`,
            "content-type": "application/json",
        },
        method: "POST",
    });

    if (!response.ok)
    {
        throw await readApiFailure(response);
    }

    return createVoiceTokenResponseSchema.parse(await response.json());
}

/**
 * sendPublicMessage
 * ----------------
 * Sends one retry-safe customer message using only the scoped conversation bearer token.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Chat
 */
export async function sendPublicMessage(
    conversationId: string,
    conversationToken: string,
    text: string,
    clientMessageId: string,
): Promise<SendPublicMessageResponse>
{
    const response = await fetch(
        getApiUrl(`/api/v1/public/conversations/${conversationId}/messages`),
        {
            body: JSON.stringify({
                clientMessageId,
                text,
            }),
            headers: {
                authorization: `Bearer ${conversationToken}`,
                "content-type": "application/json",
            },
            method: "POST",
        },
    );

    if (!response.ok)
    {
        throw await readApiFailure(response);
    }

    return normalizeDemoMessageResponse(sendPublicMessageResponseSchema.parse(await response.json()));
}

/**
 * pollPublicMessages
 * ----------------
 * Polls customer-visible messages with cursor and ETag support; a 304 returns no replacement payload.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Chat
 */
export async function pollPublicMessages(
    conversationId: string,
    conversationToken: string,
    cursor: string | null,
    etag: string | null,
): Promise<PollResult>
{
    const search = new URLSearchParams({
        limit: "50",
    });

    if (cursor !== null)
    {
        search.set("after", cursor);
    }

    const headers: Record<string, string> = {
        authorization: `Bearer ${conversationToken}`,
    };

    if (etag !== null)
    {
        headers["if-none-match"] = etag;
    }

    const response = await fetch(
        getApiUrl(`/api/v1/public/conversations/${conversationId}/messages?${search.toString()}`),
        {
            headers,
        },
    );

    if (response.status === 304)
    {
        return {
            etag,
            response: null,
        };
    }

    if (!response.ok)
    {
        throw await readApiFailure(response);
    }

    return {
        etag: response.headers.get("etag"),
        response: normalizeDemoMessageListResponse(publicMessageListResponseSchema.parse(await response.json())),
    };
}

/**
 * requestPublicHandoff
 * ----------------
 * Requests human ownership through an idempotent conversation-scoped Worker call.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Chat
 */
export async function requestPublicHandoff(
    conversationId: string,
    conversationToken: string,
): Promise<RequestPublicHandoffResponse>
{
    const response = await fetch(
        getApiUrl(`/api/v1/public/conversations/${conversationId}/request-handoff`),
        {
            headers: {
                authorization: `Bearer ${conversationToken}`,
                "idempotency-key": crypto.randomUUID(),
            },
            method: "POST",
        },
    );

    if (!response.ok)
    {
        throw await readApiFailure(response);
    }

    return requestPublicHandoffResponseSchema.parse(await response.json());
}
