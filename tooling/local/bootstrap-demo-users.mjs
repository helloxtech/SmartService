import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const localStatusSchema = z.object({
    ANON_KEY: z.string().min(1),
    API_URL: z.url(),
    DB_URL: z.string().min(1),
    SERVICE_ROLE_KEY: z.string().min(1),
});

const organizationIds = {
    adminTenant: "00000000-0000-4000-a000-000000000001",
    isolationTenant: "00000000-0000-4000-a000-000000000002",
};

let bootstrapStage = "initializing";

/**
 * parseEnvironmentText
 * ----------------
 * Parses a simple KEY=value environment document while rejecting malformed variable names.
 *
 * July 30, 2026: Updated by Forrest Zhang for SmartService Admin Email
 */
function parseEnvironmentText(text)
{
    const values = new Map();

    for (const line of text.split(/\r?\n/u))
    {
        const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);

        if (match === null)
        {
            continue;
        }

        const [, name, serializedValue] = match;

        if (name === undefined || serializedValue === undefined)
        {
            continue;
        }

        let value = serializedValue.trim();

        if (value.startsWith("\"") && value.endsWith("\""))
        {
            value = JSON.parse(value);
        }

        values.set(name, z.string().parse(value));
    }

    return values;
}

/**
 * readLocalStatus
 * ----------------
 * Reads local Supabase connection metadata into memory without printing credentials to the terminal.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
function readLocalStatus()
{
    const statusText = execFileSync("supabase", ["status", "-o", "env"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    const values = parseEnvironmentText(statusText);

    return localStatusSchema.parse(Object.fromEntries(values));
}

/**
 * generateLocalPassword
 * ----------------
 * Generates a high-entropy local-only demo password that satisfies the configured Auth policy.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
function generateLocalPassword()
{
    return `${randomBytes(24).toString("base64url")}aA1!`;
}

/**
 * getConfiguredValue
 * ----------------
 * Reuses a non-empty ignored local value or creates a replacement without exposing it.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
function getConfiguredValue(values, name, fallback)
{
    const existingValue = values.get(name);

    if (typeof existingValue === "string" && existingValue.length > 0)
    {
        return existingValue;
    }

    return fallback();
}

/**
 * updateLocalEnvironment
 * ----------------
 * Atomically updates only approved local Supabase and fictional demo identity values in the ignored root environment file.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
async function updateLocalEnvironment(filePath, currentText, updates)
{
    const updatedNames = new Set();
    const updatedLines = currentText.split(/\r?\n/u).map((line) =>
    {
        const match = /^([A-Z][A-Z0-9_]*)=/u.exec(line);
        const name = match?.[1];

        if (name === undefined || !updates.has(name))
        {
            return line;
        }

        updatedNames.add(name);
        return `${name}=${updates.get(name)}`;
    });

    for (const [name, value] of updates)
    {
        if (!updatedNames.has(name))
        {
            updatedLines.push(`${name}=${value}`);
        }
    }

    const temporaryPath = `${filePath}.bootstrap`;
    await writeFile(temporaryPath, `${updatedLines.join("\n").replace(/\n+$/u, "")}\n`, {
        encoding: "utf8",
        mode: 0o600,
    });
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600);
}

/**
 * writeWorkerDevelopmentVariables
 * ----------------
 * Writes local Worker Supabase bindings plus generated upload and conversation signers to Wrangler's ignored secret file.
 *
 * July 30, 2026: Updated by Forrest Zhang for SmartService Chinese UI
 */
async function writeWorkerDevelopmentVariables(filePath, localStatus, voiceServiceToken)
{
    const values = [
        `SUPABASE_URL=${localStatus.API_URL}`,
        `SUPABASE_ANON_KEY=${localStatus.ANON_KEY}`,
        `SUPABASE_SERVICE_ROLE_KEY=${localStatus.SERVICE_ROLE_KEY}`,
        `LOCAL_UPLOAD_SIGNING_SECRET=${randomBytes(32).toString("base64url")}`,
        `CONVERSATION_TOKEN_SECRET=${randomBytes(32).toString("base64url")}`,
        `VOICE_INTERNAL_SERVICE_TOKEN=${voiceServiceToken}`,
        "CHAT_PROVIDER_MODE=mock",
        "AUXILIARY_PROVIDER_MODE=mock",
        "CRAWL_PROVIDER_MODE=mock",
        "EMBEDDING_PROVIDER_MODE=mock",
        "INGESTION_PROVIDER_MODE=mock",
        "TURNSTILE_PROVIDER_MODE=mock",
        "UPLOAD_PROVIDER_MODE=mock",
        "VOICE_PROVIDER_MODE=mock",
    ];
    const temporaryPath = `${filePath}.bootstrap`;
    await writeFile(temporaryPath, `${values.join("\n")}\n`, {
        encoding: "utf8",
        mode: 0o600,
    });
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600);
}

/**
 * ensureAuthUser
 * ----------------
 * Creates or refreshes one fictional local Auth identity and returns its stable user identifier.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
async function ensureAuthUser(client, email, password, displayName)
{
    const { data: listData, error: listError } = await client.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
    });

    if (listError !== null)
    {
        throw new Error("Local Auth users could not be listed.");
    }

    const normalizedEmail = email.toLowerCase();
    const existingUser = listData.users.find((user) => user.email?.toLowerCase() === normalizedEmail);

    if (existingUser !== undefined)
    {
        const { data, error } = await client.auth.admin.updateUserById(existingUser.id, {
            email_confirm: true,
            password,
            user_metadata: {
                display_name: displayName,
            },
        });

        if (error !== null)
        {
            throw new Error("A local Auth identity could not be refreshed.");
        }

        return data.user.id;
    }

    const { data, error } = await client.auth.admin.createUser({
        email,
        email_confirm: true,
        password,
        user_metadata: {
            display_name: displayName,
        },
    });

    if (error !== null)
    {
        throw new Error("A local Auth identity could not be created.");
    }

    return data.user.id;
}

/**
 * waitForLocalAuth
 * ----------------
 * Waits up to 30 seconds for local Supabase Auth to accept administrative requests after a database reset.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 10 UAT Release
 */
