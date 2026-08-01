import { Hono } from "hono";
import { z } from "zod";

import { authenticateMember } from "./auth";
import { ApiError } from "./errors";
import type {
    AppEnvironment,
    MemberIdentity,
    SmartServiceBindings,
} from "./types";

const feedbackIdentitySessionSchema = z.object({
    expiresAt: z.iso.datetime(),
    token: z.string().regex(/^hxf_session_[0-9a-f]{64}$/),
});

interface FeedbackIdentitySession
{
    expiresAt: string;
    token: string;
}

export interface HelloXFeedbackDependencies
{
    authenticate(
        request: Request,
        bindings: SmartServiceBindings,
    ): Promise<MemberIdentity>;
    exchange(
        identity: MemberIdentity,
        bindings: SmartServiceBindings,
    ): Promise<FeedbackIdentitySession>;
}

/**
 * assertSameOriginRequest
 * ----------------
 * Rejects identity-session requests unless the browser Origin exactly matches the SmartService request origin.
 *
 * August 01, 2026: Created by Forrest Zhang for HelloX Feedback
 */
function assertSameOriginRequest(request: Request): void
{
    const requestOrigin = request.headers.get("origin");
    const expectedOrigin = new URL(request.url).origin;

    if (requestOrigin === null || requestOrigin !== expectedOrigin)
    {
        throw new ApiError(403, "FEEDBACK_ORIGIN_REJECTED", "The feedback identity request was rejected.");
    }
}

/**
 * requireUser
 * ----------------
 * Verifies the caller's Supabase session and active SmartService membership through the existing authoritative host boundary.
 *
 * August 01, 2026: Created by Forrest Zhang for HelloX Feedback
 */
async function requireUser(
    request: Request,
    bindings: SmartServiceBindings,
): Promise<MemberIdentity>
{
    return authenticateMember(request, bindings);
}

/**
 * exchangeFeedbackIdentity
 * ----------------
 * Exchanges one verified SmartService user ID for a five-minute, single-use HelloX identity token without exposing the server key.
 *
 * August 01, 2026: Created by Forrest Zhang for HelloX Feedback
 */
async function exchangeFeedbackIdentity(
    identity: MemberIdentity,
    bindings: SmartServiceBindings,
): Promise<FeedbackIdentitySession>
{
    const serverKey = bindings.HELLOX_FEEDBACK_SERVER_KEY?.trim()
        ?? process.env.HELLOX_FEEDBACK_SERVER_KEY?.trim();

    if (serverKey === undefined || !/^hxf_server_[0-9a-f]{64}$/.test(serverKey))
    {
        throw new ApiError(503, "FEEDBACK_CONFIGURATION_MISSING", "Verified feedback identity is unavailable.");
    }

    let response: Response;

    try
    {
        response = await fetch("https://delivery.hellox.ca/api/feedback/v1/sessions", {
            body: JSON.stringify({
                issuer: "smartservice-supabase",
                origin: "https://smartservice.ca",
                subject: identity.userId,
            }),
            headers: {
                "content-type": "application/json",
                "x-hellox-feedback-server-key": serverKey,
            },
            method: "POST",
            signal: AbortSignal.timeout(10_000),
        });
    }
    catch
    {
        throw new ApiError(503, "FEEDBACK_IDENTITY_UNAVAILABLE", "Verified feedback identity is temporarily unavailable.");
    }

    if (!response.ok)
    {
        throw new ApiError(502, "FEEDBACK_IDENTITY_REJECTED", "Verified feedback identity could not be issued.");
    }

    let responseBody: unknown;

    try
    {
        responseBody = await response.json();
    }
    catch
    {
        throw new ApiError(502, "FEEDBACK_IDENTITY_INVALID", "Verified feedback identity returned an invalid response.");
    }

    const parsed = feedbackIdentitySessionSchema.safeParse(responseBody);

    if (!parsed.success)
    {
        throw new ApiError(502, "FEEDBACK_IDENTITY_INVALID", "Verified feedback identity returned an invalid response.");
    }

    return parsed.data;
}

const defaultHelloXFeedbackDependencies: HelloXFeedbackDependencies = {
    authenticate: requireUser,
    exchange: exchangeFeedbackIdentity,
};

/**
 * createHelloXFeedbackRouter
 * ----------------
 * Creates the same-origin SmartService endpoint that returns only short-lived HelloX identity tokens to authenticated browsers.
 *
 * August 01, 2026: Created by Forrest Zhang for HelloX Feedback
 */
export function createHelloXFeedbackRouter(
    dependencies: HelloXFeedbackDependencies = defaultHelloXFeedbackDependencies,
): Hono<AppEnvironment>
{
    const router = new Hono<AppEnvironment>();

    router.post("/hellox-feedback/session", async (context) =>
    {
        assertSameOriginRequest(context.req.raw);
        const identity = await dependencies.authenticate(context.req.raw, context.env);
        const session = await dependencies.exchange(identity, context.env);

        context.header("cache-control", "no-store");

        return context.json({
            expiresAt: session.expiresAt,
            token: session.token,
        }, 201);
    });

    return router;
}
