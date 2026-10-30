import { execFile } from "node:child_process";
import type { Command } from "../src/index";

const localDatabase = "shifa_validation";
const localSocket = "/tmp/shifa-local-validation";
const localPort = "55439";
let isolatedTargetChecked = false;

/**
 * runSql
 * ----------------
 * Runs synthetic validation SQL only in the task-owned local PostgreSQL database.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
function runSql(statement: string): Promise<string>
{
    return new Promise((resolve, reject) =>
    {
        const process = execFile("/opt/homebrew/opt/postgresql@17/bin/psql",
            ["-h", localSocket, "-p", localPort, "-d", localDatabase, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
            { maxBuffer: 12_000_000 }, (error, stdout) =>
            {
                if (error)
                {
                    reject(new Error("Local validation SQL failed"));
                }
                else
                {
                    resolve(stdout.trim());
                }
            });
        process.stdin?.end(statement);
    });
}

/**
 * sql
 * ----------------
 * Refuses to run destructive synthetic setup unless the fixed local database responds.
 *
 * October 28, 2026: Updated by Forrest Zhang for Shifa health reports
 */
export async function sql(statement: string): Promise<string>
{
    if (!isolatedTargetChecked)
    {
        const target = await runSql("select current_database();");
        if (target !== localDatabase)
        {
            throw new Error("Refusing non-isolated PostgreSQL validation target");
        }
        isolatedTargetChecked = true;
    }
    return runSql(statement);
}

/**
 * localCommand
 * ----------------
 * Exercises the actual deployed SQL function using synthetic local data.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export const localCommand: Command = async (operation, payload) =>
{
    const operationSQL = operation.replaceAll("'", "''");
    const payloadSQL = JSON.stringify(payload).replaceAll("'", "''");
    const output = await sql(`set role service_role; select public.shifa_command('${operationSQL}', '${payloadSQL}'::jsonb);`);
    return JSON.parse(output.split("\n").at(-1) ?? "null") as unknown;
};
