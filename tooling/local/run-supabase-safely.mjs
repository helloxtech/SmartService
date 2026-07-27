import { execFileSync } from "node:child_process";

import { z } from "zod";

const commandSchema = z.enum(["start", "status"]);

/**
 * runSupabaseCommand
 * ----------------
 * Runs a local Supabase lifecycle check while capturing CLI output that can contain generated local credentials.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
function runSupabaseCommand(command)
{
    const argumentsList = command === "status"
        ? ["status", "-o", "env"]
        : ["start"];

    execFileSync("supabase", argumentsList, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
}

try
{
    const command = commandSchema.parse(process.argv[2]);
    runSupabaseCommand(command);
    console.log(`Local Supabase ${command} check passed without displaying credentials.`);
}
catch
{
    console.error("Local Supabase command failed without displaying credential values.");
    process.exitCode = 1;
}
