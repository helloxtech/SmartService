import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const environmentSchema = z.object({
    DEMO_ADMIN_EMAIL: z.email(),
    DEMO_ADMIN_PASSWORD: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_URL: z.url(),
});

let verificationStage = "initializing";
const workerDiagnostics = [];

/**
 * captureWorkerDiagnostics
 * ----------------
 * Retains only bounded error/event lines from local Wrangler output and never records environment values.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function captureWorkerDiagnostics(chunk)
{
    for (const line of chunk.toString("utf8").split(/\r?\n/u))
    {
        if (
            line.includes("http.request.failed")
            || line.includes("ingestion.queue.failed")
            || line.includes("[ERROR]")
            || line.includes("Uncaught")
        )
        {
            workerDiagnostics.push(line.slice(0, 500));
        }
    }

    while (workerDiagnostics.length > 10)
    {
        workerDiagnostics.shift();
    }
}

/**
 * parseEnvironment
 * ----------------
 * Reads required ignored local values into memory without printing credentials.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
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

        if (name === undefined || serialized === undefined)
        {
            continue;
        }

        values[name] = serialized.trim().replace(/^"(.*)"$/u, "$1");
    }

    return environmentSchema.parse(values);
}

/**
 * waitForWorker
 * ----------------
 * Waits up to 30 seconds for the local Worker health endpoint without printing process output or secrets.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
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
            // The bounded retry loop handles local startup races.
        }

        await new Promise((resolveDelay) =>
        {
            setTimeout(resolveDelay, 500);
        });
    }

    throw new Error("The local Worker did not become healthy.");
}

/**
 * waitForReadySource
 * ----------------
 * Waits for one source row to reach Ready and fails on a surfaced ingestion error.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function waitForReadySource(page, sourceName)
{
    const row = page.locator("li").filter({
        hasText: sourceName,
    }).first();

    for (let attempt = 0; attempt < 120; attempt += 1)
    {
        if (await row.isVisible())
        {
            if (await row.getByText("ready", {
                exact: true,
            }).isVisible())
            {
                return;
            }

            if (await row.getByText("failed", {
                exact: true,
            }).isVisible())
            {
                throw new Error(`Source ${sourceName} entered Failed state.`);
            }
        }

        const status = page.locator('[role="status"]').last();

        if (await status.isVisible())
        {
            const text = (await status.textContent() ?? "").trim();

            if (
                text.length > 0
                && !text.includes("Loading")
                && !text.includes("queued")
                && !text.includes("Extracting")
                && !text.includes("Uploading")
            )
            {
                throw new Error(`Workspace reported: ${text.slice(0, 2_000)}`);
            }
        }

        await new Promise((resolveDelay) =>
        {
            setTimeout(resolveDelay, 500);
        });
    }

    const finalText = (await row.textContent() ?? "").replace(/\s+/gu, " ").trim();
    throw new Error(
        `Source ${sourceName} did not reach Ready within 60 seconds. Row: ${finalText.slice(0, 500)}`,
    );
}

/**
 * verifyDatabaseResults
 * ----------------
 * Confirms three ready tenant sources and non-null embeddings through the ignored local service role.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function verifyDatabaseResults(environment)
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
        .eq("organization_id", "00000000-0000-4000-a000-000000000001")
        .is("deleted_at", null);

    if (
        sourceError !== null
        || sources.length !== 3
        || sources.some((source) => source.status !== "ready" || source.chunk_count <= 0)
    )
    {
        throw new Error("The local source rows did not reach the expected Ready state.");
    }

    const sourceIds = sources.map((source) => source.id);
    const { count, error: chunkError } = await client
        .from("knowledge_chunks")
        .select("id", {
            count: "exact",
            head: true,
        })
        .in("source_id", sourceIds)
        .not("embedding", "is", null)
        .eq("enabled", true);

    if (chunkError !== null || count === null || count <= 0)
    {
        throw new Error("The local ingestion run did not persist enabled embeddings.");
    }

    return {
        chunkCount: count,
        sourceCount: sources.length,
    };
}

/**
 * main
 * ----------------
 * Runs real-browser PDF, DOCX, and URL intake through the local Worker, Queue, R2 binding, Supabase, and mock embeddings.
 *
 * July 27, 2026: Updated by Forrest Zhang for SmartService Day 5 Navigation Regression
 */
