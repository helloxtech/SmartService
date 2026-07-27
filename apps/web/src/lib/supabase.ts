import { parsePublicEnvironment } from "@smartservice/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const publicEnvironment = parsePublicEnvironment({
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
});

let supabaseClient: SupabaseClient | null | undefined;

/**
 * getSupabaseClient
 * ----------------
 * Creates one browser Supabase client when public configuration exists and returns null for an intentionally unconfigured local shell.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
export function getSupabaseClient(): SupabaseClient | null
{
    if (supabaseClient !== undefined)
    {
        return supabaseClient;
    }

    const supabaseUrl = publicEnvironment.VITE_SUPABASE_URL;
    const supabaseAnonKey = publicEnvironment.VITE_SUPABASE_ANON_KEY;

    if (supabaseUrl === undefined || supabaseAnonKey === undefined)
    {
        supabaseClient = null;
        return supabaseClient;
    }

    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
            detectSessionInUrl: false,
            persistSession: true,
        },
    });
    return supabaseClient;
}
