import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const localAccessSchema = z.object({
    DEMO_ADMIN_EMAIL: z.email(),
    DEMO_ADMIN_PASSWORD: z.string().min(10),
    DEMO_AGENT_EMAIL: z.email(),
    DEMO_AGENT_PASSWORD: z.string().min(10),
    DEMO_OTHER_ADMIN_EMAIL: z.email(),
    DEMO_OTHER_ADMIN_PASSWORD: z.string().min(10),
    VITE_SUPABASE_ANON_KEY: z.string().min(1),
    VITE_SUPABASE_URL: z.url(),
});

const membershipSchema = z.object({
    organization_id: z.uuid(),
    role: z.enum(["admin", "agent"]),
});

/**
 * parseLocalEnvironment
 * ----------------
 * Parses only non-comment KEY=value lines from the ignored local environment file for access verification.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
function parseLocalEnvironment(text)
{
    const values = {};

    for (const line of text.split(/\r?\n/u))
    {
        const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);

        if (match?.[1] !== undefined && match[2] !== undefined)
        {
            values[match[1]] = match[2];
        }
    }

    return localAccessSchema.parse(values);
}

/**
 * verifyIdentity
 * ----------------
 * Signs in one fictional user with the public client and proves its role plus one-tenant-only visibility under RLS.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
async function verifyIdentity(configuration, email, password, expectedOrganizationId, expectedRole)
{
    const client = createClient(
        configuration.VITE_SUPABASE_URL,
        configuration.VITE_SUPABASE_ANON_KEY,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        },
    );

    const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
        email,
        password,
    });

    if (signInError !== null || signInData.session === null)
    {
        throw new Error("A fictional local identity could not sign in.");
    }

    const { data: membershipData, error: membershipError } = await client
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", signInData.user.id)
        .eq("is_active", true)
        .single();

    if (membershipError !== null)
    {
        throw new Error("A fictional local identity could not read its membership.");
    }

    const membership = membershipSchema.parse(membershipData);

    if (
        membership.organization_id !== expectedOrganizationId
        || membership.role !== expectedRole
    )
    {
        throw new Error("A fictional local identity received an unexpected role or tenant.");
    }

    const { data: organizationData, error: organizationError } = await client
        .from("organizations")
        .select("id")
        .order("id");

    if (organizationError !== null)
    {
        throw new Error("A fictional local identity could not verify tenant visibility.");
    }

    const organizations = z.array(z.object({
        id: z.uuid(),
    })).parse(organizationData);

    if (
        organizations.length !== 1
        || organizations[0]?.id !== expectedOrganizationId
    )
    {
        throw new Error("RLS returned an unexpected organization set.");
    }

    const { error: signOutError } = await client.auth.signOut();

    if (signOutError !== null)
    {
        throw new Error("A fictional local identity could not sign out.");
    }
}

/**
 * main
 * ----------------
 * Verifies Admin, Agent, and isolation-tenant login paths without printing or persisting credential values.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
async function main()
{
    const environmentText = await readFile(resolve(".env.local"), "utf8");
    const configuration = parseLocalEnvironment(environmentText);

    await verifyIdentity(
        configuration,
        configuration.DEMO_ADMIN_EMAIL,
        configuration.DEMO_ADMIN_PASSWORD,
        "00000000-0000-4000-a000-000000000001",
        "admin",
    );
    await verifyIdentity(
        configuration,
        configuration.DEMO_AGENT_EMAIL,
        configuration.DEMO_AGENT_PASSWORD,
        "00000000-0000-4000-a000-000000000001",
        "agent",
    );
    await verifyIdentity(
        configuration,
        configuration.DEMO_OTHER_ADMIN_EMAIL,
        configuration.DEMO_OTHER_ADMIN_PASSWORD,
        "00000000-0000-4000-a000-000000000002",
        "admin",
    );

    console.log("Local Admin and Agent authentication passed.");
    console.log("Cross-tenant organization visibility remained isolated.");
}

try
{
    await main();
}
catch
{
    console.error("Local access verification failed without displaying credential values.");
    process.exitCode = 1;
}
