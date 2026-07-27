import {
    createPublicConversationRequestSchema,
    createPublicConversationResponseSchema,
    publicMessageListResponseSchema,
    requestPublicHandoffResponseSchema,
    sendPublicMessageRequestSchema,
    sendPublicMessageResponseSchema,
} from "@smartservice/contracts";
import { Hono } from "hono";
import { z } from "zod";

import {
    ApiError,
    parseJsonBody,
    requireIdempotencyKey,
} from "./errors";
import type {
    AppEnvironment,
    RuntimeServiceFactory,
    RuntimeServices,
} from "./types";

const conversationIdSchema = z.uuid();
const messageLimitSchema = z.coerce.number().int().min(1).max(100).default(50);

/**
 * getServices
 * ----------------
 * Creates request-scoped public-conversation adapters from the current Worker bindings.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversations
 */
function getServices(
    factory: RuntimeServiceFactory,
    bindings: AppEnvironment["Bindings"],
): RuntimeServices
{
    return factory(bindings);
}

/**
 * parseConversationId
 * ----------------
 * Validates a path conversation ID before token verification or tenant-scoped lookup.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
 */
function parseConversationId(input: string): string
{
    const result = conversationIdSchema.safeParse(input);

    if (!result.success)
    {
        throw new ApiError(400, "CONVERSATION_ID_INVALID", "The conversation ID is not valid.");
    }

    return result.data;
}

/**
 * parseMessageLimit
 * ----------------
 * Parses a bounded polling page size with the contract default.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Message Polling
 */
function parseMessageLimit(input: string | undefined): number
{
    const result = messageLimitSchema.safeParse(input ?? 50);

    if (!result.success)
    {
        throw new ApiError(400, "MESSAGE_LIMIT_INVALID", "The message limit must be between 1 and 100.");
    }

    return result.data;
}

/**
 * readRemoteIp
 * ----------------
 * Reads Cloudflare's trusted connecting-IP header for private hashed rate-limit bucketing.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversation Security
 */
function readRemoteIp(request: Request): string | null
{
    const value = request.headers.get("cf-connecting-ip")?.trim();
    return value === undefined || value.length === 0 || value.length > 64
        ? null
        : value;
}

/**
 * buildPollingEtag
 * ----------------
 * Builds a weak response validator from the opaque cursor and conversation status without message content.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Message Polling
 */
function buildPollingEtag(nextCursor: string | null, status: string): string
{
    return `W/"${nextCursor ?? "initial"}-${status}"`;
}

/**
 * createPublicConversationRouter
 * ----------------
 * Creates validated public text-conversation, grounded-message, polling, and handoff endpoints.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversations
 */
export function createPublicConversationRouter(
    serviceFactory: RuntimeServiceFactory,
): Hono<AppEnvironment>
{
    const router = new Hono<AppEnvironment>();

    router.post("/v1/public/conversations", async (context) =>
    {
        const input = await parseJsonBody(
            context.req.raw,
            createPublicConversationRequestSchema,
        );
        const services = getServices(serviceFactory, context.env);
        const response = await services.publicConversations.create(
            input,
            requireIdempotencyKey(context.req.raw),
            readRemoteIp(context.req.raw),
            context.get("requestId"),
        );

        return context.json(createPublicConversationResponseSchema.parse(response), 201);
    });

    router.post("/v1/public/conversations/:conversationId/messages", async (context) =>
    {
        const conversationId = parseConversationId(context.req.param("conversationId"));
        const input = await parseJsonBody(
            context.req.raw,
            sendPublicMessageRequestSchema,
        );
        const services = getServices(serviceFactory, context.env);
        const response = await services.publicConversations.send(
            context.req.raw,
            conversationId,
            input,
            context.get("requestId"),
            readRemoteIp(context.req.raw),
        );

        return context.json(sendPublicMessageResponseSchema.parse(response));
    });

    router.get("/v1/public/conversations/:conversationId/messages", async (context) =>
    {
        const conversationId = parseConversationId(context.req.param("conversationId"));
        const services = getServices(serviceFactory, context.env);
        const response = publicMessageListResponseSchema.parse(
            await services.publicConversations.list(
                context.req.raw,
                conversationId,
                context.req.query("after") ?? null,
                parseMessageLimit(context.req.query("limit")),
            ),
        );
        const etag = buildPollingEtag(response.nextCursor, response.status);
        context.header("cache-control", "private, no-store");
        context.header("etag", etag);

        if (context.req.header("if-none-match") === etag)
        {
            return context.body(null, 304);
        }

        return context.json(response);
    });

    router.post("/v1/public/conversations/:conversationId/request-handoff", async (context) =>
    {
        const conversationId = parseConversationId(context.req.param("conversationId"));
        const services = getServices(serviceFactory, context.env);
        const response = await services.publicConversations.requestHandoff(
            context.req.raw,
            conversationId,
            requireIdempotencyKey(context.req.raw),
            context.get("requestId"),
            readRemoteIp(context.req.raw),
        );

        return context.json(requestPublicHandoffResponseSchema.parse(response), 202);
    });

    return router;
}
