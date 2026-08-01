import { healthResponseSchema } from "@smartservice/contracts";
import { UrlSafetyError } from "@smartservice/ingestion";
import { Hono } from "hono";

import { ApiError } from "./errors";
import { createAnalyticsRouter } from "./analytics-routes";
import {
    createHelloXFeedbackRouter,
    type HelloXFeedbackDependencies,
} from "./hellox-feedback-routes";
import { createKnowledgeRouter } from "./knowledge-routes";
import { createPublicConversationRouter } from "./public-conversation-routes";
import { createRuntimeServices } from "./services";
import { createTeamRouter } from "./team-routes";
import { createVoiceRouter } from "./voice-routes";
import type {
    AppEnvironment,
    RuntimeServiceFactory,
} from "./types";

/**
 * createPublicConfigurationResponse
 * ----------------
 * Returns only browser-safe runtime configuration so Cloudflare Git builds do not depend on local Vite environment files.
 *
 * July 29, 2026: Created by Forrest Zhang for SmartService hosted DEV Supabase sign-in
 */
function createPublicConfigurationResponse(env: AppEnvironment["Bindings"]): {
    feedbackInstallationKey: string | null;
    feedbackTurnstileSiteKey: string | null;
    supabaseAnonKey: string | null;
    supabaseUrl: string | null;
}
{
    const feedbackInstallationKey = env.HELLOX_FEEDBACK_INSTALLATION_KEY?.trim();
    const feedbackTurnstileSiteKey = env.HELLOX_FEEDBACK_TURNSTILE_SITE_KEY?.trim();
    const supabaseUrl = env.SUPABASE_URL?.trim();
    const supabaseAnonKey = env.SUPABASE_ANON_KEY?.trim();

    const safeFeedbackConfiguration = {
        feedbackInstallationKey:
            feedbackInstallationKey !== undefined
            && /^hxf_live_[0-9a-f]{48}$/.test(feedbackInstallationKey)
                ? feedbackInstallationKey
                : null,
        feedbackTurnstileSiteKey:
            feedbackTurnstileSiteKey !== undefined
            && feedbackTurnstileSiteKey.length >= 10
                ? feedbackTurnstileSiteKey
                : null,
    };

    if (supabaseUrl === undefined || supabaseUrl.length === 0 || supabaseAnonKey === undefined || supabaseAnonKey.length === 0)
    {
        return {
            ...safeFeedbackConfiguration,
            supabaseAnonKey: null,
            supabaseUrl: null,
        };
    }

    return {
        ...safeFeedbackConfiguration,
        supabaseAnonKey,
        supabaseUrl,
    };
}

/**
 * createContentSecurityPolicy
 * ----------------
 * Builds a narrow browser policy that permits the exact HelloX and Turnstile origins plus configured SmartService data providers.
 *
 * August 01, 2026: Created by Forrest Zhang for HelloX Feedback
 */
function createContentSecurityPolicy(env: AppEnvironment["Bindings"]): string
{
    const connectSources = new Set([
        "'self'",
        "https://challenges.cloudflare.com",
        "https://delivery.hellox.ca",
    ]);

    for (const configuredUrl of [env.LIVEKIT_URL, env.R2_S3_ENDPOINT, env.SUPABASE_URL])
    {
        if (configuredUrl === undefined || configuredUrl.trim().length === 0)
        {
            continue;
        }

        try
        {
            const origin = new URL(configuredUrl).origin;
            connectSources.add(origin);

            if (origin.startsWith("https://"))
            {
                connectSources.add(`wss://${new URL(origin).host}`);
            }
        }
        catch
        {
            continue;
        }
    }

    return [
        `connect-src ${[...connectSources].join(" ")}`,
        "frame-src https://challenges.cloudflare.com",
        "script-src 'self' https://challenges.cloudflare.com",
    ].join("; ");
}

/**
 * createApp
 * ----------------
 * Creates the Hono Worker application with tracing, safe errors, public chat, knowledge, team, dashboard, and gap routes.
 *
 * July 26, 2026: Updated by Forrest Zhang for SmartService Day 5 Dashboard and Knowledge Gaps
 */
export function createApp(
    serviceFactory: RuntimeServiceFactory = createRuntimeServices,
    helloXFeedbackDependencies?: HelloXFeedbackDependencies,
): Hono<AppEnvironment>
{
    const app = new Hono<AppEnvironment>();

    app.use("*", async (context, next) =>
    {
        const requestId = context.req.header("x-request-id") ?? crypto.randomUUID();
        const startedAt = Date.now();
        context.set("requestId", requestId);
        context.header("x-request-id", requestId);
        context.header("content-security-policy", createContentSecurityPolicy(context.env));

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

    app.get("/api/public-config", (context) =>
    {
        context.header("cache-control", "no-store");

        return context.json(createPublicConfigurationResponse(context.env));
    });

    const analyticsRouter = createAnalyticsRouter(serviceFactory);
    const helloXFeedbackRouter = createHelloXFeedbackRouter(helloXFeedbackDependencies);
    const knowledgeRouter = createKnowledgeRouter(serviceFactory);
    const publicConversationRouter = createPublicConversationRouter(serviceFactory);
    const teamRouter = createTeamRouter(serviceFactory);
    const voiceRouter = createVoiceRouter(serviceFactory);
    app.route("/api", analyticsRouter);
    app.route("/", analyticsRouter);
    app.route("/api", helloXFeedbackRouter);
    app.route("/api", knowledgeRouter);
    app.route("/", knowledgeRouter);
    app.route("/api", publicConversationRouter);
    app.route("/", publicConversationRouter);
    app.route("/api", teamRouter);
    app.route("/", teamRouter);
    app.route("/api", voiceRouter);
    app.route("/", voiceRouter);

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
