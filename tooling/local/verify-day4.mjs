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
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_URL: z.url(),
    VITE_SUPABASE_ANON_KEY: z.string().min(1),
});

const fixtureSchema = z.object({
    cases: z.array(z.object({
        expectedRule: z.string().optional(),
        group: z.string(),
        id: z.string(),
        language: z.enum(["zh-CN", "en"]).optional(),
        question: z.string(),
    })),
});

const createResponseSchema = z.object({
    conversationId: z.uuid(),
    conversationToken: z.string().min(32),
});

const sendResponseSchema = z.object({
    answer: z.string().min(1),
    citations: z.array(z.unknown()),
    decision: z.literal("handoff"),
    handoff: z.object({
        reason: z.literal("guardrail"),
        status: z.literal("handoff_requested"),
    }),
    messageId: z.uuid(),
});

const humanRoutedResponseSchema = z.object({
    answer: z.string().min(1),
    citations: z.array(z.unknown()).length(0),
    decision: z.literal("human"),
    handoff: z.null(),
    messageId: z.uuid(),
});

const inboxResponseSchema = z.object({
    conversations: z.array(z.object({
        conversationId: z.uuid(),
        status: z.enum(["handoff_requested", "active_human", "closed"]),
        summary: z.object({
            conversationSummary: z.string().min(1),
            customerQuestion: z.string().min(1),
            nextStep: z.string().min(1),
            triggerReason: z.string().min(1),
        }).passthrough(),
    }).passthrough()),
});

const detailResponseSchema = z.object({
    acceptedBy: z.uuid().nullable(),
    conversationId: z.uuid(),
    customer: z.object({
        company: z.string().nullable(),
        phone: z.string().nullable(),
    }).passthrough(),
    guardrailEvents: z.array(z.object({
        id: z.uuid(),
        ruleCode: z.string(),
    }).passthrough()),
    messages: z.array(z.object({
        messageId: z.uuid(),
        senderType: z.string(),
        text: z.string(),
    }).passthrough()),
    status: z.enum(["handoff_requested", "active_human", "closed"]),
    summaryRecord: z.object({
        followUpActions: z.array(z.string()),
        intentLevel: z.string(),
        outcome: z.string(),
        primaryIntent: z.string(),
        suggestedScript: z.string(),
        summary: z.string(),
    }).nullable(),
}).passthrough();

const pollResponseSchema = z.object({
    messages: z.array(z.object({
        messageId: z.uuid(),
        senderType: z.enum(["ai", "human", "system"]),
        text: z.string(),
    }).passthrough()),
    nextCursor: z.string().nullable(),
    status: z.string(),
});

let verificationStage = "initializing";
const workerDiagnostics = [];

/**
 * captureWorkerDiagnostics
 * ----------------
 * Retains bounded error-only local Worker lines without storing prompts, candidate text, credentials, or response bodies.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Local Verification
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
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Local Verification
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
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Local Verification
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
 * Parses a successful response with the supplied schema and reports only HTTP status plus stable error code on failure.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Local Verification
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
 * createConversation
 * ----------------
 * Creates one isolated mock-verified public conversation without exposing its scoped token.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Local Verification
 */
async function createConversation(language, fixtureIp)
{
    const response = await fetch("http://127.0.0.1:8787/api/v1/public/conversations", {
        body: JSON.stringify({
            channel: "text",
            customer: {
                language,
                name: "Day 4 Customer",
            },
            publicKey: "smart-service-public-demo",
            turnstileToken: "local-demo-turnstile",
        }),
        headers: {
            "cf-connecting-ip": fixtureIp,
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
        },
        method: "POST",
    });
    return readJson(response, createResponseSchema, "Conversation creation");
}

/**
 * sendGuardrailQuestion
 * ----------------
 * Sends one fixed guardrail question through the real local public Worker path.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Local Verification
 */
