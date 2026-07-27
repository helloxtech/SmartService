import {
    createPublicConversationResponseSchema,
    publicMessageListResponseSchema,
    requestPublicHandoffResponseSchema,
    sendPublicMessageResponseSchema,
    type ConversationLanguage,
    type CreatePublicConversationResponse,
    type PublicMessageListResponse,
    type RequestPublicHandoffResponse,
    type SendPublicMessageResponse,
} from "@smartservice/contracts";
import { z } from "zod";

const apiErrorSchema = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
    }),
});

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
 * readApiFailure
 * ----------------
 * Converts a bounded server error envelope into customer-safe text without reflecting raw response data.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Chat
 */
async function readApiFailure(response: Response): Promise<Error>
{
    try
    {
        const parsed = apiErrorSchema.safeParse(await response.json());

        if (parsed.success)
        {
            return new Error(parsed.data.error.message);
        }
    }
    catch
    {
        // The stable fallback below intentionally hides invalid or non-JSON upstream bodies.
    }

    return new Error("The customer service request could not be completed.");
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
): Promise<CreatePublicConversationResponse>
{
    const response = await fetch(getApiUrl("/api/v1/public/conversations"), {
        body: JSON.stringify({
            channel: "text",
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

    return sendPublicMessageResponseSchema.parse(await response.json());
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
        response: publicMessageListResponseSchema.parse(await response.json()),
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
