import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const baseUrl = process.env.SMARTSERVICE_HOSTED_URL
    ?? "https://smartservice-dev.hurryupgo-b2d.workers.dev";
const hostedDemoPublicKeys = [
    "smart-service-public-demo",
    "xflow-public-demo",
    "novaflow-public-demo",
] as const;
const organizationId = "00000000-0000-4000-a000-000000000001";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const environmentFile = process.env.SMARTSERVICE_ENV_FILE
    ?? resolve(repositoryRoot, ".env.local");

const environmentSchema = z.object({
    DEMO_ADMIN_EMAIL: z.email(),
    DEMO_ADMIN_PASSWORD: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    SUPABASE_URL: z.url(),
});

const createResponseSchema = z.object({
    conversationId: z.uuid(),
    conversationToken: z.string().min(32),
});

const publicErrorResponseSchema = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
    }),
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
    decision: z.enum(["acknowledge", "answer", "clarify", "handoff"]),
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
    SUPABASE_SERVICE_ROLE_KEY?: string;
    SUPABASE_URL: string;
}

interface HostedQuestionCase
{
    expectedDecision: "answer" | "clarify";
    expectedFact?: string;
    language: "en" | "zh-CN";
    question: string;
}

/**
 * parseEnvironment
 * ----------------
 * Reads the ignored local environment file into validated nonprinted hosted verification settings, allowing explicit process environment overrides for hosted checks.
 *
 * July 31, 2026: Updated by Forrest Zhang for Hosted DEV UAT
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

    for (const name of Object.keys(environmentSchema.shape))
    {
        const override = process.env[name];

        if (override !== undefined && override.length > 0)
        {
            values[name] = override;
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
async function verifyKnowledgeState(environment: Environment): Promise<"counted" | "skipped">
{
    if (environment.SUPABASE_SERVICE_ROLE_KEY === undefined)
    {
        return "skipped";
    }

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

    if (sourceError !== null)
    {
        if (sourceError.message.toLocaleLowerCase().includes("invalid api key"))
        {
            return "skipped";
        }

        throw new Error("Hosted DEV ready fictional knowledge lookup failed.");
    }

    if (sources === null || sources.length < 3 || sources.some((source) => source.chunk_count <= 0))
    {
        throw new Error("Hosted DEV does not have the expected ready fictional knowledge sources.");
    }

    return "counted";
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
    let conversation: z.infer<typeof createResponseSchema> | null = null;

    for (const publicKey of hostedDemoPublicKeys)
    {
        const create = await fetch(`${baseUrl}/api/v1/public/conversations`, {
            body: JSON.stringify({
                channel: "text",
                customer: {
                    language: testCase.language,
                },
                publicKey,
                turnstileToken: "local-demo-turnstile",
            }),
            headers: {
                "content-type": "application/json",
                "idempotency-key": crypto.randomUUID(),
            },
            method: "POST",
        });
        const createPayload: unknown = await create.json();

        if (create.ok)
        {
            conversation = createResponseSchema.parse(createPayload);
            break;
        }

        const parsedError = publicErrorResponseSchema.safeParse(createPayload);

        if (create.status !== 404 || parsedError.data?.error.code !== "WIDGET_NOT_FOUND")
        {
            throw new Error(`Hosted conversation creation failed with HTTP ${create.status}.`);
        }
    }

    if (conversation === null)
    {
        throw new Error("Hosted conversation creation failed for every configured demo public key.");
    }

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
 * Verifies one hosted UAT question for the expected cited answer or AI-active clarification behavior.
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
        result.decision !== "clarify"
        || result.handoff !== null
        || result.citations.length !== 0
        || /requested human support|已将问题转交/u.test(result.answer)
    )
    {
        throw new Error(`Hosted question did not remain AI-active with a safe clarification: ${JSON.stringify({
            answer: result.answer,
            citationCount: result.citations.length,
            decision: result.decision,
            handoff: result.handoff,
            question: testCase.question,
        })}`);
    }
}

/**
 * main
 * ----------------
 * Runs a bounded hosted DEV smoke covering static routing, ready knowledge, cited answers, and a non-terminal missing-knowledge clarification.
 *
 * July 28, 2026: Created by Forrest Zhang for Hosted DEV UAT
 */
async function main(): Promise<void>
{
    const environment = parseEnvironment(await readFile(environmentFile, "utf8"));
    const cases: HostedQuestionCase[] = [
        {
            expectedDecision: "answer",
            language: "en",
            question: "Which music courses do you provide?",
        },
        {
            expectedDecision: "answer",
            expectedFact: "Canada YC Music Academy",
            language: "zh-CN",
            question: "请问你们音乐学校的名字是什么？",
        },
        {
            expectedDecision: "answer",
            expectedFact: "40",
            language: "zh-CN",
            question: "古筝课程要上多久？",
        },
        {
            expectedDecision: "clarify",
            language: "en",
            question: "Does the QA-500 course include lunar-campus lodging?",
        },
    ];

    await verifyRoutes();
    await verifyRuntimePublicConfiguration(environment);
    const knowledgeState = await verifyKnowledgeState(environment);

    for (const testCase of cases)
    {
        await verifyQuestionCase(testCase);
    }

    process.stdout.write(
        `Hosted DEV smoke passed: routes, health, runtime Supabase sign-in, ${
            knowledgeState === "counted"
                ? "ready fictional knowledge count"
                : "public cited-answer knowledge proof"
        }, 3/3 cited answers, and 1/1 AI-active safe clarification.\n`,
    );
}

await main();