async function waitForLocalAuth(client)
{
    for (let attempt = 0; attempt < 60; attempt += 1)
    {
        const { error } = await client.auth.admin.listUsers({
            page: 1,
            perPage: 1,
        });

        if (error === null)
        {
            return;
        }

        await new Promise((resolveDelay) =>
        {
            setTimeout(resolveDelay, 500);
        });
    }

    throw new Error("Local Auth did not become ready after the database reset.");
}

/**
 * upsertMembership
 * ----------------
 * Assigns one fictional local Auth identity to its approved tenant and role using the local service role.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
async function upsertMembership(client, organizationId, userId, role)
{
    const { error } = await client
        .from("organization_members")
        .upsert({
            is_active: true,
            organization_id: organizationId,
            role,
            user_id: userId,
        }, {
            onConflict: "organization_id,user_id",
        });

    if (error !== null)
    {
        throw new Error("A local organization membership could not be saved.");
    }
}

/**
 * main
 * ----------------
 * Bootstraps fictional local identities plus public chat and voice configuration and stores credentials only in ignored local files.
 *
 * July 27, 2026: Updated by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
async function main()
{
    bootstrapStage = "reading local configuration";
    const environmentPath = resolve(".env.local");
    const currentText = await readFile(environmentPath, "utf8");
    const currentValues = parseEnvironmentText(currentText);
    const localStatus = readLocalStatus();
    const voiceServiceToken = getConfiguredValue(
        currentValues,
        "VOICE_INTERNAL_SERVICE_TOKEN",
        () => randomBytes(32).toString("base64url"),
    );

    const demoValues = new Map([
        ["DEMO_ADMIN_EMAIL", "Info@smartservice.ca"],
        ["DEMO_ADMIN_PASSWORD", getConfiguredValue(
            currentValues,
            "DEMO_ADMIN_PASSWORD",
            generateLocalPassword,
        )],
        ["DEMO_AGENT_EMAIL", "agent@xflow.smartservice.local"],
        ["DEMO_AGENT_PASSWORD", getConfiguredValue(
            currentValues,
            "DEMO_AGENT_PASSWORD",
            generateLocalPassword,
        )],
        ["DEMO_OTHER_ADMIN_EMAIL", "admin@harborworks.smartservice.local"],
        ["DEMO_OTHER_ADMIN_PASSWORD", getConfiguredValue(
            currentValues,
            "DEMO_OTHER_ADMIN_PASSWORD",
            generateLocalPassword,
        )],
        ["SUPABASE_DATABASE_URL", localStatus.DB_URL],
        ["SUPABASE_SERVICE_ROLE_KEY", localStatus.SERVICE_ROLE_KEY],
        ["SUPABASE_URL", localStatus.API_URL],
        ["VITE_SUPABASE_ANON_KEY", localStatus.ANON_KEY],
        ["VITE_SUPABASE_URL", localStatus.API_URL],
        ["VITE_DEMO_PUBLIC_KEY", "smart-service-public-demo"],
        ["VOICE_INTERNAL_API_BASE_URL", "http://127.0.0.1:8787"],
        ["VOICE_INTERNAL_SERVICE_TOKEN", voiceServiceToken],
    ]);

    bootstrapStage = "storing ignored local configuration";
    await updateLocalEnvironment(environmentPath, currentText, demoValues);
    await writeWorkerDevelopmentVariables(
        resolve("apps/api/.dev.vars"),
        localStatus,
        voiceServiceToken,
    );

    bootstrapStage = "connecting to local Auth";
    const client = createClient(localStatus.API_URL, localStatus.SERVICE_ROLE_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });

    bootstrapStage = "waiting for local Auth readiness";
    await waitForLocalAuth(client);

    bootstrapStage = "creating the Smart Service Admin";
    const adminUserId = await ensureAuthUser(
        client,
        demoValues.get("DEMO_ADMIN_EMAIL"),
        demoValues.get("DEMO_ADMIN_PASSWORD"),
        "Smart Service Demo Admin",
    );
    bootstrapStage = "creating the Smart Service Agent";
    const agentUserId = await ensureAuthUser(
        client,
        demoValues.get("DEMO_AGENT_EMAIL"),
        demoValues.get("DEMO_AGENT_PASSWORD"),
        "Smart Service Demo Agent",
    );
    bootstrapStage = "creating the isolation-tenant Admin";
    const otherAdminUserId = await ensureAuthUser(
        client,
        demoValues.get("DEMO_OTHER_ADMIN_EMAIL"),
        demoValues.get("DEMO_OTHER_ADMIN_PASSWORD"),
        "HarborWorks Isolation Admin",
    );

    bootstrapStage = "assigning organization memberships";
    await upsertMembership(client, organizationIds.adminTenant, adminUserId, "admin");
    await upsertMembership(client, organizationIds.adminTenant, agentUserId, "agent");
    await upsertMembership(client, organizationIds.isolationTenant, otherAdminUserId, "admin");

    console.log("Local Admin, Agent, and isolation-tenant identities are ready.");
    console.log("Credentials were stored only in the ignored .env.local file.");
}

try
{
    await main();
}
catch
{
    console.error(`Local demo identity bootstrap failed while ${bootstrapStage}.`);
    console.error("Credential values were not displayed.");
    process.exitCode = 1;
}
