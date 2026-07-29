import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
    extractedKnowledgePayloadSchema,
    type ExtractedKnowledgePayload,
    type ExtractedSection,
    type KnowledgeIngestMessage,
} from "../../packages/contracts/src/index";
import {
    calculateStandardPages,
    DeterministicEmbeddingProvider,
    processIngestionMessage,
} from "../../packages/ingestion/src/index";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { SupabaseKnowledgeRepository } from "../../apps/api/src/repository";
import type { CreateIntakeInput } from "../../apps/api/src/types";

const organizationId = "00000000-0000-4000-a000-000000000001";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");

const environmentSchema = z.object({
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_URL: z.url(),
});

interface Environment
{
    SUPABASE_SERVICE_ROLE_KEY: string;
    SUPABASE_URL: string;
}

interface SourceFixture
{
    createPayload(): Promise<ExtractedKnowledgePayload>;
    extractedObjectKey: string | null;
    idempotencyKey: string;
    name: string;
    originalObjectKey: string | null;
    pageCount: number | null;
    sourceType: CreateIntakeInput["sourceType"];
    sourceUrl: string | null;
}

/**
 * parseEnvironment
 * ----------------
 * Reads the ignored local environment file into validated nonprinted hosted connection settings.
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
 * parseMarkdownSections
 * ----------------
 * Converts a trusted fixture Markdown document into heading-scoped extracted sections for the shared ingestion planner.
 *
 * July 28, 2026: Created by Forrest Zhang for Hosted DEV UAT
 */
function parseMarkdownSections(input: string): ExtractedSection[]
{
    const sections: ExtractedSection[] = [];
    let heading = "Overview";
    let lines: string[] = [];

    for (const line of input.split(/\r?\n/u))
    {
        const headingMatch = /^##+\s+(.+)$/u.exec(line);

        if (headingMatch !== null)
        {
            const text = lines.join("\n").trim();

            if (text.length > 0)
            {
                sections.push({
                    heading,
                    text,
                });
            }

            heading = headingMatch[1] ?? "Section";
            lines = [];
            continue;
        }

        if (!/^#\s+/u.test(line))
        {
            lines.push(line);
        }
    }

    const text = lines.join("\n").trim();

    if (text.length > 0)
    {
        sections.push({
            heading,
            text,
        });
    }

    return sections;
}

/**
 * createMarkdownPayload
 * ----------------
 * Builds one deterministic extracted payload from an approved fictional Markdown fixture.
 *
 * July 28, 2026: Created by Forrest Zhang for Hosted DEV UAT
 */
async function createMarkdownPayload(input: {
    fileName: string;
    path: string;
    pageCount: number;
    sourceType: "pdf" | "docx";
    title: string;
}): Promise<ExtractedKnowledgePayload>
{
    const content = await readFile(resolve(repositoryRoot, input.path), "utf8");
    const sections = parseMarkdownSections(content);
    const standardPageCount = calculateStandardPages(
        sections.map((section) => section.text).join("\n\n"),
    );

    return extractedKnowledgePayloadSchema.parse({
        documents: [{
            sections,
            title: input.title,
        }],
        fileName: input.fileName,
        pageCount: input.pageCount,
        schemaVersion: 1,
        sourceType: input.sourceType,
        standardPageCount,
        title: input.title,
    });
}

/**
 * createWebsitePayload
 * ----------------
 * Builds the bounded same-origin demo website payload used for hosted mock-provider UAT.
 *
 * July 28, 2026: Created by Forrest Zhang for Hosted DEV UAT
 */
function createWebsitePayload(): ExtractedKnowledgePayload
{
    return extractedKnowledgePayloadSchema.parse({
        documents: [
            {
                canonicalUrl: "https://example.com/products",
                sections: [{
                    heading: "NF-Series Products",
                    text: "NF-200 and NF-500 are for compatible non-potable, non-flammable industrial liquids.",
                }],
                title: "NF-Series Products",
            },
            {
                canonicalUrl: "https://example.com/support",
                sections: [{
                    heading: "Support",
                    text: "NovaFlow support can help with troubleshooting, warranty routing, and safe escalation when approved knowledge is insufficient.",
                }],
                title: "NovaFlow Support",
            },
        ],
        schemaVersion: 1,
        sourceType: "url",
        standardPageCount: 0.02,
        title: "example.com",
    });
}

/**
 * getAdminUserId
 * ----------------
 * Finds one active NovaFlow Admin user id so hosted fixture sources keep an auditable creator.
 *
 * July 28, 2026: Created by Forrest Zhang for Hosted DEV UAT
 */
async function getAdminUserId(environment: Environment): Promise<string>
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
    const { data, error } = await client
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", organizationId)
        .eq("role", "admin")
        .eq("is_active", true)
        .limit(1);

    if (error !== null || data === null || data.length !== 1)
    {
        throw new Error("No active NovaFlow Admin membership was found for hosted fixture seeding.");
    }

    const userId = data[0]?.user_id;

    if (typeof userId !== "string" || userId.length === 0)
    {
        throw new Error("The NovaFlow Admin membership did not contain a valid user id.");
    }

    return userId;
}

/**
 * getSourceFixtures
 * ----------------
 * Returns the fixed fictional source set used to make hosted DEV usable for UAT without real customer data.
 *
 * July 28, 2026: Created by Forrest Zhang for Hosted DEV UAT
 */
