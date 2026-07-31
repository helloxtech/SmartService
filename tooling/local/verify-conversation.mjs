import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const environmentSchema = z.object({
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_URL: z.url(),
});

const acceptanceFixtureSchema = z.object({
    cases: z.array(z.object({
        expectedDecision: z.enum(["answer", "handoff"]).optional(),
        expectedFacts: z.array(z.string()).optional(),
        expectedReason: z.string().optional(),
        group: z.enum(["in_scope", "out_of_scope", "guardrail", "ticket"]),
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
    answer: z.string(),
    citations: z.array(z.object({
        citationId: z.uuid(),
        label: z.string(),
        sourceType: z.enum(["pdf", "docx", "url", "manual"]),
        sourceUrl: z.url().nullable(),
        supportingExcerpt: z.string(),
    })),
    decision: z.enum(["answer", "clarify", "handoff"]),
    handoff: z.object({
        reason: z.string(),
        status: z.literal("handoff_requested"),
    }).nullable(),
    messageId: z.uuid(),
});

const pollResponseSchema = z.object({
    messages: z.array(z.object({
        messageId: z.uuid(),
    }).passthrough()),
    nextCursor: z.string().nullable(),
    status: z.string(),
});

let verificationStage = "initializing";
const workerDiagnostics = [];

/**
 * captureWorkerDiagnostics
 * ----------------
 * Retains bounded structured failures from the local Worker without storing secrets, prompts, or evidence text.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
 */
function captureWorkerDiagnostics(chunk)
{
    for (const line of chunk.toString("utf8").split(/\r?\n/u))
    {
        if (
            line.includes("http.request.failed")
            || line.includes("public.turn.failed_closed")
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
 * Reads required ignored local service values into memory without printing them.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
 */
function parseEnvironment(text)
{
    const values = {};

    for (const line of text.split(/\r?\n/u))
    {
        const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);

        if (match === null)
        {
            continue;
        }

        const name = match[1];
        const serialized = match[2];

        if (name !== undefined && serialized !== undefined)
        {
            values[name] = serialized.trim().replace(/^"(.*)"$/u, "$1");
        }
    }

    return environmentSchema.parse(values);
}

/**
 * waitForWorker
 * ----------------
 * Waits up to 30 seconds for the local Worker health endpoint.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
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
 * readJsonResponse
 * ----------------
 * Parses a successful JSON response with the supplied schema and emits only status/code context on failure.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
 */
async function readJsonResponse(response, schema, operation)
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
 * Starts one local mock-verified conversation without exposing its scoped bearer token.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
 */
async function createConversation(language, fixtureIp)
{
    const response = await fetch("http://127.0.0.1:8787/api/v1/public/conversations", {
        body: JSON.stringify({
            channel: "text",
            customer: {
                language,
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

    return readJsonResponse(response, createResponseSchema, "Conversation creation");
}

/**
 * sendQuestion
 * ----------------
 * Sends one fixed acceptance question through the real local token, retrieval, answer, and persistence path.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
 */
async function sendQuestion(conversation, question, fixtureIp)
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

    return readJsonResponse(response, sendResponseSchema, "Customer message");
}

/**
 * assertInScopeResult
 * ----------------
 * Verifies the fixed expected facts, validated public citation shape, and absence of internal chunk identifiers.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
 */
function assertInScopeResult(testCase, result)
{
    if (result.decision !== "answer" || result.citations.length === 0)
    {
        throw new Error(`${testCase.id} did not return a cited answer.`);
    }

    const normalizedAnswer = result.answer.toLocaleLowerCase();

    for (const fact of testCase.expectedFacts ?? [])
    {
        if (!normalizedAnswer.includes(fact.toLocaleLowerCase()))
        {
            throw new Error(`${testCase.id} omitted an expected grounded fact.`);
        }
    }

    if (JSON.stringify(result).includes("chunkId"))
    {
        throw new Error(`${testCase.id} exposed an internal chunk identifier.`);
    }
}

/**
 * assertOutOfScopeResult
 * ----------------
 * Verifies a safe missing-knowledge handoff with no factual citations.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
 */
function assertOutOfScopeResult(testCase, result)
{
    if (
        result.decision !== "handoff"
        || result.handoff?.reason !== "missing_knowledge"
        || result.citations.length !== 0
    )
    {
        throw new Error(`${testCase.id} did not fail closed to a missing-knowledge handoff.`);
    }
}

/**
 * verifyPersistedArtifacts
 * ----------------
 * Confirms cited messages link to AI runs and out-of-scope turns produced handoffs and merged knowledge gaps.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
 */
async function verifyPersistedArtifacts(environment, answerMessageIds, outOfScopeConversationIds)
{
    const client = createClient(
        environment.SUPABASE_URL,
        environment.SUPABASE_SERVICE_ROLE_KEY,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        },
    );
    const { data: answerMessages, error: messageError } = await client
        .from("messages")
        .select("id, ai_run_id")
        .in("id", answerMessageIds);

    if (
        messageError !== null
        || answerMessages.length !== answerMessageIds.length
        || answerMessages.some((message) => message.ai_run_id === null)
    )
    {
        throw new Error("A grounded answer is missing its persisted AI run link.");
    }

    const { count: citationCount, error: citationError } = await client
        .from("message_citations")
        .select("id", {
            count: "exact",
            head: true,
        })
        .in("message_id", answerMessageIds);

    if (
        citationError !== null
        || citationCount === null
        || citationCount < answerMessageIds.length
    )
    {
        throw new Error("Persisted grounded answers are missing citations.");
    }

    const { count: handoffCount, error: handoffError } = await client
        .from("handoffs")
        .select("id", {
            count: "exact",
            head: true,
        })
        .in("conversation_id", outOfScopeConversationIds);

    if (
        handoffError !== null
        || handoffCount !== outOfScopeConversationIds.length
    )
    {
        throw new Error("An out-of-scope turn is missing its handoff package.");
    }

    const { count: gapCount, error: gapError } = await client
        .from("knowledge_gaps")
        .select("id", {
            count: "exact",
            head: true,
        })
        .eq("organization_id", "00000000-0000-4000-a000-000000000001")
        .eq("status", "open");

    if (gapError !== null || gapCount === null || gapCount < outOfScopeConversationIds.length)
    {
        throw new Error("Out-of-scope turns did not create their knowledge gaps.");
    }

    return {
        citationCount,
        gapCount,
        handoffCount,
    };
}

/**
 * main
 * ----------------
 * Executes all fixed Day 3 in-scope and out-of-scope cases through the real local Worker and database without live provider cost.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
 */
async function main()
{
    verificationStage = "reading local fixtures and ignored configuration";
    const environment = parseEnvironment(await readFile(resolve(".env.local"), "utf8"));
    const fixture = acceptanceFixtureSchema.parse(JSON.parse(
        await readFile(
            resolve("docs/spec/fixtures/tests/acceptance_cases.json"),
            "utf8",
        ),
    ));
    const inScopeCases = fixture.cases.filter((testCase) => testCase.group === "in_scope");
    const outOfScopeCases = fixture.cases.filter((testCase) => testCase.group === "out_of_scope");
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
        verificationStage = "running twelve fixed grounded-answer cases";
        const inScopeConversation = await createConversation("zh-CN", "198.51.100.10");
        const answerMessageIds = [];

        for (const testCase of inScopeCases)
        {
            const result = await sendQuestion(
                inScopeConversation,
                testCase.question,
                "198.51.100.10",
            );
            assertInScopeResult(testCase, result);
            answerMessageIds.push(result.messageId);
        }

        verificationStage = "checking scoped polling and URL-subject enforcement";
        const poll = await fetch(
            `http://127.0.0.1:8787/api/v1/public/conversations/${inScopeConversation.conversationId}/messages?limit=50`,
            {
                headers: {
                    authorization: `Bearer ${inScopeConversation.conversationToken}`,
                },
            },
        );
        const pollResult = await readJsonResponse(poll, pollResponseSchema, "Message polling");

        if (pollResult.messages.length !== inScopeCases.length)
        {
            throw new Error("Public polling did not return every persisted AI answer.");
        }

        const conditionalPoll = await fetch(
            `http://127.0.0.1:8787/api/v1/public/conversations/${inScopeConversation.conversationId}/messages?after=${encodeURIComponent(pollResult.nextCursor ?? "")}&limit=50`,
            {
                headers: {
                    authorization: `Bearer ${inScopeConversation.conversationToken}`,
                    "if-none-match": poll.headers.get("etag") ?? "",
                },
            },
        );

        if (conditionalPoll.status !== 304)
        {
            throw new Error("Unchanged public polling did not return HTTP 304.");
        }

        const wrongConversation = await fetch(
            `http://127.0.0.1:8787/api/v1/public/conversations/${crypto.randomUUID()}/messages`,
            {
                headers: {
                    authorization: `Bearer ${inScopeConversation.conversationToken}`,
                },
            },
        );

        if (wrongConversation.status !== 401)
        {
            throw new Error("A conversation token was accepted for a different URL subject.");
        }

        verificationStage = "running eight fixed missing-knowledge cases";
        const outOfScopeConversationIds = [];

        for (const [index, testCase] of outOfScopeCases.entries())
        {
            const fixtureIp = `198.51.100.${20 + index}`;
            const conversation = await createConversation(
                testCase.language ?? "zh-CN",
                fixtureIp,
            );
            const result = await sendQuestion(conversation, testCase.question, fixtureIp);
            assertOutOfScopeResult(testCase, result);
            outOfScopeConversationIds.push(conversation.conversationId);
        }

        verificationStage = "checking explicit human handoff";
        const handoffConversation = await createConversation("zh-CN", "198.51.100.40");
        const handoffResponse = await fetch(
            `http://127.0.0.1:8787/api/v1/public/conversations/${handoffConversation.conversationId}/request-handoff`,
            {
                headers: {
                    authorization: `Bearer ${handoffConversation.conversationToken}`,
                    "cf-connecting-ip": "198.51.100.40",
                    "idempotency-key": crypto.randomUUID(),
                },
                method: "POST",
            },
        );

        if (handoffResponse.status !== 202)
        {
            throw new Error("The explicit human handoff endpoint did not return HTTP 202.");
        }

        verificationStage = "verifying persisted audit, citation, handoff, and gap artifacts";
        const counts = await verifyPersistedArtifacts(
            environment,
            answerMessageIds,
            outOfScopeConversationIds,
        );
        process.stdout.write(
            `Day 3 local conversation smoke passed: ${answerMessageIds.length}/12 cited answers, ${counts.handoffCount}/8 missing-knowledge handoffs, ${counts.citationCount} persisted citations, ${counts.gapCount} open gaps.\n`,
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
    console.error(`Day 3 conversation smoke failed while ${verificationStage}.`);
    console.error(error instanceof Error ? error.message : "Unknown local verification error.");

    for (const diagnostic of workerDiagnostics)
    {
        console.error(diagnostic);
    }

    console.error("Tokens, credentials, prompts, and provider response bodies were not displayed.");
    process.exitCode = 1;
}
