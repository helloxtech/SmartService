import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const environmentSchema = z.object({
    DEMO_ADMIN_EMAIL: z.email(),
    DEMO_ADMIN_PASSWORD: z.string().min(1),
    DEMO_AGENT_EMAIL: z.email(),
    DEMO_AGENT_PASSWORD: z.string().min(1),
    DEMO_OTHER_ADMIN_EMAIL: z.email(),
    DEMO_OTHER_ADMIN_PASSWORD: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_URL: z.url(),
    VITE_SUPABASE_ANON_KEY: z.string().min(1),
});

const createResponseSchema = z.object({
    conversationId: z.uuid(),
    conversationToken: z.string().min(32),
});

const handoffResponseSchema = z.object({
    citations: z.array(z.unknown()).length(0),
    decision: z.literal("handoff"),
    handoff: z.object({
        reason: z.literal("missing_knowledge"),
        status: z.literal("handoff_requested"),
    }),
});

const dashboardSchema = z.object({
    aiContainedConversations: z.number().int().nonnegative(),
    aiContainmentRate: z.number().min(0).max(1),
    from: z.iso.datetime({ offset: true }),
    handedOffConversations: z.number().int().nonnegative(),
    handoffRate: z.number().min(0).max(1),
    openKnowledgeGapCount: z.number().int().nonnegative(),
    to: z.iso.datetime({ offset: true }),
    totalConversations: z.number().int().nonnegative(),
});

const gapSchema = z.object({
    exampleQuestion: z.string(),
    id: z.uuid(),
    occurrenceCount: z.number().int().positive(),
    resolutionSource: z.object({
        chunkCount: z.number().int().nonnegative(),
        id: z.uuid(),
        status: z.string(),
    }).nullable(),
    status: z.enum(["open", "resolved", "ignored"]),
}).passthrough();

const gapListSchema = z.object({
    gaps: z.array(gapSchema),
});

const resolveResponseSchema = z.object({
    gapId: z.uuid(),
    jobId: z.uuid(),
    sourceId: z.uuid(),
    status: z.string(),
});

const retestResponseSchema = z.object({
    answer: z.string().min(1),
    citations: z.array(z.object({
        citationId: z.uuid(),
        label: z.string().min(1),
        sourceType: z.literal("manual"),
        supportingExcerpt: z.string().min(1),
    }).passthrough()).min(1),
    decision: z.enum(["answer", "clarify"]),
    gapId: z.uuid(),
});

const demoCases = {
    calibration: {
        answer: "The approved calibration review window is 21 days.",
        expectedAnswer: "21 days",
        question: "What is the calibration review window?",
        title: "Calibration review",
    },
    diagnostic: {
        answer: "The approved diagnostic coverage window is 14 days.",
        expectedAnswer: "14 days",
        question: "What is the diagnostic coverage window?",
        title: "Diagnostic coverage",
    },
    replacement: {
        answer: "The approved replacement inspection window is 10 days.",
        expectedAnswer: "10 days",
        question: "What is the replacement inspection window?",
        title: "Replacement inspection",
    },
};

let verificationStage = "initializing";
const workerDiagnostics = [];

/**
 * captureWorkerDiagnostics
 * ----------------
 * Retains bounded error-only Worker lines without storing prompts, answers, credentials, or response bodies.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Local Verification
 */
function captureWorkerDiagnostics(chunk)
{
    for (const line of chunk.toString("utf8").split(/\r?\n/u))
    {
        if (
            line.includes("http.request.failed")
            || line.includes("queue.message.failed")
            || line.includes("failed_closed")
            || line.includes("[ERROR]")
            || line.includes("Uncaught")
        )
        {
            workerDiagnostics.push(line.slice(0, 500));
        }
    }

    while (workerDiagnostics.length > 15)
    {
        workerDiagnostics.shift();
    }
}

/**
 * parseEnvironment
 * ----------------
 * Reads only required ignored local values into memory and never prints them.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Local Verification
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
 * waitForWorker
 * ----------------
 * Waits up to 30 seconds for the local Worker health endpoint.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Local Verification
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
            // The bounded loop handles the expected local startup race.
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
 * Parses a successful response with a bounded schema and reports only status plus stable error code on failure.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Local Verification
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
 * signIn
 * ----------------
 * Authenticates one fictional local operator while retaining the short-lived session only in memory.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Local Verification
 */
async function signIn(environment, email, password)
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
        email,
        password,
    });

    if (error !== null || data.session === null)
    {
        throw new Error("A fictional local operator could not sign in.");
    }

    return data.session;
}

/**
 * adminRequest
 * ----------------
 * Sends one authenticated Worker request and adds a fresh idempotency key to mutations.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Local Verification
 */
