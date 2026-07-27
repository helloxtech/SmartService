import { z } from "zod";

const optionalUrlSchema = z.union([z.url(), z.literal("")]).transform((value) =>
{
    return value === "" ? undefined : value;
});

const optionalStringSchema = z.union([z.string().min(1), z.literal("")]).transform((value) =>
{
    return value === "" ? undefined : value;
});

const publicEnvironmentSchema = z.object({
    VITE_API_BASE_URL: optionalUrlSchema.optional(),
    VITE_SUPABASE_ANON_KEY: optionalStringSchema.optional(),
    VITE_SUPABASE_URL: optionalUrlSchema.optional(),
});

export type PublicEnvironment = z.infer<typeof publicEnvironmentSchema>;

/**
 * parsePublicEnvironment
 * ----------------
 * Validates browser-safe configuration and returns explicit undefined values for unconfigured optional services.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
export function parsePublicEnvironment(input: unknown): PublicEnvironment
{
    return publicEnvironmentSchema.parse(input);
}
