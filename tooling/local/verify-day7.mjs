import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

const environmentSchema = z.object({
    VOICE_INTERNAL_SERVICE_TOKEN: z.string().min(32),
});

const fixtureSchema = z.object({
    cases: z.array(z.object({
        id: z.string().min(1),
        language: z.enum(["zh-CN", "en"]),
        question: z.string().min(1),
    })).length(10),
});

const conversationSchema = z.object({
    conversationId: z.uuid(),
    conversationToken: z.string().min(32),
});

const citationSchema = z.object({
    citationId: z.uuid(),
    label: z.string().min(1),
    sourceType: z.enum(["pdf", "docx", "url", "manual"]),
    sourceUrl: z.string().nullable(),
    supportingExcerpt: z.string().min(1),
});

const answerSchema = z.object({
    answer: z.string().min(1),
    citations: z.array(citationSchema),
    decision: z.enum(["answer", "clarify", "handoff"]),
    handoff: z.object({
        reason: z.string(),
        status: z.literal("handoff_requested"),
    }).nullable(),
    messageId: z.uuid(),
});

const voiceAnswerSchema = answerSchema.extend({
    spokenText: z.string().min(1).max(500),
});

const voiceTokenSchema = z.object({
    provider: z.literal("mock"),
    voiceSessionId: z.uuid(),
}).passthrough();

const pollSchema = z.object({
    messages: z.array(z.object({
        citations: z.array(citationSchema),
        messageId: z.uuid(),
        text: z.string().min(1),
    }).passthrough()),
    nextCursor: z.string().nullable(),
    status: z.string(),
});

let verificationStage = "initializing";
const workerDiagnostics = [];

/**
 * parseEnvironment
 * ----------------
 * Reads the ignored local Agent token into memory without printing it.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 7 Local Verification
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
 * Retains bounded error-only Worker diagnostics without prompts, answers, tokens, or provider payloads.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 7 Local Verification
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
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 7 Local Verification
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
 * Parses one successful response and reports only status plus stable error code for failures.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 7 Local Verification
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
 * Creates one isolated text or voice conversation through the real local public boundary.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 7 Local Verification
 */
