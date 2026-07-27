import {
    dashboardSummarySchema,
    knowledgeGapListResponseSchema,
    knowledgeGapRetestResponseSchema,
    knowledgeGapSchema,
    resolveKnowledgeGapResponseSchema,
    type DashboardSummary,
    type KnowledgeGap,
    type KnowledgeGapAction,
    type KnowledgeGapRetestResponse,
    type KnowledgeGapStatus,
    type ResolveKnowledgeGapRequest,
    type ResolveKnowledgeGapResponse,
} from "@smartservice/contracts";
import { sha256Text } from "@smartservice/ingestion";
import type { Session } from "@supabase/supabase-js";
import { z } from "zod";

const apiErrorSchema = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
        requestId: z.string().optional(),
    }),
});

export class AnalyticsApiError extends Error
{
    public readonly code: string;
    public readonly requestId: string | undefined;

    /**
     * AnalyticsApiError
     * ----------------
     * Creates a bounded dashboard or knowledge-gap error without reflecting an unvalidated upstream body.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard and Knowledge Gaps
     */
    public constructor(code: string, message: string, requestId?: string)
    {
        super(message);
        this.code = code;
        this.name = "AnalyticsApiError";
        this.requestId = requestId;
    }
}

/**
 * buildApiUrl
 * ----------------
 * Resolves a Day 5 API path against the optional development origin or same-origin Worker.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard and Knowledge Gaps
 */
function buildApiUrl(path: string): string
{
    const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/u, "") ?? "";
    return `${base}${path}`;
}

/**
 * readFailure
 * ----------------
 * Parses the stable Worker error contract and otherwise returns a safe analytics fallback.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard and Knowledge Gaps
 */
async function readFailure(response: Response): Promise<AnalyticsApiError>
{
    try
    {
        const parsed = apiErrorSchema.safeParse(await response.json());

        if (parsed.success)
        {
            return new AnalyticsApiError(
                parsed.data.error.code,
                parsed.data.error.message,
                parsed.data.error.requestId,
            );
        }
    }
    catch
    {
        // The fallback intentionally withholds an invalid response body.
    }

    return new AnalyticsApiError(
        "ANALYTICS_API_FAILED",
        "The dashboard operation could not be completed.",
    );
}

/**
 * analyticsRequest
 * ----------------
 * Sends one authenticated bounded request and validates its successful response at runtime.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard and Knowledge Gaps
 */
async function analyticsRequest<T>(
    session: Session,
    path: string,
    parser: { parse(input: unknown): T },
    init: RequestInit = {},
    idempotencyKey?: string,
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
        headers.set("idempotency-key", idempotencyKey ?? crypto.randomUUID());
    }

    const response = await fetch(buildApiUrl(path), {
        ...init,
        headers,
        signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok)
    {
        throw await readFailure(response);
    }

    return parser.parse(await response.json());
}

/**
 * getDashboardSummary
 * ----------------
 * Loads exact Admin metrics for one explicit ISO date range.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard
 */
export async function getDashboardSummary(
    session: Session,
    from: string,
    to: string,
): Promise<DashboardSummary>
{
    const query = new URLSearchParams({ from, to });
    return analyticsRequest(
        session,
        `/api/v1/admin/dashboard/summary?${query.toString()}`,
        dashboardSummarySchema,
    );
}

/**
 * listKnowledgeGaps
 * ----------------
 * Lists grouped knowledge gaps with an optional status filter.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Listing
 */
export async function listKnowledgeGaps(
    session: Session,
    status?: KnowledgeGapStatus,
): Promise<KnowledgeGap[]>
{
    const suffix = status === undefined
        ? ""
        : `?status=${encodeURIComponent(status)}`;
    const response = await analyticsRequest(
        session,
        `/api/v1/admin/knowledge-gaps${suffix}`,
        knowledgeGapListResponseSchema,
    );
    return response.gaps;
}

/**
 * getKnowledgeGap
 * ----------------
 * Loads one tenant-scoped gap detail and its manual-source progress.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Detail
 */
export async function getKnowledgeGap(
    session: Session,
    gapId: string,
): Promise<KnowledgeGap>
{
    return analyticsRequest(
        session,
        `/api/v1/admin/knowledge-gaps/${encodeURIComponent(gapId)}`,
        knowledgeGapSchema,
    );
}

/**
 * resolveKnowledgeGap
 * ----------------
 * Creates an idempotent manual knowledge source for one gap and queues shared embedding.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 One-click Knowledge
 */
export async function resolveKnowledgeGap(
    session: Session,
    gapId: string,
    input: ResolveKnowledgeGapRequest,
): Promise<ResolveKnowledgeGapResponse>
{
    const idempotencyKey = await sha256Text([
        session.user.id,
        gapId,
        input.title,
        input.answer,
        input.sourceNote ?? "",
    ].join(":"));

    return analyticsRequest(
        session,
        `/api/v1/admin/knowledge-gaps/${encodeURIComponent(gapId)}/resolve`,
        resolveKnowledgeGapResponseSchema,
        {
            body: JSON.stringify(input),
            method: "POST",
        },
        idempotencyKey,
    );
}

/**
 * applyKnowledgeGapAction
 * ----------------
 * Applies the strict ignore/reopen action and returns the authoritative gap.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Management
 */
export async function applyKnowledgeGapAction(
    session: Session,
    gapId: string,
    action: KnowledgeGapAction,
): Promise<KnowledgeGap>
{
    return analyticsRequest(
        session,
        `/api/v1/admin/knowledge-gaps/${encodeURIComponent(gapId)}/actions/${action}`,
        knowledgeGapSchema,
        {
            method: "POST",
        },
    );
}

/**
 * retestKnowledgeGap
 * ----------------
 * Re-runs the original question against only the linked ready manual source.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Re-test
 */
export async function retestKnowledgeGap(
    session: Session,
    gapId: string,
): Promise<KnowledgeGapRetestResponse>
{
    return analyticsRequest(
        session,
        `/api/v1/admin/knowledge-gaps/${encodeURIComponent(gapId)}/retest`,
        knowledgeGapRetestResponseSchema,
        {
            method: "POST",
        },
    );
}
