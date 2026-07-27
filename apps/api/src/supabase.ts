import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "./errors";
import type { SmartServiceBindings } from "./types";

/**
 * requireBinding
 * ----------------
 * Reads one required server-only binding without exposing its value in errors or logs.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export function requireBinding(
    bindings: SmartServiceBindings,
    name: "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_URL",
): string
{
    const value = bindings[name];

    if (value === undefined || value.length === 0)
    {
        throw new ApiError(
            503,
            "SERVICE_CONFIGURATION_MISSING",
            `The server binding ${name} is not configured.`,
        );
    }

    return value;
}

/**
 * fetchWithTimeout
 * ----------------
 * Applies a bounded timeout to Supabase Auth and REST calls while preserving caller cancellation.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
{
    const timeoutSignal = AbortSignal.timeout(12_000);
    const signal = init?.signal === undefined || init.signal === null
        ? timeoutSignal
        : AbortSignal.any([init.signal, timeoutSignal]);

    return fetch(input, {
        ...init,
        signal,
    });
}

/**
 * createServiceClient
 * ----------------
 * Creates a server-only Supabase client with service-role access, no persisted session, and bounded external calls.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export function createServiceClient(bindings: SmartServiceBindings): SupabaseClient
{
    return createClient(
        requireBinding(bindings, "SUPABASE_URL"),
        requireBinding(bindings, "SUPABASE_SERVICE_ROLE_KEY"),
        {
            auth: {
                autoRefreshToken: false,
                detectSessionInUrl: false,
                persistSession: false,
            },
            global: {
                fetch: fetchWithTimeout,
            },
        },
    );
}
