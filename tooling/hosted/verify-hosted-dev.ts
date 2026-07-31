import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const baseUrl = process.env.SMARTSERVICE_HOSTED_URL
    ?? "https://smartservice-dev.hurryupgo-b2d.workers.dev";
const organizationId = "00000000-0000-4000-a000-000000000001";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");

const environmentSchema = z.object({
    DEMO_ADMIN_EMAIL: z.email(),
    DEMO_ADMIN_PASSWORD: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_URL: z.url(),
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
    error: z.object({
        code: z.string(),
        message: z.string(),
    }).optional(),
    handoff: z.object({
        reason: z.string(),
        status: z.literal("handoff_requested"),
    }).nullable(),
    messageId: z.uuid(),
});

const publicConfigurationResponseSchema = z.object({
    supabaseAnonKey: z.string().min(1).nullable(),
    supabaseUrl: z.url().nullable(),
});

interface Environment
{
    DEMO_ADMIN_EMAIL: string;
    DEMO_ADMIN_PASSWORD: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    SUPABASE_URL: string;
}

interface HostedQuestionCase
{
    expectedDecision: "answer" | "handoff";
    expectedFact?: string;
    language: "en" | "zh-CN";
    question: string;
}

/**
 * parseEnvironment
 * ----------------
 * Reads the ignored local environment file into validated nonprinted hosted verification settings.
 *
 * July 28, 2026: Created by Forrest Zhang for Hosted DEV UAT
 */
function parseEnvironment(text: string): Environment
{
    const values: Record<string, string> = {};

    for (const line of text.split(/\r?\n/u))
    {
        const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);

        if (match === null)
        {
            continue;
        }

        const name = match[1];
        const value = match[2];

        if (name !== undefined && value !== undefined)
        {
            values[name] = value.trim().replace(/^"(.*)"$/u, "$1");
        }
    }

    return environmentSchema.parse(values);
}

/**
 * verifyRoutes
 * ----------------
 * Confirms hosted static and API routes respond from the deployed single-origin Worker.
 *
 * July 28, 2026: Created by Forrest Zhang for Hosted DEV UAT
 */
async function verifyRoutes(): Promise<void>
{
    for (const path of ["/", "/chat", "/app/gaps"])
    {
        const response = await fetch(`${baseUrl}${path}`);
        const text = await response.text();

        if (!response.ok || !text.includes("<div id=\"root\">"))
        {
            throw new Error(`Hosted route ${path} did not return the React shell.`);
        }
    }

    const health = await fetch(`${baseUrl}/health`);
    const healthText = await health.text();

    if (!health.ok || !healthText.includes("\"status\":\"ok\""))
    {
        throw new Error("Hosted health check did not return ok.");
    }
}

/**
 * verifyRuntimePublicConfiguration
 * ----------------
 * Confirms the deployed Worker supplies browser-safe Supabase configuration and that the anon-key path can sign in.
 *
 * July 29, 2026: Created by Forrest Zhang for hosted DEV Supabase sign-in regression coverage
 */
async function verifyRuntimePublicConfiguration(environment: Environment): Promise<void>
{
    const response = await fetch(`${baseUrl}/api/public-config`);

    if (!response.ok)
    {
        throw new Error("Hosted runtime public configuration endpoint did not return ok.");
    }

    const configuration = publicConfigurationResponseSchema.parse(await response.json());

    if (
        configuration.supabaseUrl !== environment.SUPABASE_URL
        || configuration.supabaseAnonKey === null
    )
    {
        throw new Error("Hosted runtime public configuration is missing Supabase browser settings.");
    }

    const client = createClient(configuration.supabaseUrl, configuration.supabaseAnonKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
    const { data: authData, error: authError } = await client.auth.signInWithPassword({
        email: environment.DEMO_ADMIN_EMAIL,
        password: environment.DEMO_ADMIN_PASSWORD,
    });

    if (authError !== null || authData.user === null)
    {
        throw new Error("Hosted runtime Supabase browser configuration could not sign in the demo Admin.");
    }

    const { data: membership, error: membershipError } = await client
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", authData.user.id)
        .eq("is_active", true)
        .single();

    await client.auth.signOut();

    if (
        membershipError !== null
        || membership === null
        || membership.organization_id !== organizationId
        || membership.role !== "admin"
    )
    {
        throw new Error("Hosted runtime Supabase browser configuration did not load the expected Admin membership.");
    }
}

/**
 * verifyKnowledgeState
 * ----------------
 * Confirms hosted DEV contains ready fictional knowledge before asking grounded questions.
 *
 * July 28, 2026: Created by Forrest Zhang for Hosted DEV UAT
 */
async function verifyKnowledgeState(environment: Environment): Promise<void>
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
    const { data: sources, error: sourceError } = await client
        .from("knowledge_sources")
        .select("id, status, chunk_count")
        .eq("organization_id", organizationId)
        .eq("status", "ready")
        .eq("enabled", true)
        .is("deleted_at", null);

    if (
        sourceError !== null
        || sources === null
        || sources.length < 3
        || sources.some((source) => source.chunk_count <= 0)
    )
    {
        throw new Error("Hosted DEV does not have the expected ready fictional knowledge sources.");
    }
}

