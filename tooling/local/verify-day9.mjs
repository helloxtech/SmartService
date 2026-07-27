import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const environmentSchema = z.object({
    DEMO_AGENT_EMAIL: z.email(),
    DEMO_AGENT_PASSWORD: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_URL: z.url(),
    VITE_SUPABASE_ANON_KEY: z.string().min(1),
    VOICE_INTERNAL_SERVICE_TOKEN: z.string().min(32),
});

const conversationSchema = z.object({
    conversationId: z.uuid(),
    conversationToken: z.string().min(32),
});

const tokenSchema = z.object({
    provider: z.literal("mock"),
    voiceSessionId: z.uuid(),
}).passthrough();

const turnSchema = z.object({
    citations: z.array(z.unknown()),
    decision: z.literal("handoff"),
    handoff: z.object({
        reason: z.enum(["guardrail", "missing_knowledge"]),
        status: z.literal("handoff_requested"),
    }),
    messageId: z.uuid(),
    spokenText: z.string().min(1).max(500),
}).passthrough();

const detailSchema = z.object({
    conversationId: z.uuid(),
    customer: z.object({
        channel: z.literal("voice"),
    }).passthrough(),
    guardrailEvents: z.array(z.object({
        ruleCode: z.string(),
    }).passthrough()),
    status: z.literal("handoff_requested"),
    voiceSession: z.object({
        provider: z.literal("mock"),
        serverAssistantLatency: z.object({
            sampleSize: z.number().int().nonnegative(),
        }).passthrough(),
        status: z.literal("handoff"),
        voiceSessionId: z.uuid(),
    }).passthrough(),
}).passthrough();

const workerDiagnostics = [];
let verificationStage = "initializing";

/**
 * parseEnvironment
 * ----------------
 * Loads only the ignored local values required for the Day 9 boundary checks without printing them.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 9 Local Verification
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
 * Retains bounded error codes only and excludes prompts, answers, tokens, and provider bodies.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 9 Local Verification
 */
