import { parsePublicEnvironment } from "@smartservice/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const publicEnvironment = parsePublicEnvironment({
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
});

let supabaseClient: SupabaseClient | null | undefined;
let supabaseClientPromise: Promise<SupabaseClient | null> | undefined;

const runtimePublicConfigurationSchema = z.object({
    supabaseAnonKey: z.string().min(1).nullable(),
    supabaseUrl: z.url().nullable(),
});

/**
 * createConfiguredClient
 * ----------------
 * Creates the browser Supabase client from validated browser-safe project URL and anon key values.
 *
 * July 30, 2026: Updated by Forrest Zhang for SmartService XFlow Chinese UI
 */
function createConfiguredClient(supabaseUrl: string, supabaseAnonKey: string): SupabaseClient
{
    return createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
            detectSessionInUrl: false,
            persistSession: true,
        },
    });
}

/**
 * fetchRuntimePublicConfiguration
 * ----------------
 * Loads same-origin browser-safe runtime configuration when Cloudflare Git builds do not have local Vite variables.
 *
 * July 29, 2026: Created by Forrest Zhang for SmartService hosted DEV Supabase sign-in
 */
async function fetchRuntimePublicConfiguration(): Promise<{
    supabaseAnonKey: string | null;
    supabaseUrl: string | null;
} | null>
{
    try
    {
        const response = await fetch("/api/public-config", {
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok)
        {
            return null;
        }

        return runtimePublicConfigurationSchema.parse(await response.json());
    }
    catch
    {
        return null;
    }
}

/**
 * getSupabaseClient
 * ----------------
 * Creates one browser Supabase client when public configuration exists and returns null for an intentionally unconfigured local shell.
 *
 * July 30, 2026: Updated by Forrest Zhang for SmartService XFlow Chinese UI
 */
export async function getSupabaseClient(): Promise<SupabaseClient | null>
{
    if (supabaseClient !== undefined)
    {
        return supabaseClient;
    }

    if (supabaseClientPromise !== undefined)
    {
        return supabaseClientPromise;
    }

    supabaseClientPromise = (async () =>
    {
        const runtimeConfiguration = await fetchRuntimePublicConfiguration();
        let supabaseUrl = runtimeConfiguration?.supabaseUrl ?? undefined;
        let supabaseAnonKey = runtimeConfiguration?.supabaseAnonKey ?? undefined;

        if (supabaseUrl === undefined || supabaseAnonKey === undefined)
        {
            supabaseUrl = publicEnvironment.VITE_SUPABASE_URL;
            supabaseAnonKey = publicEnvironment.VITE_SUPABASE_ANON_KEY;
        }

        if (supabaseUrl === undefined || supabaseAnonKey === undefined)
        {
            supabaseClient = null;
            return supabaseClient;
        }

        supabaseClient = createConfiguredClient(supabaseUrl, supabaseAnonKey);
        return supabaseClient;
    })();

    return supabaseClientPromise;
}