function getSourceFixtures(): SourceFixture[]
{
    return [
        {
            createPayload: () => createMarkdownPayload({
                fileName: "novaflow-nf-series-manual.pdf",
                pageCount: 5,
                path: "docs/spec/fixtures/knowledge/demo_company_product_manual.md",
                sourceType: "pdf",
                title: "NovaFlow NF-Series Product Manual",
            }),
            extractedObjectKey: `org/${organizationId}/hosted-fixtures/extracted/novaflow-nf-series-manual.json`,
            idempotencyKey: "hosted-dev-fixture-product-manual-v1",
            name: "novaflow-nf-series-manual.pdf",
            originalObjectKey: `org/${organizationId}/hosted-fixtures/original/novaflow-nf-series-manual.pdf`,
            pageCount: 5,
            sourceType: "pdf",
            sourceUrl: null,
        },
        {
            createPayload: () => createMarkdownPayload({
                fileName: "novaflow-support-faq.docx",
                pageCount: 3,
                path: "docs/spec/fixtures/knowledge/demo_company_faq.md",
                sourceType: "docx",
                title: "NovaFlow Support FAQ",
            }),
            extractedObjectKey: `org/${organizationId}/hosted-fixtures/extracted/novaflow-support-faq.json`,
            idempotencyKey: "hosted-dev-fixture-support-faq-v1",
            name: "novaflow-support-faq.docx",
            originalObjectKey: `org/${organizationId}/hosted-fixtures/original/novaflow-support-faq.docx`,
            pageCount: 3,
            sourceType: "docx",
            sourceUrl: null,
        },
        {
            createPayload: async () => createWebsitePayload(),
            extractedObjectKey: null,
            idempotencyKey: "hosted-dev-fixture-example-com-v1",
            name: "example.com",
            originalObjectKey: null,
            pageCount: null,
            sourceType: "url",
            sourceUrl: "https://example.com",
        },
    ];
}

/**
 * seedSource
 * ----------------
 * Creates or reuses one hosted fixture intake and processes it through the shared deterministic ingestion pipeline.
 *
 * July 28, 2026: Created by Forrest Zhang for Hosted DEV UAT
 */
async function seedSource(
    environment: Environment,
    adminUserId: string,
    fixture: SourceFixture,
): Promise<string>
{
    const repository = new SupabaseKnowledgeRepository(environment);
    const payload = await fixture.createPayload();
    const intake = await repository.createIntake({
        crawlMaxDepth: fixture.sourceType === "url" ? 1 : null,
        crawlMaxPages: fixture.sourceType === "url" ? 3 : null,
        createdBy: adminUserId,
        extractedObjectKey: fixture.extractedObjectKey,
        idempotencyKey: fixture.idempotencyKey,
        name: fixture.name,
        organizationId,
        originalObjectKey: fixture.originalObjectKey,
        pageCount: fixture.pageCount,
        requestId: `hosted-dev-seed-${fixture.idempotencyKey}`,
        sourceType: fixture.sourceType,
        sourceUrl: fixture.sourceUrl,
        standardPageCount: payload.standardPageCount,
    });
    const message: KnowledgeIngestMessage = {
        idempotencyKey: fixture.idempotencyKey,
        jobId: intake.jobId,
        organizationId,
        sourceId: intake.sourceId,
        type: "knowledge.ingest",
        version: 1,
    };

    if (fixture.extractedObjectKey !== null)
    {
        message.inputObjectKey = fixture.extractedObjectKey;
    }

    return processIngestionMessage(message, {
        embeddings: new DeterministicEmbeddingProvider(),
        payloads: {
            /**
             * load
             * ----------------
             * Supplies the already validated fixture payload without reading storage or network content.
             *
             * July 28, 2026: Created by Forrest Zhang for Hosted DEV UAT
             */
            async load(): Promise<ExtractedKnowledgePayload>
            {
                return payload;
            },
        },
        repository,
    });
}

/**
 * summarizeKnowledge
 * ----------------
 * Reads bounded source and chunk counts after hosted fixture processing without exposing source content.
 *
 * July 28, 2026: Created by Forrest Zhang for Hosted DEV UAT
 */
async function summarizeKnowledge(environment: Environment): Promise<{
    chunkCount: number;
    readySourceCount: number;
}>
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

    if (sourceError !== null || sources === null)
    {
        throw new Error("Hosted knowledge source summary failed.");
    }

    const { count, error: chunkError } = await client
        .from("knowledge_chunks")
        .select("id", {
            count: "exact",
            head: true,
        })
        .eq("organization_id", organizationId)
        .eq("enabled", true)
        .not("embedding", "is", null);

    if (chunkError !== null || count === null)
    {
        throw new Error("Hosted knowledge chunk summary failed.");
    }

    return {
        chunkCount: count,
        readySourceCount: sources.length,
    };
}

/**
 * main
 * ----------------
 * Seeds hosted DEV with fictional approved NovaFlow knowledge for mock-provider UAT smoke testing.
 *
 * July 28, 2026: Created by Forrest Zhang for Hosted DEV UAT
 */
async function main(): Promise<void>
{
    const environment = parseEnvironment(await readFile(resolve(repositoryRoot, ".env.local"), "utf8"));
    const adminUserId = await getAdminUserId(environment);
    const results: string[] = [];

    for (const fixture of getSourceFixtures())
    {
        results.push(await seedSource(environment, adminUserId, fixture));
    }

    const summary = await summarizeKnowledge(environment);

    process.stdout.write(
        `Hosted demo knowledge ready: ${summary.readySourceCount} ready sources, ${summary.chunkCount} embedded chunks. Pipeline results: ${results.join(", ")}.\n`,
    );
}

await main();