async function createConversation(channel, language, fixtureIp)
{
    const response = await fetch("http://127.0.0.1:8787/api/v1/public/conversations", {
        body: JSON.stringify({
            channel,
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
    });

    return readJson(response, conversationSchema, `${channel} conversation creation`);
}

/**
 * issueVoiceToken
 * ----------------
 * Creates the tenant-bound local room token for one scoped voice conversation.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 7 Local Verification
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
 * completeVoiceTurn
 * ----------------
 * Sends one final transcript through the Agent-authenticated shared RAG and guardrail path.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 7 Local Verification
 */
async function completeVoiceTurn(environment, voiceSessionId, question)
{
    const response = await fetch(
        `http://127.0.0.1:8787/api/v1/internal/voice/sessions/${voiceSessionId}/turns`,
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

    return readJson(response, voiceAnswerSchema, "Voice answer");
}

/**
 * completeTextTurn
 * ----------------
 * Sends the same question through the public text path for exact shared-result comparison.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 7 Local Verification
 */
async function completeTextTurn(conversation, question, fixtureIp)
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

    return readJson(response, answerSchema, "Text answer");
}

/**
 * pollVoiceAnswer
 * ----------------
 * Reads the public screen payload and verifies the approved answer and citations are available without the audio channel.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 7 Local Verification
 */
async function pollVoiceAnswer(conversation)
{
    const response = await fetch(
        `http://127.0.0.1:8787/api/v1/public/conversations/${conversation.conversationId}/messages?limit=50`,
        {
            headers: {
                authorization: `Bearer ${conversation.conversationToken}`,
            },
        },
    );

    return readJson(response, pollSchema, "Voice answer polling");
}

/**
 * citationSignature
 * ----------------
 * Produces a stable public citation comparison without using internal database or chunk identifiers.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 7 Local Verification
 */
function citationSignature(citations)
{
    return citations
        .map((citation) => `${citation.sourceType}|${citation.label}|${citation.supportingExcerpt}`)
        .sort()
        .join("\n");
}

/**
 * assertSpeechSafe
 * ----------------
 * Enforces the one-to-two sentence speech boundary and blocks URLs, UUIDs, and serialized JSON from TTS input.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 7 Local Verification
 */
function assertSpeechSafe(testCase, spokenText)
{
    const terminators = spokenText.match(/[。！？.!?]+/gu)?.length ?? 1;

    if (
        terminators > 2
        || /https?:\/\//iu.test(spokenText)
        || /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu.test(spokenText)
        || /[{}[\]]/u.test(spokenText)
    )
    {
        throw new Error(`${testCase.id} produced unsafe or overlong speech text.`);
    }
}

/**
 * main
 * ----------------
 * Runs five Chinese and five English parity cases plus missing-knowledge safety with zero live-provider cost.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 7 Local Verification
 */
async function main()
{
    verificationStage = "reading ignored configuration and fixed voice RAG cases";
    const environment = parseEnvironment(await readFile(resolve(".env.local"), "utf8"));
    const fixture = fixtureSchema.parse(JSON.parse(
        await readFile(
            resolve("docs/spec/fixtures/tests/voice_rag_cases.json"),
            "utf8",
        ),
    ));
    const languageCounts = fixture.cases.reduce((counts, testCase) =>
    {
        counts[testCase.language] += 1;
        return counts;
    }, {
        "en": 0,
        "zh-CN": 0,
    });

    if (languageCounts["zh-CN"] !== 5 || languageCounts.en !== 5)
    {
        throw new Error("The fixed Day 7 set must contain five Chinese and five English cases.");
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

        for (const [index, testCase] of fixture.cases.entries())
        {
            verificationStage = `running shared text and voice case ${testCase.id}`;
            const voiceConversation = await createConversation(
                "voice",
                testCase.language,
                `198.51.100.${80 + index * 2}`,
            );
            const voiceToken = await issueVoiceToken(voiceConversation);
            const voiceAnswer = await completeVoiceTurn(
                environment,
                voiceToken.voiceSessionId,
                testCase.question,
            );
            const textConversation = await createConversation(
                "text",
                testCase.language,
                `198.51.100.${81 + index * 2}`,
            );
            const textAnswer = await completeTextTurn(
                textConversation,
                testCase.question,
                `198.51.100.${81 + index * 2}`,
            );

            if (
                voiceAnswer.decision !== "answer"
                || voiceAnswer.citations.length === 0
                || voiceAnswer.answer !== textAnswer.answer
                || citationSignature(voiceAnswer.citations) !== citationSignature(textAnswer.citations)
            )
            {
                throw new Error(`${testCase.id} did not preserve the shared text/voice grounded result.`);
            }

            assertSpeechSafe(testCase, voiceAnswer.spokenText);
            const publicMessages = await pollVoiceAnswer(voiceConversation);
            const displayed = publicMessages.messages.find(
                (message) => message.messageId === voiceAnswer.messageId,
            );

            if (
                displayed?.text !== voiceAnswer.answer
                || citationSignature(displayed.citations) !== citationSignature(voiceAnswer.citations)
            )
            {
                throw new Error(`${testCase.id} did not expose the approved answer and citations to the screen.`);
            }
        }

        verificationStage = "checking safe missing-knowledge voice behavior";
        const missingConversation = await createConversation(
            "voice",
            "en",
            "198.51.100.120",
        );
        const missingToken = await issueVoiceToken(missingConversation);
        const missingAnswer = await completeVoiceTurn(
            environment,
            missingToken.voiceSessionId,
            "Is the NF-500 certified for marine use in Norway?",
        );

        if (
            missingAnswer.decision !== "handoff"
            || missingAnswer.handoff?.reason !== "missing_knowledge"
            || missingAnswer.citations.length !== 0
        )
        {
            throw new Error("Missing voice knowledge did not fail safely to handoff.");
        }

        assertSpeechSafe({
            id: "VR-MISSING",
        }, missingAnswer.spokenText);
        process.stdout.write(
            "Day 7 local smoke passed: 5/5 Chinese + 5/5 English grounded voice answers, exact text/voice citation parity, screen citations, safe missing knowledge, bounded TTS text, no provider cost.\n",
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
    console.error(`Day 7 local smoke failed while ${verificationStage}.`);
    console.error(error instanceof Error ? error.message : "Unknown local verification error.");

    for (const diagnostic of workerDiagnostics)
    {
        console.error(diagnostic);
    }

    console.error("Credentials, prompts, answers, transcripts, and provider bodies were not displayed.");
    process.exitCode = 1;
}
