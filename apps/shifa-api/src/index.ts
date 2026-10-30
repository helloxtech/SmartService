import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createClient } from "@supabase/supabase-js";
import { createShareSchema, reportSchema } from "@shifa/contracts";
import { z } from "zod";
import { digest, seal, token, unseal } from "./crypto";

export interface Bindings
{
    SHIFA_SUPABASE_URL: string;
    SHIFA_SUPABASE_SERVICE_KEY: string;
    SHIFA_ENCRYPTION_KEY: string;
    SHIFA_PUBLIC_ORIGIN: string;
    SHIFA_DEMO_ONLY?: string;
    ASSETS?: { fetch: (request: Request) => Promise<Response> };
}

export type Command = (operation: string, payload: Record<string, unknown>, bindings: Bindings) => Promise<unknown>;

/**
 * databaseCommand
 * ----------------
 * Calls the service-only atomic PostgreSQL boundary with a bounded timeout.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export async function databaseCommand(operation: string, payload: Record<string, unknown>, bindings: Bindings): Promise<unknown>
{
    const client = createClient(bindings.SHIFA_SUPABASE_URL, bindings.SHIFA_SUPABASE_SERVICE_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.rpc("shifa_command", { operation, payload }).abortSignal(AbortSignal.timeout(10000));
    if (error)
    {
        throw new Error("Storage unavailable");
    }
    return data as unknown;
}

/**
 * bearerHash
 * ----------------
 * Validates and hashes a capability without returning raw tokens to storage.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
async function bearerHash(header: string | undefined): Promise<string>
{
    const match = /^Bearer ([a-f0-9]{64})$/.exec(header ?? "");
    return match?.[1] ? digest(match[1]) : "invalid";
}

/**
 * createApp
 * ----------------
 * Builds isolated report-sharing routes; the injected command is used only by tests.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export function createApp(command: Command = databaseCommand)
{
    const app = new Hono<{ Bindings: Bindings }>();
    app.use("/api/*", async (context, next) =>
    {
        context.header("Cache-Control", "no-store, private, max-age=0");
        context.header("Pragma", "no-cache");
        context.header("Referrer-Policy", "no-referrer");
        context.header("X-Content-Type-Options", "nosniff");
        const origin = context.req.header("Origin");
        if (origin && origin !== context.env.SHIFA_PUBLIC_ORIGIN && origin !== new URL(context.req.url).origin)
        {
            return context.json({ error: "Request not allowed" }, 403);
        }
        if (context.env.SHIFA_DEMO_ONLY === "true")
        {
            return context.json({ error: "Demo only. Patient report sharing is not available yet." }, 503);
        }
        if (!context.env.SHIFA_SUPABASE_URL || !context.env.SHIFA_SUPABASE_SERVICE_KEY || !context.env.SHIFA_ENCRYPTION_KEY)
        {
            return context.json({ error: "Sharing is temporarily unavailable. Your records remain on your phone." }, 503);
        }
        await next();
    });
    app.use("/api/*", bodyLimit({ maxSize: 4_000_000, onError: (context) => context.json({ error: "Choose a smaller report" }, 413) }));
    app.onError((error, context) =>
    {
        if (error instanceof z.ZodError || error instanceof SyntaxError)
        {
            return context.json({ error: "Check the report or request and try again" }, 400);
        }
        // Never emit bodies, capabilities, health records, or provider errors to logs.
        return context.json({ error: "Sharing is temporarily unavailable" }, 503);
    });
    app.post("/api/shifa/shares", async (context) =>
    {
        const input = createShareSchema.parse(await context.req.json());
        const shareId = crypto.randomUUID();
        const ownerToken = token();
        const clientHash = await digest(`${context.env.SHIFA_ENCRYPTION_KEY}:${context.req.header("CF-Connecting-IP") ?? "local"}`);
        const result = z.object({ code: z.string().length(4), expiresAt: z.string() }).safeParse(await command("create", {
            shareId, ownerHash: await digest(ownerToken),
            ciphertext: await seal(input.report, context.env.SHIFA_ENCRYPTION_KEY, shareId),
            durationMinutes: input.durationMinutes, clientHash,
            codeStart: (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % 10000,
        }, context.env));
        if (!result.success)
        {
            return context.json({ error: "Sharing is busy. Please try again later." }, 429);
        }
        return context.json({ shareId, ownerToken, ...result.data }, 201);
    });
    app.get("/api/shifa/shares/:id/requests", async (context) =>
    {
        const shareId = z.uuid().parse(context.req.param("id"));
        const result = await command("owner", { shareId, ownerHash: await bearerHash(context.req.header("Authorization")) }, context.env);
        return context.json(result as Record<string, unknown>);
    });
    app.post("/api/shifa/shares/:id/requests/:requestId", async (context) =>
    {
        const shareId = z.uuid().parse(context.req.param("id"));
        const requestId = z.uuid().parse(context.req.param("requestId"));
        const { approve } = z.object({ approve: z.boolean() }).parse(await context.req.json());
        const result = await command("decide", { shareId, requestId, approve, ownerHash: await bearerHash(context.req.header("Authorization")) }, context.env);
        return context.json(result as Record<string, unknown>);
    });
    app.delete("/api/shifa/shares/:id", async (context) =>
    {
        const shareId = z.uuid().parse(context.req.param("id"));
        const result = await command("revoke", { shareId, ownerHash: await bearerHash(context.req.header("Authorization")) }, context.env);
        return context.json(result as Record<string, unknown>);
    });
    app.post("/api/shifa/requests", async (context) =>
    {
        const { code } = z.object({ code: z.string().regex(/^\d{4}$/).refine((value) => value !== "1234") }).parse(await context.req.json());
        const requestId = crypto.randomUUID();
        const requestToken = token();
        const words = ["Maple", "River", "Cedar", "Ocean", "Cloud", "Garden", "Sunrise", "Willow"];
        const random = crypto.getRandomValues(new Uint32Array(2));
        const phrase = `${words[(random[0] ?? 0) % words.length]} ${String((random[1] ?? 0) % 10000).padStart(4, "0")}`;
        const clientHash = await digest(`${context.env.SHIFA_ENCRYPTION_KEY}:${context.req.header("CF-Connecting-IP") ?? "local"}`);
        const result = z.object({ expiresAt: z.string() }).safeParse(await command("request", {
            code, requestId, requestHash: await digest(requestToken), phrase, clientHash,
        }, context.env));
        if (!result.success)
        {
            return context.json({ error: "Please wait before trying again" }, 429);
        }
        return context.json({ requestId, requestToken, phrase, expiresAt: result.data.expiresAt }, 201);
    });
    app.get("/api/shifa/requests/:id", async (context) =>
    {
        const requestId = z.uuid().parse(context.req.param("id"));
        const result = z.object({
            status: z.enum(["pending", "denied", "expired", "approved"]),
            expiresAt: z.string().optional(), ciphertext: z.string().optional(), shareId: z.string().optional(),
        }).parse(await command("read", { requestId, requestHash: await bearerHash(context.req.header("Authorization")) }, context.env));
        if (result.status !== "approved")
        {
            return context.json({ status: result.status, expiresAt: result.expiresAt });
        }
        if (!result.ciphertext || !result.shareId)
        {
            throw new Error("Invalid approved report");
        }
        const report = reportSchema.parse(await unseal(result.ciphertext, context.env.SHIFA_ENCRYPTION_KEY, result.shareId));
        return context.json({ status: "approved", expiresAt: result.expiresAt, report });
    });
    app.get("*", async (context) =>
    {
        if (!context.env.ASSETS)
        {
            return context.text("Shifa assets unavailable", 404);
        }
        const asset = await context.env.ASSETS.fetch(context.req.raw);
        const response = new Response(asset.body, asset);
        response.headers.set("Referrer-Policy", "no-referrer");
        response.headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
        return response;
    });
    return app;
}

const app = createApp();
export default {
    fetch: app.fetch,
    async scheduled(_event: unknown, env: Bindings): Promise<void>
    {
        if (env.SHIFA_DEMO_ONLY === "true") return;
        await databaseCommand("cleanup", {}, env);
    },
};
