import { healthResponseSchema } from "@smartservice/contracts";
import { UrlSafetyError } from "@smartservice/ingestion";
import { Hono } from "hono";

import { ApiError } from "./errors";
import { createAnalyticsRouter } from "./analytics-routes";
import { createKnowledgeRouter } from "./knowledge-routes";
import { createPublicConversationRouter } from "./public-conversation-routes";
import { createRuntimeServices } from "./services";
import { createTeamRouter } from "./team-routes";
import type {
    AppEnvironment,
    RuntimeServiceFactory,
} from "./types";

/**
 * createApp
 * ----------------
 * Creates the Hono Worker application with tracing, safe errors, public chat, knowledge, team, dashboard, and gap routes.
 *
 * July 26, 2026: Updated by Forrest Zhang for SmartService Day 5 Dashboard and Knowledge Gaps
 */
export function createApp(
    serviceFactory: RuntimeServiceFactory = createRuntimeServices,
): Hono<AppEnvironment>
{
    const app = new Hono<AppEnvironment>();

    app.use("*", async (context, next) =>
    {
        const requestId = context.req.header("x-request-id") ?? crypto.randomUUID();
        const startedAt = Date.now();
        context.set("requestId", requestId);
        context.header("x-request-id", requestId);

        console.log(JSON.stringify({
            event: "http.request.started",
            method: context.req.method,
            path: context.req.path,
            requestId,
        }));

        await next();

        console.log(JSON.stringify({
            durationMs: Date.now() - startedAt,
            event: "http.request.completed",
            method: context.req.method,
            path: context.req.path,
            requestId,
            status: context.res.status,
        }));
    });

    app.get("/health", (context) =>
    {
        const response = healthResponseSchema.parse({
            environment: context.env.ENVIRONMENT,
            requestId: context.get("requestId"),
            service: "smartservice-api",
            status: "ok",
            timestamp: new Date().toISOString(),
            version: context.env.VERSION,
        });

        return context.json(response);
    });

    app.get("/api/health", (context) =>
    {
        const response = healthResponseSchema.parse({
            environment: context.env.ENVIRONMENT,
            requestId: context.get("requestId"),
            service: "smartservice-api",
            status: "ok",
            timestamp: new Date().toISOString(),
            version: context.env.VERSION,
        });

        return context.json(response);
    });

    const analyticsRouter = createAnalyticsRouter(serviceFactory);
    const knowledgeRouter = createKnowledgeRouter(serviceFactory);
    const publicConversationRouter = createPublicConversationRouter(serviceFactory);
    const teamRouter = createTeamRouter(serviceFactory);
    app.route("/api", analyticsRouter);
    app.route("/", analyticsRouter);
    app.route("/api", knowledgeRouter);
    app.route("/", knowledgeRouter);
    app.route("/api", publicConversationRouter);
    app.route("/", publicConversationRouter);
    app.route("/api", teamRouter);
    app.route("/", teamRouter);

    app.notFound((context) =>
    {
        return context.json({
            error: {
                code: "NOT_FOUND",
                message: "The requested API route does not exist.",
                requestId: context.get("requestId"),
            },
        }, 404);
    });

    app.onError((error, context) =>
    {
        const requestId = context.get("requestId");

        console.error(JSON.stringify({
            errorCode: error instanceof ApiError ? error.code : "INTERNAL_ERROR",
            errorName: error.name,
            event: "http.request.failed",
            path: context.req.path,
            requestId,
        }));

        if (error instanceof ApiError)
        {
            return context.json({
                error: {
                    code: error.code,
                    details: error.details,
                    message: error.message,
                    requestId,
                },
            }, error.status);
        }

        if (error instanceof UrlSafetyError)
        {
            return context.json({
                error: {
                    code: error.code,
                    message: error.message,
                    requestId,
                },
            }, 422);
        }

        return context.json({
            error: {
                code: "INTERNAL_ERROR",
                message: "The request could not be completed.",
                requestId,
            },
        }, 500);
    });

    return app;
}