async function sendGuardrailQuestion(conversation, question, fixtureIp)
{
    const response = await fetch(
        `http://127.0.0.1:8787/api/v1/public/conversations/${conversation.conversationId}/messages`,
        {
            body: JSON.stringify({
                clientMessageId: crypto.randomUUID(),
                text: question,
            }),
            headers: {
                authorization: `Bearer ${conversation.conversationToken}`,
                "cf-connecting-ip": fixtureIp,
                "content-type": "application/json",
            },
            method: "POST",
        },
    );
    return readJson(response, sendResponseSchema, "Guardrail turn");
}

/**
 * signIn
 * ----------------
 * Authenticates one fictional local operator and returns only the short-lived session object held in memory.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Local Verification
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

    if (error !== null)
    {
        throw new Error("A fictional local operator could not sign in.");
    }

    if (data.session === null)
    {
        throw new Error("A fictional local operator session was not created.");
    }

    return data.session;
}

/**
 * teamRequest
 * ----------------
 * Sends one authenticated team request with an idempotency key for mutations.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Local Verification
 */
async function teamRequest(session, path, schema, init = {})
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
    return readJson(response, schema, `Team request ${path}`);
}

/**
 * waitForPublicMessage
 * ----------------
 * Polls the scoped public endpoint for target human/system copy and enforces the three-second visibility objective.
 *
 * July 30, 2026: Updated by Forrest Zhang for SmartService Chinese UI
 */
async function waitForPublicMessage(conversation, targetText)
{
    const startedAt = Date.now();
    const targetTexts = Array.isArray(targetText) ? targetText : [targetText];

    for (let attempt = 0; attempt < 6; attempt += 1)
    {
        const response = await fetch(
            `http://127.0.0.1:8787/api/v1/public/conversations/${conversation.conversationId}/messages?limit=50`,
            {
                headers: {
                    authorization: `Bearer ${conversation.conversationToken}`,
                },
            },
        );
        const poll = await readJson(response, pollResponseSchema, "Public message polling");

        if (poll.messages.some((entry) => targetTexts.includes(entry.text)))
        {
            return {
                elapsedMs: Date.now() - startedAt,
                poll,
            };
        }

        await new Promise((resolveDelay) =>
        {
            setTimeout(resolveDelay, 500);
        });
    }

    throw new Error("The target public message was not visible to the public client within three seconds.");
}

/**
 * waitForFinalSummary
 * ----------------
 * Polls the authenticated detail until the local Queue consumer persists the final summary.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Local Verification
 */
async function waitForFinalSummary(session, conversationId)
{
    for (let attempt = 0; attempt < 40; attempt += 1)
    {
        const detail = await teamRequest(
            session,
            `/v1/admin/conversations/${conversationId}`,
            detailResponseSchema,
        );

        if (detail.summaryRecord !== null)
        {
            return detail;
        }

        await new Promise((resolveDelay) =>
        {
            setTimeout(resolveDelay, 250);
        });
    }

    throw new Error("The final summary did not arrive within ten seconds.");
}

/**
 * main
 * ----------------
 * Runs all six guardrails plus handoff, takeover, human-routed customer updates, public human polling, closure, and finalization with zero live-provider cost.
 *
 * July 30, 2026: Updated by Forrest Zhang for SmartService Pending Handoff Customer Messages
 */
