import {
    claimConversationResponseSchema,
    closeConversationResponseSchema,
    createGuardrailRuleRequestSchema,
    guardrailCandidateResponseSchema,
    guardrailEventListResponseSchema,
    guardrailRuleListResponseSchema,
    guardrailRuleSchema,
    sendHumanMessageRequestSchema,
    sendHumanMessageResponseSchema,
    teamConversationDetailSchema,
    teamConversationListResponseSchema,
    updateGuardrailRuleRequestSchema,
    type ConversationFinalizeMessage,
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

const identifierSchema = z.uuid();
const booleanQuerySchema = z.enum(["true", "false"]);

/**
 * getServices
 * ----------------
 * Creates request-scoped team and guardrail adapters from the current Worker bindings.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Workspace
 */
function getServices(
    factory: RuntimeServiceFactory,
    bindings: AppEnvironment["Bindings"],
): RuntimeServices
{
    return factory(bindings);
}

/**
 * parseIdentifier
 * ----------------
 * Validates an untrusted conversation, event, or rule path identifier before tenant-scoped access.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Workspace
 */
function parseIdentifier(input: string, label: string): string
{
    const parsed = identifierSchema.safeParse(input);

    if (!parsed.success)
    {
        throw new ApiError(400, "IDENTIFIER_INVALID", `The ${label} ID is not valid.`);
    }

    return parsed.data;
}

/**
 * parseBooleanQuery
 * ----------------
 * Parses an optional strict true/false query flag without JavaScript truthiness ambiguity.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Inbox
 */
function parseBooleanQuery(input: string | undefined): boolean
{
    if (input === undefined)
    {
        return false;
    }

    const parsed = booleanQuerySchema.safeParse(input);

    if (!parsed.success)
    {
        throw new ApiError(400, "QUERY_INVALID", "The includeClosed query must be true or false.");
    }

    return parsed.data === "true";
}

/**
 * enqueueFinalization
 * ----------------
 * Publishes one ID-only finalization command and marks the closed conversation only after Queue accepts it.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Conversation Finalization
 */
async function enqueueFinalization(
    services: RuntimeServices,
    message: ConversationFinalizeMessage,
): Promise<void>
{
    try
    {
        await services.finalizeQueue.send(message, {
            contentType: "json",
        });
        await services.team.markFinalizationQueued(
            message.organizationId,
            message.conversationId,
        );
    }
    catch
    {
        throw new ApiError(
            503,
            "FINALIZATION_QUEUE_FAILED",
            "The conversation was closed, but finalization could not be queued. Retry the close request.",
        );
    }
}

/**
 * createTeamRouter
 * ----------------
 * Creates authenticated team inbox, takeover, human messaging, closure, guardrail administration, and audit routes.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Workspace
 */
export function createTeamRouter(
    serviceFactory: RuntimeServiceFactory,
): Hono<AppEnvironment>
{
    const router = new Hono<AppEnvironment>();

    router.get("/v1/admin/conversations", async (context) =>
    {
        const services = getServices(serviceFactory, context.env);
        const identity = await services.authenticateMember(context.req.raw);
        const conversations = await services.team.listConversations(
            identity.organizationId,
            parseBooleanQuery(context.req.query("includeClosed")),
        );

        return context.json(teamConversationListResponseSchema.parse({
            conversations,
        }));
    });

    router.get("/v1/admin/conversations/:conversationId", async (context) =>
    {
        const services = getServices(serviceFactory, context.env);
        const identity = await services.authenticateMember(context.req.raw);
        const conversationId = parseIdentifier(
            context.req.param("conversationId"),
            "conversation",
        );
        const conversation = await services.team.getConversation(
            identity.organizationId,
            conversationId,
        );

        if (conversation === null)
        {
            throw new ApiError(404, "CONVERSATION_NOT_FOUND", "The conversation was not found.");
        }

        return context.json(teamConversationDetailSchema.parse(conversation));
    });

    router.post("/v1/admin/conversations/:conversationId/takeover", async (context) =>
    {
        requireIdempotencyKey(context.req.raw);
        const services = getServices(serviceFactory, context.env);
        const identity = await services.authenticateMember(context.req.raw);
        const response = await services.team.claim(
            identity,
            parseIdentifier(context.req.param("conversationId"), "conversation"),
            context.get("requestId"),
        );

        return context.json(claimConversationResponseSchema.parse(response));
    });

    router.post("/v1/admin/conversations/:conversationId/messages", async (context) =>
    {
        requireIdempotencyKey(context.req.raw);
        const input = await parseJsonBody(
            context.req.raw,
            sendHumanMessageRequestSchema,
        );
        const services = getServices(serviceFactory, context.env);
        const identity = await services.authenticateMember(context.req.raw);
        const response = await services.team.sendHumanMessage(
            identity,
            parseIdentifier(context.req.param("conversationId"), "conversation"),
            input.clientMessageId,
            input.text,
            context.get("requestId"),
        );

        return context.json(sendHumanMessageResponseSchema.parse(response));
    });

    router.post("/v1/admin/conversations/:conversationId/close", async (context) =>
    {
        requireIdempotencyKey(context.req.raw);
        const services = getServices(serviceFactory, context.env);
        const identity = await services.authenticateMember(context.req.raw);
        const conversationId = parseIdentifier(
            context.req.param("conversationId"),
            "conversation",
        );
        await services.team.close(
            identity,
            conversationId,
            context.get("requestId"),
        );
        await enqueueFinalization(services, {
            conversationId,
            includeTicketClassification: false,
            organizationId: identity.organizationId,
            type: "conversation.finalize",
            version: 1,
        });

        return context.json(closeConversationResponseSchema.parse({
            conversationId,
            finalizationQueued: true,
            status: "closed",
        }), 202);
    });

    router.get("/v1/admin/guardrails/rules", async (context) =>
    {
        const services = getServices(serviceFactory, context.env);
        const identity = await services.authenticateAdmin(context.req.raw);
        const rules = await services.team.listRules(identity.organizationId);

        return context.json(guardrailRuleListResponseSchema.parse({
            rules,
        }));
    });

    router.post("/v1/admin/guardrails/rules", async (context) =>
    {
        requireIdempotencyKey(context.req.raw);
        const input = await parseJsonBody(
            context.req.raw,
            createGuardrailRuleRequestSchema,
        );
        const services = getServices(serviceFactory, context.env);
        const identity = await services.authenticateAdmin(context.req.raw);
        const rule = await services.team.manageRule(
            identity,
            null,
            input,
            context.get("requestId"),
        );

        return context.json(guardrailRuleSchema.parse(rule), 201);
    });

    router.patch("/v1/admin/guardrails/rules/:ruleId", async (context) =>
    {
        requireIdempotencyKey(context.req.raw);
        const input = await parseJsonBody(
            context.req.raw,
            updateGuardrailRuleRequestSchema,
        );
        const services = getServices(serviceFactory, context.env);
        const identity = await services.authenticateAdmin(context.req.raw);
        const rule = await services.team.manageRule(
            identity,
            parseIdentifier(context.req.param("ruleId"), "guardrail rule"),
            input,
            context.get("requestId"),
        );

        return context.json(guardrailRuleSchema.parse(rule));
    });

    router.get("/v1/admin/guardrails/events", async (context) =>
    {
        const services = getServices(serviceFactory, context.env);
        const identity = await services.authenticateAdmin(context.req.raw);
        const conversationId = context.req.query("conversationId");
        const events = await services.team.listGuardrailEvents(
            identity.organizationId,
            conversationId === undefined
                ? undefined
                : parseIdentifier(conversationId, "conversation"),
        );

        return context.json(guardrailEventListResponseSchema.parse({
            events,
        }));
    });

    router.get("/v1/admin/guardrails/events/:eventId/candidate", async (context) =>
    {
        const services = getServices(serviceFactory, context.env);
        const identity = await services.authenticateAdmin(context.req.raw);
        const response = await services.team.getGuardrailCandidate(
            identity,
            parseIdentifier(context.req.param("eventId"), "guardrail event"),
        );

        return context.json(guardrailCandidateResponseSchema.parse(response));
    });

    return router;
}