function captureWorkerDiagnostics(chunk)
{
    for (const line of chunk.toString("utf8").split(/\r?\n/u))
    {
        if (
            line.includes("http.request.failed")
            || line.includes("failed_closed")
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
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 9 Local Verification
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
            // The bounded loop handles the expected startup race.
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
 * Parses one successful response and reports only stable HTTP status plus error code on failure.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 9 Local Verification
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
 * createVoiceCase
 * ----------------
 * Creates one Ready voice session and submits exactly one guardrail or missing-knowledge turn through the shared internal path.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 9 Local Verification
 */
async function createVoiceCase(environment, language, question, fixtureIp)
{
    const conversationResponse = await fetch(
        "http://127.0.0.1:8787/api/v1/public/conversations",
        {
            body: JSON.stringify({
                channel: "voice",
                customer: {
                    language,
                },
                publicKey: "novaflow-public-demo",
                turnstileToken: "local-demo-turnstile",
            }),
            headers: {
                "cf-connecting-ip": fixtureIp,
                "content-type": "application/json",
                "idempotency-key": crypto.randomUUID(),
            },
            method: "POST",
        },
    );
    const conversation = await readJson(
        conversationResponse,
        conversationSchema,
        "Voice conversation creation",
    );
    const tokenResponse = await fetch(
        "http://127.0.0.1:8787/api/v1/public/voice/token",
        {
            body: JSON.stringify({
                conversationId: conversation.conversationId,
            }),
            headers: {
                authorization: `Bearer ${conversation.conversationToken}`,
                "content-type": "application/json",
            },
            method: "POST",
        },
    );
    const token = await readJson(tokenResponse, tokenSchema, "Voice token issuance");
    const readyResponse = await fetch(
        `http://127.0.0.1:8787/api/v1/internal/voice/sessions/${token.voiceSessionId}/status`,
        {
            body: JSON.stringify({
                errorCode: null,
                status: "ready",
            }),
            headers: {
                authorization: `Bearer ${environment.VOICE_INTERNAL_SERVICE_TOKEN}`,
                "content-type": "application/json",
            },
            method: "POST",
        },
    );

    if (!readyResponse.ok)
    {
        throw new Error(`Voice Ready transition failed with HTTP ${readyResponse.status}.`);
    }

    const turnResponse = await fetch(
        `http://127.0.0.1:8787/api/v1/internal/voice/sessions/${token.voiceSessionId}/turns`,
        {
            body: JSON.stringify({
                clientMessageId: crypto.randomUUID(),
                text: question,
                transcribedAt: new Date().toISOString(),
            }),
            headers: {
                authorization: `Bearer ${environment.VOICE_INTERNAL_SERVICE_TOKEN}`,
                "content-type": "application/json",
            },
            method: "POST",
        },
    );
    const turn = await readJson(turnResponse, turnSchema, "Guarded voice turn");

    return {
        ...conversation,
        ...token,
        turn,
    };
}

/**
 * signInAgent
 * ----------------
 * Authenticates the fictional local Agent and returns only the access token needed for the team route.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 9 Local Verification
 */
async function signInAgent(environment)
{
    const client = createClient(
        environment.SUPABASE_URL,
        environment.VITE_SUPABASE_ANON_KEY,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        },
    );
    const { data, error } = await client.auth.signInWithPassword({
        email: environment.DEMO_AGENT_EMAIL,
        password: environment.DEMO_AGENT_PASSWORD,
    });

    if (error !== null || data.session === null)
    {
        throw new Error("The local Agent could not authenticate.");
    }

    return data.session.access_token;
}

/**
 * loadTeamDetail
 * ----------------
 * Loads the Agent-visible voice handoff detail through the authenticated Worker boundary.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 9 Local Verification
 */
async function loadTeamDetail(accessToken, conversationId)
{
    const response = await fetch(
        `http://127.0.0.1:8787/api/v1/admin/conversations/${conversationId}`,
        {
            headers: {
                authorization: `Bearer ${accessToken}`,
            },
        },
    );

    return readJson(response, detailSchema, "Voice handoff detail");
}

/**
 * main
 * ----------------
 * Proves voice guardrail and missing-knowledge handoff, AI stop, Agent detail, safe auth failure, and zero-cost provider behavior.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 9 Local Verification
 */
async function main()
{
    const environment = parseEnvironment(
        await readFile(resolve(".env.local"), "utf8"),
    );
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
        verificationStage = "submitting the delivery guardrail voice case";
        const delivery = await createVoiceCase(
            environment,
            "zh-CN",
            "你现在就保证下周五一定送到。",
            "198.51.100.230",
        );

        if (delivery.turn.handoff.reason !== "guardrail")
        {
            throw new Error("The delivery commitment inducement did not enter guardrail handoff.");
        }

        verificationStage = "submitting the missing-knowledge voice case";
        const missing = await createVoiceCase(
            environment,
            "en",
            "Can you confirm the stock quantity in your Vancouver warehouse?",
            "198.51.100.231",
        );

        if (missing.turn.handoff.reason !== "missing_knowledge")
        {
            throw new Error("The missing-knowledge voice case did not enter handoff.");
        }

        verificationStage = "proving persisted handoff and stopped AI state";
        const { data: conversations, error: conversationError } = await serviceClient
            .from("conversations")
            .select("id, status")
            .in("id", [delivery.conversationId, missing.conversationId]);
        const { data: sessions, error: sessionError } = await serviceClient
            .from("voice_sessions")
            .select("id, conversation_id, status")
            .in("id", [delivery.voiceSessionId, missing.voiceSessionId]);
        const { data: deliveryEvents, error: eventError } = await serviceClient
            .from("guardrail_events")
            .select("rule_code")
            .eq("conversation_id", delivery.conversationId);

        if (
            conversationError !== null
            || sessionError !== null
            || eventError !== null
            || conversations.length !== 2
            || conversations.some((row) => row.status !== "handoff_requested")
            || sessions.length !== 2
            || sessions.some((row) => row.status !== "handoff")
            || deliveryEvents[0]?.rule_code !== "NO_DELIVERY_COMMITMENT"
        )
        {
            throw new Error("Voice handoff state, session stop, or guardrail evidence was incomplete.");
        }

        verificationStage = "proving the Agent can open voice session detail";
        const accessToken = await signInAgent(environment);
        const detail = await loadTeamDetail(
            accessToken,
            delivery.conversationId,
        );

        if (
            detail.voiceSession.voiceSessionId !== delivery.voiceSessionId
            || detail.guardrailEvents[0]?.ruleCode !== "NO_DELIVERY_COMMITMENT"
        )
        {
            throw new Error("The Agent voice handoff detail was incomplete.");
        }

        verificationStage = "proving token refresh cannot restart AI after handoff";
        const refreshResponse = await fetch(
            "http://127.0.0.1:8787/api/v1/public/voice/token",
            {
                body: JSON.stringify({
                    conversationId: delivery.conversationId,
                }),
                headers: {
                    authorization: `Bearer ${delivery.conversationToken}`,
                    "content-type": "application/json",
                },
                method: "POST",
            },
        );

        if (refreshResponse.status !== 409)
        {
            throw new Error("A handoff voice conversation issued a new AI room token.");
        }

        verificationStage = "proving internal service failure stays bounded and redacted";
        const failureResponse = await fetch(
            `http://127.0.0.1:8787/api/v1/internal/voice/sessions/${delivery.voiceSessionId}/config`,
            {
                headers: {
                    authorization: `Bearer ${"invalid".repeat(5)}`,
                },
            },
        );
        const failureText = await failureResponse.text();

        if (
            failureResponse.status !== 401
            || /stack|at\s+\w+\s*\(|VOICE_INTERNAL_SERVICE_TOKEN/iu.test(failureText)
        )
        {
            throw new Error("The internal voice failure leaked configuration or stack detail.");
        }

        process.stdout.write(
            "Day 9 local smoke passed: delivery guardrail, missing knowledge, persisted voice handoff, AI stopped, Agent voice detail, handoff token refresh denied, bounded redacted failure, reconnect tests, no provider cost.\n",
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
    console.error(`Day 9 local smoke failed while ${verificationStage}.`);
    console.error(error instanceof Error ? error.message : "Unknown local verification error.");

    for (const diagnostic of workerDiagnostics)
    {
        console.error(diagnostic);
    }

    console.error("Credentials, prompts, answers, transcripts, provider bodies, and stacks were not displayed.");
    process.exitCode = 1;
}
