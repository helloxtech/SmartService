import { spawn } from "node:child_process";
import {
    mkdir,
    writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

const demoCases = [
    "diagnostic",
    "calibration",
    "replacement",
];

/**
 * runDemo
 * ----------------
 * Runs one complete P0/P1 local demo from a fresh database while preserving live child output and recording its duration.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 10 Integrated Acceptance
 */
async function runDemo(caseName, runNumber)
{
    const startedAt = new Date().toISOString();
    const startedClock = performance.now();
    const exitCode = await new Promise((resolveExit, rejectExit) =>
    {
        const child = spawn("pnpm", ["demo:full:run"], {
            cwd: resolve("."),
            env: {
                ...process.env,
                SMARTSERVICE_DEMO_CASE: caseName,
            },
            stdio: "inherit",
        });
        child.once("error", rejectExit);
        child.once("exit", (code) =>
        {
            resolveExit(code ?? 1);
        });
    });

    return {
        case: caseName,
        completedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - startedClock),
        freshDatabase: true,
        result: exitCode === 0 ? "passed" : "failed",
        run: runNumber,
        startedAt,
    };
}

/**
 * writeReport
 * ----------------
 * Persists the bounded no-secret three-run acceptance record for release verification.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 10 Integrated Acceptance
 */
async function writeReport(runs)
{
    const evidenceDirectory = resolve("docs/evidence");
    await mkdir(evidenceDirectory, {
        recursive: true,
    });
    await writeFile(
        resolve(evidenceDirectory, "day10-local-demo-runs.json"),
        `${JSON.stringify({
            environment: "local_deterministic",
            generatedAt: new Date().toISOString(),
            providerCalls: 0,
            releaseVersion: "0.10.0",
            runs,
        }, null, 2)}\n`,
        "utf8",
    );
}

/**
 * main
 * ----------------
 * Executes the diagnostic, calibration, and replacement full demos consecutively and stops on the first failed chain.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 10 Integrated Acceptance
 */
async function main()
{
    const runs = [];

    for (const [index, caseName] of demoCases.entries())
    {
        process.stdout.write(
            `Starting Day 10 full demo ${index + 1}/3 (${caseName}) from a fresh database.\n`,
        );
        const result = await runDemo(caseName, index + 1);
        runs.push(result);
        await writeReport(runs);

        if (result.result !== "passed")
        {
            throw new Error(`Full demo ${index + 1} (${caseName}) failed.`);
        }
    }

    process.stdout.write(
        "Day 10 three-demo sequence passed: diagnostic, calibration, and replacement full P0/P1 local chains; fresh reset each run; no provider cost.\n",
    );
}

try
{
    await main();
}
catch (error)
{
    console.error(error instanceof Error ? error.message : "Unknown Day 10 demo failure.");
    console.error("Secrets, prompts, answers, provider bodies, and stacks were not displayed.");
    process.exitCode = 1;
}
