import {
    claimConversationResponseSchema,
    closeConversationResponseSchema,
    guardrailCandidateResponseSchema,
    guardrailEventListResponseSchema,
    guardrailRuleListResponseSchema,
    guardrailRuleSchema,
    sendHumanMessageResponseSchema,
    teamConversationDetailSchema,
    teamInboxResponseSchema,
    type ClaimConversationResponse,
    type CloseConversationResponse,
    type CreateGuardrailRuleRequest,
    type GuardrailEvent,
    type GuardrailRule,
    type SendHumanMessageResponse,
    type TeamConversationDetail,
    type TeamInboxItem,
    type UpdateGuardrailRuleRequest,
} from "@smartservice/contracts";
import type { Session } from "@supabase/supabase-js";
import { z } from "zod";

const apiErrorSchema = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
        requestId: z.string().optional(),
    }),
});

export class TeamApiError extends Error
{
    public readonly code: string;
    public readonly requestId: string | undefined;

    /**
     * TeamApiError
     * ----------------
     * Creates a safe operator-facing API error with a stable code and optional request trace.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Workspace
     */
    public constructor(code: string, message: string, requestId?: string)
    {
        super(message);
        this.code = code;
        this.name = "TeamApiError";
        this.requestId = requestId;
    }
}

/**
 * buildApiUrl
 * ----------------
 * Resolves a team API path against the optional development origin or the production same-origin Worker.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Workspace
 */
function buildApiUrl(path: string): string
{
    const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/u, "") ?? "";
    return `${baseUrl}${path}`;
}

/**
 * readFailure
 * ----------------
 * Converts a bounded structured Worker error into a safe browser exception without reflecting raw response bodies.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Workspace
 */
async function readFailure(response: Response): Promise<TeamApiError>
{
    try
    {
        const parsed = apiErrorSchema.safeParse(await response.json());

        if (parsed.success)
        {
            return new TeamApiError(
                parsed.data.error.code,
                parsed.data.error.message,
                parsed.data.error.requestId,
            );
        }
    }
    catch
    {
        // The stable fallback intentionally withholds invalid upstream content.
    }

    return new TeamApiError("TEAM_API_FAILED", "The team operation could not be completed.");
}

/**
 * teamRequest
 * ----------------
 * Sends one authenticated team request with timeout, idempotency for mutations, and runtime response validation.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Workspace
 */
async function teamRequest<T>(
    session: Session,
    path: string,
    parser: { parse(input: unknown): T },
    init: RequestInit = {},
): Promise<T>
{
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${session.access_token}`);

    if (init.body !== undefined)
    {
        headers.set("content-type", "application/json");
    }

    if (init.method !== undefined && init.method !== "GET")
    {
        headers.set("idempotency-key", crypto.randomUUID());
    }

    const response = await fetch(buildApiUrl(path), {
        ...init,
        headers,
        signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok)
    {
        throw await readFailure(response);
    }

    return parser.parse(await response.json());
}

/**
 * listTeamConversations
 * ----------------
 * Lists current tenant handoffs, optionally including closed conversations for review.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Inbox
 */
export async function listTeamConversations(
    session: Session,
    includeClosed = false,
): Promise<TeamInboxItem[]>
{
    const response = await teamRequest(
        session,
        `/api/v1/admin/conversations?includeClosed=${includeClosed}`,
        teamInboxResponseSchema,
    );
    return response.conversations;
}

/**
 * getTeamConversation
 * ----------------
 * Loads one tenant-scoped transcript, handoff package, redacted guardrails, citations, and final summary.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Conversation Detail
 */
export async function getTeamConversation(
    session: Session,
    conversationId: string,
): Promise<TeamConversationDetail>
{
    return teamRequest(
        session,
        `/api/v1/admin/conversations/${encodeURIComponent(conversationId)}`,
        teamConversationDetailSchema,
    );
}

/**
 * claimTeamConversation
 * ----------------
 * Atomically claims one waiting conversation for the current Admin or Agent.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Takeover
 */
export async function claimTeamConversation(
    session: Session,
    conversationId: string,
): Promise<ClaimConversationResponse>
{
    return teamRequest(
        session,
        `/api/v1/admin/conversations/${encodeURIComponent(conversationId)}/takeover`,
        claimConversationResponseSchema,
        {
            method: "POST",
        },
    );
}

/**
 * sendTeamMessage
 * ----------------
 * Sends one idempotent human reply from the owning operator.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Human Messaging
 */
export async function sendTeamMessage(
    session: Session,
    conversationId: string,
    text: string,
): Promise<SendHumanMessageResponse>
{
    return teamRequest(
        session,
        `/api/v1/admin/conversations/${encodeURIComponent(conversationId)}/messages`,
        sendHumanMessageResponseSchema,
        {
            body: JSON.stringify({
                clientMessageId: crypto.randomUUID(),
                text,
            }),
            method: "POST",
        },
    );
}

/**
 * closeTeamConversation
 * ----------------
 * Closes the operator-owned conversation and requests asynchronous finalization.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Conversation Closure
 */
export async function closeTeamConversation(
    session: Session,
    conversationId: string,
): Promise<CloseConversationResponse>
{
    return teamRequest(
        session,
        `/api/v1/admin/conversations/${encodeURIComponent(conversationId)}/close`,
        closeConversationResponseSchema,
        {
            method: "POST",
        },
    );
}

/**
 * listGuardrailRules
 * ----------------
 * Loads tenant guardrail configuration for the Admin settings screen.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrail Administration
 */
export async function listGuardrailRules(session: Session): Promise<GuardrailRule[]>
{
    const response = await teamRequest(
        session,
        "/api/v1/admin/guardrails/rules",
        guardrailRuleListResponseSchema,
    );
    return response.rules;
}

/**
 * createGuardrailRule
 * ----------------
 * Creates one typed guardrail rule without exposing regular expressions or prompts to the Admin.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrail Administration
 */
export async function createGuardrailRule(
    session: Session,
    input: CreateGuardrailRuleRequest,
): Promise<GuardrailRule>
{
    return teamRequest(
        session,
        "/api/v1/admin/guardrails/rules",
        guardrailRuleSchema,
        {
            body: JSON.stringify(input),
            method: "POST",
        },
    );
}

/**
 * updateGuardrailRule
 * ----------------
 * Updates one existing tenant guardrail through the audited Worker transition.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrail Administration
 */
export async function updateGuardrailRule(
    session: Session,
    ruleId: string,
    input: UpdateGuardrailRuleRequest,
): Promise<GuardrailRule>
{
    return teamRequest(
        session,
        `/api/v1/admin/guardrails/rules/${encodeURIComponent(ruleId)}`,
        guardrailRuleSchema,
        {
            body: JSON.stringify(input),
            method: "PATCH",
        },
    );
}

/**
 * listGuardrailEvents
 * ----------------
 * Loads redacted tenant guardrail audit events for Admin review.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrail Logs
 */
export async function listGuardrailEvents(session: Session): Promise<GuardrailEvent[]>
{
    const response = await teamRequest(
        session,
        "/api/v1/admin/guardrails/events",
        guardrailEventListResponseSchema,
    );
    return response.events;
}

/**
 * getGuardrailCandidate
 * ----------------
 * Performs the distinct Admin-only read required to reveal one withheld candidate.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrail Privacy
 */
export async function getGuardrailCandidate(
    session: Session,
    eventId: string,
): Promise<string | null>
{
    const response = await teamRequest(
        session,
        `/api/v1/admin/guardrails/events/${encodeURIComponent(eventId)}/candidate`,
        guardrailCandidateResponseSchema,
    );
    return response.blockedCandidate;
}