/**
 * sendHostedQuestion
 * ----------------
 * Starts one scoped hosted public conversation and sends one UAT question without printing bearer tokens.
 *
 * July 28, 2026: Created by Forrest Zhang for Hosted DEV UAT
 */
async function sendHostedQuestion(testCase: HostedQuestionCase): Promise<z.infer<typeof sendResponseSchema>>
{
    const create = await fetch(`${baseUrl}/api/v1/public/conversations`, {
        body: JSON.stringify({
            channel: "text",
            customer: {
                language: testCase.language,
            },
            publicKey: "smart-service-public-demo",
            turnstileToken: "local-demo-turnstile",
        }),
        headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
        },
        method: "POST",
    });
    const createPayload = await create.json();

    if (!create.ok)
    {
        throw new Error(`Hosted conversation creation failed with HTTP ${create.status}.`);
    }

    const conversation = createResponseSchema.parse(createPayload);
    const send = await fetch(
        `${baseUrl}/api/v1/public/conversations/${conversation.conversationId}/messages`,
        {
            body: JSON.stringify({
                clientMessageId: crypto.randomUUID(),
                text: testCase.question,
            }),
            headers: {
                authorization: `Bearer ${conversation.conversationToken}`,
                "content-type": "application/json",
            },
            method: "POST",
        },
    );
    const sendPayload = await send.json();

    if (!send.ok)
    {
        throw new Error(`Hosted message send failed with HTTP ${send.status}.`);
    }

    return sendResponseSchema.parse(sendPayload);
}

/**
 * verifyQuestionCase
 * ----------------
 * Verifies one hosted UAT question for the expected answer or safe handoff behavior.
 *
 * July 28, 2026: Created by Forrest Zhang for Hosted DEV UAT
 */
async function verifyQuestionCase(testCase: HostedQuestionCase): Promise<void>
{
    const result = await sendHostedQuestion(testCase);

    if (testCase.expectedDecision === "answer")
    {
        if (result.decision !== "answer" || result.citations.length === 0)
        {
            throw new Error(`Hosted question did not return a cited answer: ${testCase.question}`);
        }

        if (
            testCase.expectedFact !== undefined
            && !result.answer.toLocaleLowerCase().includes(testCase.expectedFact.toLocaleLowerCase())
        )
        {
            throw new Error(`Hosted cited answer omitted expected fact: ${testCase.expectedFact}`);
        }

        return;
    }

    if (
        result.decision !== "handoff"
        || result.handoff?.reason !== "missing_knowledge"
        || result.citations.length !== 0
    )
    {
        throw new Error(`Hosted question did not fail closed to missing-knowledge handoff: ${testCase.question}`);
    }
}

/**
 * main
 * ----------------
 * Runs a bounded hosted DEV smoke covering static routing, ready knowledge, cited answers, and safe handoff.
 *
 * July 28, 2026: Created by Forrest Zhang for Hosted DEV UAT
 */
async function main(): Promise<void>
{
    const environment = parseEnvironment(await readFile(resolve(repositoryRoot, ".env.local"), "utf8"));
    const cases: HostedQuestionCase[] = [
        {
            expectedDecision: "answer",
            expectedFact: "380",
            language: "en",
            question: "What voltage does the NF-500 require?",
        },
        {
            expectedDecision: "answer",
            expectedFact: "120",
            language: "zh-CN",
            question: "NF-200 最大流量是多少？",
        },
        {
            expectedDecision: "handoff",
            language: "en",
            question: "Can you confirm the stock quantity in your Vancouver warehouse?",
        },
    ];

    await verifyRoutes();
    await verifyRuntimePublicConfiguration(environment);
    await verifyKnowledgeState(environment);

    for (const testCase of cases)
    {
        await verifyQuestionCase(testCase);
    }

    process.stdout.write(
        "Hosted DEV smoke passed: routes, health, runtime Supabase sign-in, ready fictional knowledge, 2/2 cited answers, and 1/1 safe handoff.\n",
    );
}

await main();