async function main()
{
    verificationStage = "reading ignored configuration and fixed acceptance cases";
    const environment = parseEnvironment(await readFile(resolve(".env.local"), "utf8"));
    const fixture = fixtureSchema.parse(JSON.parse(
        await readFile(
            resolve("docs/spec/fixtures/tests/acceptance_cases.json"),
            "utf8",
        ),
    ));
    const guardrailCases = fixture.cases.filter((entry) => entry.group === "guardrail");

    if (guardrailCases.length !== 6)
    {
        throw new Error("The fixed guardrail set does not contain exactly six cases.");
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
        verificationStage = "running all six public guardrail cases";
        const conversations = [];

        for (const [index, testCase] of guardrailCases.entries())
        {
            const fixtureIp = `198.51.100.${30 + index}`;
            const conversation = await createConversation(
                testCase.language ?? "en",
                fixtureIp,
            );
            const result = await sendGuardrailQuestion(
                conversation,
                testCase.question,
                fixtureIp,
            );

            if (result.citations.length !== 0)
            {
                throw new Error(`${testCase.id} exposed citations in a blocked response.`);
            }

            conversations.push({
                ...conversation,
                expectedRule: testCase.expectedRule,
                language: testCase.language ?? "en",
            });
        }

        verificationStage = "checking persisted rule events and handoff packages";
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
        const conversationIds = conversations.map((entry) => entry.conversationId);
        const { data: events, error: eventError } = await serviceClient
            .from("guardrail_events")
            .select("id, conversation_id, rule_code, reason, severity, created_at")
            .in("conversation_id", conversationIds);
        const { data: handoffs, error: handoffError } = await serviceClient
            .from("handoffs")
            .select("conversation_id, summary_snapshot")
            .in("conversation_id", conversationIds);

        if (
            eventError !== null
            || handoffError !== null
            || events.length !== 6
            || handoffs.length !== 6
        )
        {
            throw new Error("The fixed guardrail turns did not persist one event and handoff each.");
        }

        for (const conversation of conversations)
        {
            const event = events.find((entry) => entry.conversation_id === conversation.conversationId);

            if (
                event?.rule_code !== conversation.expectedRule
                || event.reason.length === 0
                || event.created_at === null
            )
            {
                throw new Error(`The persisted event for ${conversation.expectedRule} is incomplete.`);
            }
        }

        const primary = conversations[0];

        if (primary === undefined)
        {
            throw new Error("The primary handoff fixture is missing.");
        }

        verificationStage = "verifying the Agent handoff package within three seconds";
        const agentSession = await signIn(
            environment,
            environment.DEMO_AGENT_EMAIL,
            environment.DEMO_AGENT_PASSWORD,
        );
        const inboxStartedAt = Date.now();
        const inbox = await teamRequest(
            agentSession,
            "/v1/admin/conversations",
            inboxResponseSchema,
        );
        const inboxItem = inbox.conversations.find(
            (entry) => entry.conversationId === primary.conversationId,
        );

        if (
            inboxItem === undefined
            || Date.now() - inboxStartedAt >= 3_000
            || inboxItem.summary.triggerReason !== "guardrail"
        )
        {
            throw new Error("The Agent handoff package was not ready within three seconds.");
        }

        const initialDetail = await teamRequest(
            agentSession,
            `/v1/admin/conversations/${primary.conversationId}`,
            detailResponseSchema,
        );

        if (
            initialDetail.customer.company !== null
            || initialDetail.customer.phone !== null
            || initialDetail.guardrailEvents.length === 0
            || JSON.stringify(initialDetail).includes("blockedCandidate")
        )
        {
            throw new Error("The Agent detail invented customer data or exposed a withheld candidate.");
        }

        verificationStage = "claiming the handoff and proving customer updates route to humans";
        await teamRequest(
            agentSession,
            `/v1/admin/conversations/${primary.conversationId}/takeover`,
            z.object({
                acceptedBy: z.uuid(),
                status: z.literal("active_human"),
            }).passthrough(),
            {
                method: "POST",
            },
        );
        const humanRoutedResponse = await fetch(
            `http://127.0.0.1:8787/api/v1/public/conversations/${primary.conversationId}/messages`,
            {
                body: JSON.stringify({
                    clientMessageId: crypto.randomUUID(),
                    text: "This must not trigger another AI answer.",
                }),
                headers: {
                    authorization: `Bearer ${primary.conversationToken}`,
                    "content-type": "application/json",
                },
                method: "POST",
            },
        );
        await readJson(humanRoutedResponse, humanRoutedResponseSchema, "Human-routed customer update");

        verificationStage = "sending and polling one human message";
        const humanText = "Hello, I have taken over and will help you safely.";
        await teamRequest(
            agentSession,
            `/v1/admin/conversations/${primary.conversationId}/messages`,
            z.object({
                created: z.boolean(),
            }).passthrough(),
            {
                body: JSON.stringify({
                    clientMessageId: crypto.randomUUID(),
                    text: humanText,
                }),
                method: "POST",
            },
        );
        const publicHuman = await waitForPublicMessage(primary, humanText);

        if (publicHuman.elapsedMs >= 3_000)
        {
            throw new Error("The public client did not receive the human message within three seconds.");
        }

        verificationStage = "closing and waiting for asynchronous finalization";
        await teamRequest(
            agentSession,
            `/v1/admin/conversations/${primary.conversationId}/close`,
            z.object({
                finalizationQueued: z.literal(true),
                status: z.literal("closed"),
            }).passthrough(),
            {
                method: "POST",
            },
        );
        const finalDetail = await waitForFinalSummary(
            agentSession,
            primary.conversationId,
        );

        if (
            finalDetail.summaryRecord?.summary.length === 0
            || finalDetail.summaryRecord?.primaryIntent.length === 0
            || finalDetail.summaryRecord?.suggestedScript.length === 0
        )
        {
            throw new Error("The final conversation record is incomplete.");
        }

        const publicClosed = await waitForPublicMessage(
            primary,
            [
                "此会话已由人工客服结束。",
                "This conversation was closed by the human support specialist.",
            ],
        );

        if (publicClosed.poll.status !== "closed")
        {
            throw new Error("Read-only public polling did not remain available after closure.");
        }

        verificationStage = "checking Admin-only candidate access and final audit";
        const agentGuardrailResponse = await fetch(
            "http://127.0.0.1:8787/api/v1/admin/guardrails/events",
            {
                headers: {
                    authorization: `Bearer ${agentSession.access_token}`,
                },
            },
        );

        if (agentGuardrailResponse.status !== 403)
        {
            throw new Error("An Agent accessed the Admin guardrail event endpoint.");
        }

        const adminSession = await signIn(
            environment,
            environment.DEMO_ADMIN_EMAIL,
            environment.DEMO_ADMIN_PASSWORD,
        );
        const adminEvents = await teamRequest(
            adminSession,
            "/v1/admin/guardrails/events",
            z.object({
                events: z.array(z.object({
                    id: z.uuid(),
                    conversationId: z.uuid(),
                }).passthrough()),
            }),
        );
        const adminEvent = adminEvents.events.find(
            (entry) => entry.conversationId === primary.conversationId,
        );

        if (adminEvent === undefined || JSON.stringify(adminEvents).includes("blockedCandidate"))
        {
            throw new Error("The Admin event list is missing or returned candidate text by default.");
        }

        await teamRequest(
            adminSession,
            `/v1/admin/guardrails/events/${adminEvent.id}/candidate`,
            z.object({
                blockedCandidate: z.string().nullable(),
                eventId: z.uuid(),
            }),
        );
        const { data: finalRuns, error: finalRunError } = await serviceClient
            .from("ai_runs")
            .select("id, metadata")
            .eq("conversation_id", primary.conversationId)
            .eq("task_type", "conversation_finalize")
            .eq("status", "succeeded");

        if (
            finalRunError !== null
            || finalRuns.length !== 1
            || finalRuns[0]?.metadata?.ticketClassificationIncluded !== false
        )
        {
            throw new Error("The final no-ticket AI audit record is missing.");
        }

        process.stdout.write(
            "Day 4 local smoke passed: 6/6 guardrails, handoff <3s, customer updates routed to humans without AI, human poll <3s, close/finalize complete, no provider cost.\n",
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
    console.error(`Day 4 local smoke failed while ${verificationStage}.`);
    console.error(error instanceof Error ? error.message : "Unknown local verification error.");

    for (const diagnostic of workerDiagnostics)
    {
        console.error(diagnostic);
    }

    console.error("Credentials, prompts, provider bodies, and withheld candidates were not displayed.");
    process.exitCode = 1;
}
