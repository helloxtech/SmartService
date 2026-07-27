import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const environmentSchema = z.object({
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_URL: z.url(),
    VOICE_INTERNAL_SERVICE_TOKEN: z.string().min(32),
});

const conversationSchema = z.object({
    conversationId: z.uuid(),
    conversationToken: z.string().min(32),
});

const voiceTokenSchema = z.object({
    agentName: z.string().min(1),
    expiresAt: z.iso.datetime({ offset: true }),
    provider: z.literal("mock"),
    roomName: z.string().min(1),
    token: z.string().min(16),
    url: z.url(),
    voiceSessionId: z.uuid(),
});

const configurationSchema = z.object({
    conversationId: z.uuid(),
    language: z.literal("zh-CN"),
    organizationId: z.uuid(),
    status: z.enum(["warming", "ready", "active", "handoff", "closed", "failed"]),
    voiceSessionId: z.uuid(),
});

const transcriptResponseSchema = z.object({
    created: z.boolean(),
    messageId: z.uuid(),
});

let verificationStage = "initializing";
const workerDiagnostics = [];

/**
 * parseEnvironment
 * ----------------
 * Reads only required ignored local values into memory and never prints credentials.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Local Verification
 */
function parseEnvironment(text)
{
    const values = {};

    for (const line of text.split(/\r?\n/u))
    {
        const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);

        if (match?.[1] !== undefined && match[2] !== undefined)
        {
            values[match[1]] = match[2].trim().replace(/^"(.*)"$/u, "$1");
        }
    }

    return environmentSchema.parse(values);
}

/**
 * captureWorkerDiagnostics
 * ----------------
 * Retains bounded error-only Worker lines without storing transcripts, tokens, or provider payloads.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Local Verification
 */
function captureWorkerDiagnostics(chunk)
{
    for (const line of chunk.toString("utf8").split(/\r?\n/u))
    {
        if (
            line.includes("http.request.failed")
            || line.includes("[ERROR]")
            || line.includes("Uncaught")
        )
        {
            workerDiagnostics.push(line.slice(0, 500));
        }
    }

    while (workerDiagnostics.length > 12)
    {
        workerDiagnostics.shift();
    }
}

/**
 * waitForWorker
 * ----------------
 * Waits up to thirty seconds for the local Worker health endpoint.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Local Verification
 */
async function waitForWorker()
{
    for (let attempt = 0; attempt < 60; attempt += 1)
    {
        try
        {
            const response = await fetch("http://127.0.0.1:8787/health", {
                signal: AbortSignal.timeout(1_000),
            });

            if (response.ok)
            {
                return;
            }
        }
        catch
        {
            // The bounded retry loop handles the expected local startup race.
        }

        await new Promise((resolveDelay) =>
        {
            setTimeout(resolveDelay, 500);
        });
    }

    throw new Error("The local Worker did not become healthy.");
}

/**
 * readJson
 * ----------------
 * Parses one successful response and reports only status plus stable error code for failures.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Local Verification
 */
async function readJson(response, schema, operation)
{
    const payload = await response.json();

    if (!response.ok)
    {
        const code = typeof payload?.error?.code === "string"
            ? payload.error.code
            : "UNKNOWN";
        throw new Error(`${operation} failed with HTTP ${response.status} (${code}).`);
    }

    return schema.parse(payload);
}

/**
 * createVoiceConversation
 * ----------------
 * Creates one mock-verified voice conversation only after the verifier's explicit simulated customer click.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Local Verification
 */
async function createVoiceConversation()
{
    const response = await fetch("http://127.0.0.1:8787/api/v1/public/conversations", {
        body: JSON.stringify({
            channel: "voice",
            customer: {
                language: "zh-CN",
                name: "Day 6 Voice Customer",
            },
            publicKey: "novaflow-public-demo",
            turnstileToken: "local-demo-turnstile",
        }),
        headers: {
            "cf-connecting-ip": "198.51.100.60",
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
        },
        method: "POST",
    });

    return readJson(response, conversationSchema, "Voice conversation creation");
}

/**
 * issueVoiceToken
 * ----------------
 * Exchanges the exact conversation bearer token for the local no-cost room token.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Local Verification
 */
async function issueVoiceToken(conversation)
{
    const response = await fetch("http://127.0.0.1:8787/api/v1/public/voice/token", {
        body: JSON.stringify({
            conversationId: conversation.conversationId,
        }),
        headers: {
            authorization: `Bearer ${conversation.conversationToken}`,
            "content-type": "application/json",
        },
        method: "POST",
    });

    return readJson(response, voiceTokenSchema, "Voice token issuance");
}

/**
 * internalRequest
 * ----------------
 * Sends one authenticated Agent request using the ignored local service token held only in process memory.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Local Verification
 */
async function internalRequest(environment, path, schema, init = {})
{
    const response = await fetch(`http://127.0.0.1:8787/api${path}`, {
        ...init,
        headers: {
            authorization: `Bearer ${environment.VOICE_INTERNAL_SERVICE_TOKEN}`,
            "content-type": "application/json",
        },
    });

    if (schema === null)
    {
        if (!response.ok)
        {
            throw new Error(`Internal request ${path} failed with HTTP ${response.status}.`);
        }

        return null;
    }

    return readJson(response, schema, `Internal request ${path}`);
}

/**
 * main
 * ----------------
 * Proves click-gated creation, tenant binding, Ready status, stable Chinese transcript persistence, replay safety, and zero provider cost.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Local Verification
 */
