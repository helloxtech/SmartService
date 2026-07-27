import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { z } from "zod";

const execFileAsync = promisify(execFile);
const releaseVersion = "0.10.0";

const demoReportSchema = z.object({
    environment: z.literal("local_deterministic"),
    providerCalls: z.literal(0),
    releaseVersion: z.literal(releaseVersion),
    runs: z.array(z.object({
        case: z.enum(["diagnostic", "calibration", "replacement"]),
        freshDatabase: z.literal(true),
        result: z.literal("passed"),
        run: z.number().int().min(1).max(3),
    }).passthrough()).length(3),
});

const voiceReportSchema = z.object({
    acceptance: z.object({
        liveG2Eligible: z.literal(false),
    }).passthrough(),
    methodology: z.object({
        languageCounts: z.object({
            "en": z.literal(20),
            "zh-CN": z.literal(20),
        }),
        submittedTurns: z.literal(40),
    }).passthrough(),
    rawTraces: z.array(z.unknown()).length(40),
}).passthrough();

/**
 * readJson
 * ----------------
 * Reads and validates one committed release-evidence JSON document.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 10 Release Audit
 */
async function readJson(path, schema)
{
    return schema.parse(JSON.parse(await readFile(path, "utf8")));
}

/**
 * verifyVersions
 * ----------------
 * Confirms every workspace manifest and the Worker health binding use the same UAT release version.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 10 Release Audit
 */
async function verifyVersions()
{
    const manifestPaths = [
        "package.json",
        "apps/api/package.json",
        "apps/voice-agent/package.json",
        "apps/web/package.json",
        "packages/assistant-core/package.json",
        "packages/config/package.json",
        "packages/contracts/package.json",
        "packages/ingestion/package.json",
        "packages/ui/package.json",
    ];

    for (const path of manifestPaths)
    {
        const manifest = JSON.parse(await readFile(path, "utf8"));

        if (manifest.version !== releaseVersion)
        {
            throw new Error(`${path} does not use release version ${releaseVersion}.`);
        }
    }

    const wrangler = await readFile("apps/api/wrangler.jsonc", "utf8");

    if (!wrangler.includes(`"VERSION": "${releaseVersion}"`))
    {
        throw new Error("The Worker health version does not match the UAT release.");
    }
}

/**
 * verifyReleaseDocuments
 * ----------------
 * Confirms the deployment, UAT, evaluation, and project-state handoff documents are present and retain the live-evidence boundary.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 10 Release Audit
 */
async function verifyReleaseDocuments()
{
    const requiredDocuments = [
        "README.md",
        "docs/DEPLOYMENT_GUIDE.md",
        "docs/UAT_GUIDE.md",
        "docs/UAT_READINESS_REPORT.md",
        "docs/STATUS.md",
        "docs/DECISIONS.md",
    ];

    for (const path of requiredDocuments)
    {
        const content = await readFile(path, "utf8");

        if (content.trim().length < 100)
        {
            throw new Error(`${path} is missing or incomplete.`);
        }
    }

    const report = await readFile("docs/UAT_READINESS_REPORT.md", "utf8");

    if (
        !report.includes("Local/mock UAT-ready")
        || !report.includes("Live P1 UAT pending")
        || !report.includes("R11 remains disabled")
    )
    {
        throw new Error("The UAT report does not preserve gate and provider limitations.");
    }
}

/**
 * verifyNoDebugDebt
 * ----------------
 * Scans tracked implementation and operator files for unresolved work markers or executable debugger statements.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 10 Release Audit
 */
async function verifyNoDebugDebt()
{
    const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
        encoding: "utf8",
    });
    const paths = stdout
        .split("\0")
        .filter((path) =>
        {
            return path.length > 0
                && !path.startsWith("docs/spec/")
                && !path.endsWith("worker-configuration.d.ts")
                && /\.(?:cjs|js|json|jsonc|md|mjs|sql|ts|tsx|yaml|yml)$/u.test(path);
        });
    const violations = [];

    for (const path of paths)
    {
        const content = await readFile(path, "utf8");

        if (/\b(?:TO[D]O|FIX[M]E|HA[C]K)\b|(?:^|\s)debugger\s*;/gmu.test(content))
        {
            violations.push(path);
        }
    }

    if (violations.length > 0)
    {
        throw new Error(`Release debug debt remains in: ${violations.join(", ")}`);
    }
}

/**
 * verifyR11Closed
 * ----------------
 * Confirms the optional ticket UI flag stays off and no ticket migration was introduced before live G2 acceptance.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 10 Release Audit
 */
async function verifyR11Closed()
{
    const environmentExample = await readFile(".env.example", "utf8");
    const { stdout } = await execFileAsync(
        "git",
        ["ls-files", "supabase/migrations"],
        {
            encoding: "utf8",
        },
    );

    if (
        !environmentExample.includes("ENABLE_R11_TICKET_UI=false")
        || /ticket/iu.test(stdout)
    )
    {
        throw new Error("R11 is not cleanly disabled at the G3 boundary.");
    }
}

/**
 * main
 * ----------------
 * Audits the immutable evidence, release version, UAT documents, debug posture, and closed R11 gate without making provider calls.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 10 Release Audit
 */
async function main()
{
    await Promise.all([
        readJson(
            "docs/evidence/day10-local-demo-runs.json",
            demoReportSchema,
        ),
        readJson(
            "docs/evidence/day8-local-voice-report.json",
            voiceReportSchema,
        ),
        verifyVersions(),
        verifyReleaseDocuments(),
        verifyNoDebugDebt(),
        verifyR11Closed(),
    ]);
    process.stdout.write(
        "Day 10 release audit passed: version 0.10.0, three clean full demos, 40 voice traces, UAT/deployment bundle, no unresolved debug debt, R11 closed, no provider cost.\n",
    );
}

try
{
    await main();
}
catch (error)
{
    console.error("Day 10 release audit failed.");
    console.error(error instanceof Error ? error.message : "Unknown release-audit error.");
    console.error("Credentials, provider bodies, and stack traces were not displayed.");
    process.exitCode = 1;
}