async function main()
{
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
    let browser;

    try
    {
        await waitForWorker();
        verificationStage = "opening the real browser";
        browser = await chromium.launch({
            headless: true,
        });
        const page = await browser.newPage({
            viewport: {
                height: 1100,
                width: 1500,
            },
        });
        await page.goto("http://127.0.0.1:8787", {
            waitUntil: "networkidle",
        });
        await page.getByLabel("Email").fill(environment.DEMO_ADMIN_EMAIL);
        await page.getByLabel("Password").fill(environment.DEMO_ADMIN_PASSWORD);
        await page.getByRole("button", {
            name: "Sign in",
        }).click();
        await page.getByRole("link", {
            exact: true,
            name: "Knowledge",
        }).click();
        await expect(page.getByRole("heading", {
            name: "Knowledge",
        })).toBeVisible({
            timeout: 20_000,
        });
        const extractButton = page.getByRole("button", {
            name: "Extract and upload",
        });

        verificationStage = "ingesting the real PDF fixture";
        await page.locator('input[type="file"]').setInputFiles(resolve(
            "docs/spec/fixtures/generated/ingestion/novaflow-nf-series-manual.pdf",
        ));
        await extractButton.click();
        await expect(page.getByText("Document queued for chunking and embedding.")).toBeVisible({
            timeout: 30_000,
        });
        await waitForReadySource(page, "novaflow-nf-series-manual.pdf");

        verificationStage = "ingesting the real DOCX fixture";
        await page.locator('input[type="file"]').setInputFiles(resolve(
            "docs/spec/fixtures/generated/ingestion/novaflow-support-faq.docx",
        ));
        await expect(extractButton).toBeEnabled({
            timeout: 10_000,
        });
        await extractButton.click();
        await waitForReadySource(page, "novaflow-support-faq.docx");

        verificationStage = "ingesting the bounded URL fixture";
        await page.getByLabel("Website URL").fill("https://example.com");
        await page.getByRole("button", {
            name: "Validate and crawl",
        }).click();
        await waitForReadySource(page, "example.com");

        verificationStage = "verifying disable and enable semantics";
        const websiteRow = page.locator("li").filter({
            hasText: "example.com",
        }).first();
        await websiteRow.getByRole("button", {
            name: "Disable",
        }).click();
        await expect(websiteRow.getByText("disabled", {
            exact: true,
        })).toBeVisible({
            timeout: 20_000,
        });
        await websiteRow.getByRole("button", {
            name: "Enable",
        }).click();
        await expect(websiteRow.getByText("ready", {
            exact: true,
        })).toBeVisible({
            timeout: 20_000,
        });

        verificationStage = "checking persisted tenant data";
        const counts = await verifyDatabaseResults(environment);
        await page.screenshot({
            fullPage: true,
            path: "/tmp/smartservice-day2-knowledge.png",
        });
        verificationStage = "checking the mobile knowledge layout";
        await page.setViewportSize({
            height: 844,
            width: 390,
        });
        await expect(page.getByRole("heading", {
            name: "Knowledge",
        })).toBeVisible();
        const horizontalOverflow = await page.evaluate(() =>
        {
            return globalThis.document.documentElement.scrollWidth
                - globalThis.document.documentElement.clientWidth;
        });

        if (horizontalOverflow > 1)
        {
            throw new Error("The mobile knowledge workspace has horizontal overflow.");
        }

        await page.screenshot({
            fullPage: true,
            path: "/tmp/smartservice-day2-knowledge-mobile.png",
        });
        process.stdout.write(
            `Day 2 local ingestion smoke passed: ${counts.sourceCount} sources, ${counts.chunkCount} embedded chunks.\n`,
        );
    }
    finally
    {
        if (browser !== undefined)
        {
            await browser.close();
        }

        worker.kill("SIGTERM");
    }
}

try
{
    await main();
}
catch (error)
{
    console.error(`Day 2 ingestion smoke failed while ${verificationStage}.`);
    console.error(error instanceof Error ? error.message : "Unknown local verification error.");

    for (const diagnostic of workerDiagnostics)
    {
        console.error(diagnostic);
    }

    console.error("Credentials and provider response bodies were not displayed.");
    process.exitCode = 1;
}
