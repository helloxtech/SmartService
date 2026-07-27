import { z } from "zod";

import { ApiError } from "./errors";
import type { AdminIdentity, MemberIdentity, SmartServiceBindings } from "./types";
import { createServiceClient } from "./supabase";

const membershipRowSchema = z.object({
    organization_id: z.uuid(),
    role: z.enum(["admin", "agent"]),
    user_id: z.uuid(),
});

/**
 * readBearerToken
 * ----------------
 * Extracts one Supabase access token without logging or reflecting it in an error response.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function readBearerToken(request: Request): string
{
    const authorization = request.headers.get("authorization");

    if (authorization === null || !authorization.startsWith("Bearer "))
    {
        throw new ApiError(401, "AUTH_REQUIRED", "Sign in before using this endpoint.");
    }

    const token = authorization.slice("Bearer ".length).trim();

    if (token.length === 0)
    {
        throw new ApiError(401, "AUTH_REQUIRED", "Sign in before using this endpoint.");
    }

    return token;
}

/**
 * authenticateMember
 * ----------------
 * Validates the Supabase access token and resolves the authoritative active organization membership from the database.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export async function authenticateMember(
    request: Request,
    bindings: SmartServiceBindings,
): Promise<MemberIdentity>
{
    const client = createServiceClient(bindings);
    const { data: userData, error: userError } = await client.auth.getUser(readBearerToken(request));

    if (userError !== null || userData.user === null)
    {
        throw new ApiError(401, "AUTH_INVALID", "The sign-in session is not valid.");
    }

    const { data, error } = await client
        .from("organization_members")
        .select("organization_id, role, user_id")
        .eq("user_id", userData.user.id)
        .eq("is_active", true)
        .limit(2);

    if (error !== null)
    {
        throw new ApiError(503, "MEMBERSHIP_LOOKUP_FAILED", "Organization access could not be verified.");
    }

    if (data.length !== 1)
    {
        throw new ApiError(
            403,
            "MEMBERSHIP_AMBIGUOUS",
            "Exactly one active demo organization membership is required.",
        );
    }

    const membership = membershipRowSchema.parse(data[0]);

    return {
        organizationId: membership.organization_id,
        role: membership.role,
        userId: membership.user_id,
    };
}

/**
 * authenticateAdmin
 * ----------------
 * Requires an authoritative active Admin membership for knowledge mutation endpoints.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export async function authenticateAdmin(
    request: Request,
    bindings: SmartServiceBindings,
): Promise<AdminIdentity>
{
    const identity = await authenticateMember(request, bindings);

    if (identity.role !== "admin")
    {
        throw new ApiError(403, "ADMIN_REQUIRED", "An organization Admin role is required.");
    }

    return {
        ...identity,
        role: "admin",
    };
}
