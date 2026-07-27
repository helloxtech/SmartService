import {
    createVoiceTokenRequestSchema,
    createVoiceTokenResponseSchema,
    recordVoiceTranscriptRequestSchema,
    recordVoiceTranscriptResponseSchema,
    updateVoiceSessionStatusRequestSchema,
    voiceSessionConfigurationSchema,
} from "@smartservice/contracts";
import { Hono } from "hono";
import { z } from "zod";

import {
    ApiError,
    parseJsonBody,
} from "./errors";
import type {
    AppEnvironment,
    RuntimeServiceFactory,
    RuntimeServices,
} from "./types";

const voiceSessionIdSchema = z.uuid();

/**
 * getServices
 * ----------------
 * Creates request-scoped voice adapters from the current Worker bindings.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
function getServices(
    factory: RuntimeServiceFactory,
    bindings: AppEnvironment["Bindings"],
): RuntimeServices
{
    return factory(bindings);
}

/**
 * parseVoiceSessionId
 * ----------------
 * Validates an internal voice-session path identifier before service-token authorization and lookup.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
function parseVoiceSessionId(value: string): string
{
    const result = voiceSessionIdSchema.safeParse(value);

    if (!result.success)
    {
        throw new ApiError(400, "VOICE_SESSION_ID_INVALID", "The voice session ID is not valid.");
    }

    return result.data;
}

/**
 * createVoiceRouter
 * ----------------
 * Creates the public short-lived room-token route and the server-authenticated Agent configuration, status, and transcript routes.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
export function createVoiceRouter(
    serviceFactory: RuntimeServiceFactory,
): Hono<AppEnvironment>
{
    const router = new Hono<AppEnvironment>();

    router.post("/v1/public/voice/token", async (context) =>
    {
        const input = await parseJsonBody(
            context.req.raw,
            createVoiceTokenRequestSchema,
        );
        const services = getServices(serviceFactory, context.env);
        const response = await services.voice.createToken(
            context.req.raw,
            input.conversationId,
            context.get("requestId"),
        );

        context.header("cache-control", "no-store");
        return context.json(createVoiceTokenResponseSchema.parse(response), 201);
    });

    router.get("/v1/internal/voice/sessions/:voiceSessionId/config", async (context) =>
    {
        const voiceSessionId = parseVoiceSessionId(context.req.param("voiceSessionId"));
        const services = getServices(serviceFactory, context.env);
        const response = await services.voice.getConfiguration(
            context.req.raw,
            voiceSessionId,
        );

        context.header("cache-control", "no-store");
        return context.json(voiceSessionConfigurationSchema.parse(response));
    });

    router.post("/v1/internal/voice/sessions/:voiceSessionId/status", async (context) =>
    {
        const voiceSessionId = parseVoiceSessionId(context.req.param("voiceSessionId"));
        const input = await parseJsonBody(
            context.req.raw,
            updateVoiceSessionStatusRequestSchema,
        );
        const services = getServices(serviceFactory, context.env);
        await services.voice.updateStatus(
            context.req.raw,
            voiceSessionId,
            input,
            context.get("requestId"),
        );

        return context.body(null, 204);
    });

    router.post("/v1/internal/voice/sessions/:voiceSessionId/transcripts", async (context) =>
    {
        const voiceSessionId = parseVoiceSessionId(context.req.param("voiceSessionId"));
        const input = await parseJsonBody(
            context.req.raw,
            recordVoiceTranscriptRequestSchema,
        );
        const services = getServices(serviceFactory, context.env);
        const response = await services.voice.recordTranscript(
            context.req.raw,
            voiceSessionId,
            input,
        );

        return context.json(recordVoiceTranscriptResponseSchema.parse(response), 201);
    });

    return router;
}