async function main()
{
    verificationStage = "reading ignored local configuration";
    const environment = parseEnvironment(await readFile(resolve(".env.local"), "utf8"));
    const serviceClient = createClient(
        environment.SUPABASE_URL,
        environment.SUPABASE_SERVICE_ROLE_KEY,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        },
    );

    verificationStage = "proving no voice session exists before click";
    const { count: beforeCount, error: beforeError } = await serviceClient
        .from("voice_sessions")
        .select("*", {
            count: "exact",
            head: true,
        });

    if (beforeError !== null || beforeCount !== 0)
    {
        throw new Error("The clean Day 6 fixture already contained a voice session.");
    }

    verificationStage = "starting the local Worker";
    const worker = spawn("pnpm", ["dev:api"], {
        cwd: resolve("."),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
    });
    worker.stdout.on("data", captureWorkerDiagnostics);
    worker.stderr.on("data", captureWorkerDiagnostics);

    try
    {
        await waitForWorker();
        verificationStage = "creating the click-gated voice conversation and token";
        const conversation = await createVoiceConversation();
        const voiceToken = await issueVoiceToken(conversation);

        verificationStage = "checking the tenant-bound warming session";
        const { data: storedSession, error: sessionError } = await serviceClient
            .from("voice_sessions")
            .select("id, organization_id, conversation_id, status, provider")
            .eq("id", voiceToken.voiceSessionId)
            .single();

        if (
            sessionError !== null
            || storedSession.conversation_id !== conversation.conversationId
            || storedSession.organization_id !== "00000000-0000-4000-a000-000000000001"
            || storedSession.status !== "warming"
            || storedSession.provider !== "mock"
        )
        {
            throw new Error("The voice session was not stored in the exact tenant conversation.");
        }

        verificationStage = "proving internal configuration rejects the wrong service token";
        const unauthorized = await fetch(
            `http://127.0.0.1:8787/api/v1/internal/voice/sessions/${voiceToken.voiceSessionId}/config`,
            {
                headers: {
                    authorization: `Bearer ${"wrong".repeat(8)}`,
                },
            },
        );

        if (unauthorized.status !== 401)
        {
            throw new Error("The internal voice configuration accepted an invalid service token.");
        }

        verificationStage = "loading configuration and marking the Agent Ready";
        const configuration = await internalRequest(
            environment,
            `/v1/internal/voice/sessions/${voiceToken.voiceSessionId}/config`,
            configurationSchema,
        );

        if (
            configuration.conversationId !== conversation.conversationId
            || configuration.voiceSessionId !== voiceToken.voiceSessionId
        )
        {
            throw new Error("The Agent configuration did not stay bound to the exact voice session.");
        }

        await internalRequest(
            environment,
            `/v1/internal/voice/sessions/${voiceToken.voiceSessionId}/status`,
            null,
            {
                body: JSON.stringify({
                    errorCode: null,
                    status: "ready",
                }),
                method: "POST",
            },
        );

        verificationStage = "persisting and replaying a stable final Chinese transcript";
        const clientMessageId = crypto.randomUUID();
        const transcriptText = "请问 NF-500 的最大流量是多少？";
        const transcriptInput = {
            clientMessageId,
            language: "zh-CN",
            text: transcriptText,
            transcribedAt: new Date().toISOString(),
        };
        const firstTranscript = await internalRequest(
            environment,
            `/v1/internal/voice/sessions/${voiceToken.voiceSessionId}/transcripts`,
            transcriptResponseSchema,
            {
                body: JSON.stringify(transcriptInput),
                method: "POST",
            },
        );
        const replayTranscript = await internalRequest(
            environment,
            `/v1/internal/voice/sessions/${voiceToken.voiceSessionId}/transcripts`,
            transcriptResponseSchema,
            {
                body: JSON.stringify(transcriptInput),
                method: "POST",
            },
        );

        if (
            !firstTranscript.created
            || replayTranscript.created
            || replayTranscript.messageId !== firstTranscript.messageId
        )
        {
            throw new Error("Final transcript persistence was not idempotent.");
        }

        const { data: storedMessages, error: messageError } = await serviceClient
            .from("messages")
            .select("id, text, language, sender_type")
            .eq("conversation_id", conversation.conversationId)
            .eq("client_message_id", clientMessageId);

        if (
            messageError !== null
            || storedMessages.length !== 1
            || storedMessages[0]?.text !== transcriptText
            || storedMessages[0]?.language !== "zh-CN"
            || storedMessages[0]?.sender_type !== "customer"
        )
        {
            throw new Error("The final Chinese transcript was not persisted exactly once.");
        }

        verificationStage = "checking token replay and Ready timestamp";
        const replayToken = await issueVoiceToken(conversation);
        const { data: finalSessions, error: finalSessionError } = await serviceClient
            .from("voice_sessions")
            .select("id, status, ready_at")
            .eq("conversation_id", conversation.conversationId);

        if (
            replayToken.voiceSessionId !== voiceToken.voiceSessionId
            || finalSessionError !== null
            || finalSessions.length !== 1
            || finalSessions[0]?.status !== "ready"
            || finalSessions[0]?.ready_at === null
        )
        {
            throw new Error("Voice token replay created a duplicate session or lost Ready state.");
        }

        process.stdout.write(
            "Day 6 local smoke passed: no pre-click session, tenant-bound token, Agent auth, Ready gate, stable Chinese transcript, idempotent replay, no provider cost.\n",
        );
    }
    finally
    {
        worker.kill("SIGTERM");
    }
}

try
{
    await main();
}
catch (error)
{
    console.error(`Day 6 local smoke failed while ${verificationStage}.`);
    console.error(error instanceof Error ? error.message : "Unknown local verification error.");

    for (const diagnostic of workerDiagnostics)
    {
        console.error(diagnostic);
    }

    console.error("Credentials, transcript content, tokens, and provider bodies were not displayed.");
    process.exitCode = 1;
}
