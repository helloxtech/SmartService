import {
    dashboardSummarySchema,
    knowledgeGapActionSchema,
    knowledgeGapListResponseSchema,
    knowledgeGapRetestResponseSchema,
    knowledgeGapSchema,
    knowledgeGapStatusSchema,
    resolveKnowledgeGapRequestSchema,
    resolveKnowledgeGapResponseSchema,
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
const dateTimeSchema = z.iso.datetime({ offset: true });

/**
 * getServices
 * ----------------
 * Creates request-scoped dashboard and knowledge-gap adapters from the current Worker bindings.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard and Knowledge Gaps
 */
function getServices(
    factory: RuntimeServiceFactory,
    bindings: AppEnvironment["Bindings"],
): RuntimeServices
{
    return factory(bindings);
}

/**
 * parseGapId
 * ----------------
 * Validates an untrusted knowledge-gap path identifier before tenant-scoped access.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Security
 */
function parseGapId(input: string): string
{
    const parsed = identifierSchema.safeParse(input);

    if (!parsed.success)
    {
        throw new ApiError(400, "KNOWLEDGE_GAP_ID_INVALID", "The knowledge-gap ID is invalid.");
    }

    return parsed.data;
}

/**
 * parseDateRange
 * ----------------
 * Parses a complete explicit UTC range or supplies the bounded trailing 30-day dashboard default.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard
 */
function parseDateRange(
    fromInput: string | undefined,
    toInput: string | undefined,
): { from: string; to: string }
{
    if ((fromInput === undefined) !== (toInput === undefined))
    {
        throw new ApiError(400, "DATE_RANGE_INCOMPLETE", "Provide both from and to dashboard dates.");
    }

    if (fromInput === undefined || toInput === undefined)
    {
        const to = new Date();
        const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
        return {
            from: from.toISOString(),
            to: to.toISOString(),
        };
    }

    const from = dateTimeSchema.safeParse(fromInput);
    const to = dateTimeSchema.safeParse(toInput);

    if (!from.success || !to.success)
    {
        throw new ApiError(400, "DATE_RANGE_INVALID", "Dashboard dates must be ISO date-times with offsets.");
    }

    const duration = Date.parse(to.data) - Date.parse(from.data);

    if (duration <= 0 || duration > 366 * 24 * 60 * 60 * 1000)
    {
        throw new ApiError(400, "DATE_RANGE_INVALID", "Dashboard range must be positive and no longer than 366 days.");
    }

    return {
        from: from.data,
        to: to.data,
    };
}

/**
 * createAnalyticsRouter
 * ----------------
 * Creates Admin-only dashboard, grouped gap, one-click manual knowledge, state-action, and re-test endpoints.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard and Knowledge Gaps
 */
export function createAnalyticsRouter(
    serviceFactory: RuntimeServiceFactory,
): Hono<AppEnvironment>
{
    const router = new Hono<AppEnvironment>();

    router.get("/v1/admin/dashboard/summary", async (context) =>
    {
        const services = getServices(serviceFactory, context.env);
        const identity = await services.authenticateAdmin(context.req.raw);
        const range = parseDateRange(
            context.req.query("from"),
            context.req.query("to"),
        );
        const summary = await services.analytics.getDashboard(
            identity.organizationId,
            range.from,
            range.to,
        );

        return context.json(dashboardSummarySchema.parse(summary));
    });

    router.get("/v1/admin/knowledge-gaps", async (context) =>
    {
        const services = getServices(serviceFactory, context.env);
        const identity = await services.authenticateAdmin(context.req.raw);
        const statusInput = context.req.query("status");
        const status = statusInput === undefined
            ? undefined
            : knowledgeGapStatusSchema.safeParse(statusInput);

        if (status !== undefined && !status.success)
        {
            throw new ApiError(400, "KNOWLEDGE_GAP_STATUS_INVALID", "The knowledge-gap status is invalid.");
        }

        const gaps = await services.analytics.listKnowledgeGaps(
            identity.organizationId,
            status?.data,
        );

        return context.json(knowledgeGapListResponseSchema.parse({ gaps }));
    });

    router.get("/v1/admin/knowledge-gaps/:gapId", async (context) =>
    {
        const services = getServices(serviceFactory, context.env);
        const identity = await services.authenticateAdmin(context.req.raw);
        const gap = await services.analytics.getKnowledgeGap(
            identity.organizationId,
            parseGapId(context.req.param("gapId")),
        );

        if (gap === null)
        {
            throw new ApiError(404, "KNOWLEDGE_GAP_NOT_FOUND", "The knowledge gap does not exist.");
        }

        return context.json(knowledgeGapSchema.parse(gap));
    });

    router.post("/v1/admin/knowledge-gaps/:gapId/resolve", async (context) =>
    {
        const idempotencyKey = requireIdempotencyKey(context.req.raw);
        const input = await parseJsonBody(
            context.req.raw,
            resolveKnowledgeGapRequestSchema,
        );
        const services = getServices(serviceFactory, context.env);
        const identity = await services.authenticateAdmin(context.req.raw);
        const response = await services.analytics.resolveKnowledgeGap(
            identity,
            parseGapId(context.req.param("gapId")),
            input,
            idempotencyKey,
            context.get("requestId"),
        );

        return context.json(resolveKnowledgeGapResponseSchema.parse(response), 202);
    });

    router.post("/v1/admin/knowledge-gaps/:gapId/actions/:action", async (context) =>
    {
        requireIdempotencyKey(context.req.raw);
        const action = knowledgeGapActionSchema.safeParse(
            context.req.param("action"),
        );

        if (!action.success)
        {
            throw new ApiError(400, "KNOWLEDGE_GAP_ACTION_INVALID", "The knowledge-gap action is invalid.");
        }

        const services = getServices(serviceFactory, context.env);
        const identity = await services.authenticateAdmin(context.req.raw);
        const gap = await services.analytics.manageKnowledgeGap(
            identity,
            parseGapId(context.req.param("gapId")),
            action.data,
            context.get("requestId"),
        );

        return context.json(knowledgeGapSchema.parse(gap));
    });

    router.post("/v1/admin/knowledge-gaps/:gapId/retest", async (context) =>
    {
        requireIdempotencyKey(context.req.raw);
        const services = getServices(serviceFactory, context.env);
        const identity = await services.authenticateAdmin(context.req.raw);
        const response = await services.analytics.retestKnowledgeGap(
            identity,
            parseGapId(context.req.param("gapId")),
            context.get("requestId"),
        );

        return context.json(knowledgeGapRetestResponseSchema.parse(response));
    });

    return router;
}
