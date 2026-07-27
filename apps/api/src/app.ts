import { healthResponseSchema } from "@smartservice/contracts";
import { Hono } from "hono";

interface AppVariables
{
    requestId: string;
}

type AppEnvironment = {
    Bindings: Env;
    Variables: AppVariables;
};

/**
 * createApp
 * ----------------
 * Creates the Hono Worker application with request tracing, safe structured errors, and the public health contract.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
export function createApp(): Hono<AppEnvironment>
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
            errorName: error.name,
            event: "http.request.failed",
            message: error.message,
            path: context.req.path,
            requestId,
        }));

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