async function adminRequest(session, path, schema, init = {})
{
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${session.access_token}`);

    if (init.body !== undefined)
    {
        headers.set("content-type", "application/json");
    }

    if (init.method !== undefined && init.method !== "GET")
    {
        headers.set("idempotency-key", crypto.randomUUID());
    }

    const response = await fetch(`http://127.0.0.1:8787/api${path}`, {
        ...init,
        headers,
    });
    return readJson(response, schema, `Admin request ${path}`);
}

/**
 * createUnsupportedConversation
 * ----------------
 * Creates and sends one fixed unsupported warranty question through the real public Worker path.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Gap Grouping
 */
async function createUnsupportedConversation(question, fixtureIp)
{
    const created = await readJson(
        await fetch("http://127.0.0.1:8787/api/v1/public/conversations", {
            body: JSON.stringify({
                channel: "text",
                customer: {
                    language: "en",
                    name: "Day 5 Customer",
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
        }),
        createResponseSchema,
        "Conversation creation",
    );
    const handoff = await readJson(
        await fetch(
            `http://127.0.0.1:8787/api/v1/public/conversations/${created.conversationId}/messages`,
            {
                body: JSON.stringify({
                    clientMessageId: crypto.randomUUID(),
                    text: question,
                }),
                headers: {
                    authorization: `Bearer ${created.conversationToken}`,
                    "cf-connecting-ip": fixtureIp,
                    "content-type": "application/json",
                },
                method: "POST",
            },
        ),
        handoffResponseSchema,
        "Unsupported public turn",
    );

    if (handoff.citations.length !== 0)
    {
        throw new Error("The unsupported public answer exposed a citation.");
    }

    return created;
}

/**
 * closeHandoff
 * ----------------
 * Claims and closes one missing-knowledge conversation so it enters authoritative dashboard metrics.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard Verification
 */
async function closeHandoff(agentSession, conversationId)
{
    await adminRequest(
        agentSession,
        `/v1/admin/conversations/${conversationId}/takeover`,
        z.object({
            status: z.literal("active_human"),
        }).passthrough(),
        {
            method: "POST",
        },
    );
    await adminRequest(
        agentSession,
        `/v1/admin/conversations/${conversationId}/close`,
        z.object({
            status: z.literal("closed"),
        }).passthrough(),
        {
            method: "POST",
        },
    );
}

/**
 * waitForResolvedGap
 * ----------------
 * Polls until shared queue ingestion makes the manual source ready and atomically resolves the linked gap.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 One-click Knowledge
 */
async function waitForResolvedGap(adminSession, gapId)
{
    for (let attempt = 0; attempt < 120; attempt += 1)
    {
        const gap = await adminRequest(
            adminSession,
            `/v1/admin/knowledge-gaps/${gapId}`,
            gapSchema,
        );

        if (
            gap.status === "resolved"
            && gap.resolutionSource?.status === "ready"
            && gap.resolutionSource.chunkCount > 0
        )
        {
            return gap;
        }

        if (gap.resolutionSource?.status === "failed")
        {
            throw new Error("The manual resolution source entered Failed state.");
        }

        await new Promise((resolveDelay) =>
        {
            setTimeout(resolveDelay, 500);
        });
    }

    throw new Error("The manual source did not resolve the knowledge gap within 60 seconds.");
}

/**
 * main
 * ----------------
 * Proves exact dashboard math, grouping, tenant/Admin boundaries, one-click ingestion, and cited source-scoped re-test at zero provider cost.
 *
 * July 27, 2026: Updated by Forrest Zhang for SmartService P0 Consecutive Demo Verification
 */
async function main()
{
    const demoCaseName = process.env.SMARTSERVICE_DEMO_CASE ?? "diagnostic";
    const demoCase = demoCases[demoCaseName];

    if (demoCase === undefined)
    {
        throw new Error("SMARTSERVICE_DEMO_CASE must be diagnostic, calibration, or replacement.");
    }

    verificationStage = "reading ignored local configuration";
    const environment = parseEnvironment(await readFile(resolve(".env.local"), "utf8"));
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
        verificationStage = "signing in fictional tenant operators";
        const [adminSession, agentSession, otherAdminSession] = await Promise.all([
            signIn(
                environment,
                environment.DEMO_ADMIN_EMAIL,
                environment.DEMO_ADMIN_PASSWORD,
            ),
            signIn(
                environment,
                environment.DEMO_AGENT_EMAIL,
                environment.DEMO_AGENT_PASSWORD,
            ),
            signIn(
                environment,
                environment.DEMO_OTHER_ADMIN_EMAIL,
                environment.DEMO_OTHER_ADMIN_PASSWORD,
            ),
        ]);

        const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const to = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const dashboardPath = `/v1/admin/dashboard/summary?${new URLSearchParams({
            from,
            to,
        }).toString()}`;
        const baselineDashboard = await adminRequest(
            adminSession,
            dashboardPath,
            dashboardSchema,
        );
        verificationStage = "grouping the same unsupported question twice";
        const question = demoCase.question;
        const first = await createUnsupportedConversation(question, "198.51.100.81");
        const second = await createUnsupportedConversation(question, "198.51.100.82");
        const gaps = await adminRequest(
            adminSession,
            "/v1/admin/knowledge-gaps?status=open",
            gapListSchema,
        );
        const gap = gaps.gaps.find((entry) => entry.exampleQuestion === question);

        if (gap === undefined || gap.occurrenceCount !== 2)
        {
            throw new Error("The repeated unsupported question did not group into one 2-occurrence gap.");
        }

        verificationStage = "closing handoffs and checking exact dashboard aggregation";
        await closeHandoff(agentSession, first.conversationId);
        await closeHandoff(agentSession, second.conversationId);
        const dashboard = await adminRequest(
            adminSession,
            dashboardPath,
            dashboardSchema,
        );

        if (
            dashboard.totalConversations !== baselineDashboard.totalConversations + 2
            || dashboard.handedOffConversations !== baselineDashboard.handedOffConversations + 2
            || dashboard.aiContainedConversations !== baselineDashboard.aiContainedConversations
            || dashboard.openKnowledgeGapCount !== baselineDashboard.openKnowledgeGapCount + 1
        )
        {
            throw new Error("The exact Day 5 dashboard deltas do not match the two closed handoffs.");
        }

        verificationStage = "proving Admin and tenant boundaries";
        const agentDashboard = await fetch(
            `http://127.0.0.1:8787/api${dashboardPath}`,
            {
                headers: {
                    authorization: `Bearer ${agentSession.access_token}`,
                },
            },
        );

        if (agentDashboard.status !== 403)
        {
            throw new Error("An Agent accessed the Admin dashboard endpoint.");
        }

        const otherGaps = await adminRequest(
            otherAdminSession,
            "/v1/admin/knowledge-gaps",
            gapListSchema,
        );
        const otherDashboard = await adminRequest(
            otherAdminSession,
            dashboardPath,
            dashboardSchema,
        );

        if (
            otherGaps.gaps.some((entry) => entry.id === gap.id)
            || otherDashboard.totalConversations !== 0
            || otherDashboard.openKnowledgeGapCount !== 0
        )
        {
            throw new Error("Day 5 analytics crossed the tenant boundary.");
        }

        verificationStage = "creating and embedding one approved manual answer";
        const queued = await adminRequest(
            adminSession,
            `/v1/admin/knowledge-gaps/${gap.id}/resolve`,
            resolveResponseSchema,
            {
                body: JSON.stringify({
                    answer: demoCase.answer,
                    sourceNote: "Approved fixed Day 5 demo policy.",
                    title: demoCase.title,
                }),
                method: "POST",
            },
        );

        if (queued.gapId !== gap.id)
        {
            throw new Error("The manual source response was linked to the wrong gap.");
        }

        await waitForResolvedGap(adminSession, gap.id);
        verificationStage = "re-testing the original question with validated citations";
        const retest = await adminRequest(
            adminSession,
            `/v1/admin/knowledge-gaps/${gap.id}/retest`,
            retestResponseSchema,
            {
                method: "POST",
            },
        );

        if (
            retest.gapId !== gap.id
            || retest.citations.some((citation) => citation.sourceType !== "manual")
            || !retest.answer.includes(demoCase.expectedAnswer)
        )
        {
            throw new Error("The repaired question did not return the expected cited answer.");
        }

        verificationStage = "checking zero-cost re-test audit";
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
        const { data: runs, error: runError } = await serviceClient
            .from("ai_runs")
            .select("provider, estimated_cost_usd, metadata")
            .eq("task_type", "knowledge_gap_retest")
            .eq("metadata->>gapId", gap.id);

        if (
            runError !== null
            || runs.length !== 1
            || runs[0]?.provider !== "mock"
            || Number(runs[0]?.estimated_cost_usd ?? -1) !== 0
        )
        {
            throw new Error("The deterministic re-test audit or zero-cost evidence is missing.");
        }

        process.stdout.write(
            "Day 5 local smoke passed: exact dashboard +2 handoffs, grouped gap 2x, Admin/tenant isolation, manual source ready, cited re-test, no provider cost.\n",
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
    console.error(`Day 5 local smoke failed while ${verificationStage}.`);
    console.error(error instanceof Error ? error.message : "Unknown local verification error.");

    for (const diagnostic of workerDiagnostics)
    {
        console.error(diagnostic);
    }

    console.error("Credentials, prompts, provider bodies, and internal evidence IDs were not displayed.");
    process.exitCode = 1;
}
