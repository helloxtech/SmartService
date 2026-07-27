import {
    dashboardSummarySchema,
    knowledgeGapRetestResponseSchema,
    knowledgeGapSchema,
    resolveKnowledgeGapResponseSchema,
    type KnowledgeGap,
} from "@smartservice/contracts";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { ApiError } from "../src/errors";
import type {
    AdminIdentity,
    AnalyticsService,
    RuntimeServices,
    SmartServiceBindings,
} from "../src/types";

const organizationId = "00000000-0000-4000-a000-000000000001";
const userId = "10000000-0000-4000-a000-000000000001";
const gapId = "70000000-0000-4000-a000-000000000001";
const sourceId = "40000000-0000-4000-a000-000000000001";
const jobId = "50000000-0000-4000-a000-000000000001";
const timestamp = "2026-07-26T12:00:00.000Z";
const identity: AdminIdentity = {
    organizationId,
    role: "admin",
    userId,
};
const gap: KnowledgeGap = {
    createdAt: timestamp,
    exampleQuestion: "What is the NovaFlow NF-500 warranty?",
    firstConversationId: "20000000-0000-4000-a000-000000000001",
    id: gapId,
    lastSeenAt: timestamp,
    normalizedQuestion: "what is the novaflow nf-500 warranty",
    occurrenceCount: 3,
    reason: "No sufficiently relevant approved evidence was retrieved.",
    resolutionSource: null,
    status: "open",
    updatedAt: timestamp,
};

/**
 * createAnalyticsService
 * ----------------
 * Creates an isolated analytics double covering every Day 5 route contract without network or provider calls.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard and Knowledge Gaps
 */
function createAnalyticsService(): AnalyticsService
{
    return {
        getDashboard: vi.fn().mockResolvedValue({
            aiContainedConversations: 3,
            aiContainmentRate: 0.75,
            from: "2026-07-01T00:00:00.000Z",
            handedOffConversations: 1,
            handoffRate: 0.25,
            openKnowledgeGapCount: 2,
            to: "2026-08-01T00:00:00.000Z",
            totalConversations: 4,
        }),
        getKnowledgeGap: vi.fn().mockResolvedValue(gap),
        listKnowledgeGaps: vi.fn().mockResolvedValue([gap]),
        manageKnowledgeGap: vi.fn().mockImplementation(
            (_identity: AdminIdentity, _gapId: string, action: "ignore" | "reopen") =>
            {
                return Promise.resolve({
                    ...gap,
                    status: action === "ignore" ? "ignored" : "open",
                });
            },
        ),
        resolveKnowledgeGap: vi.fn().mockResolvedValue({
            gapId,
            jobId,
            sourceId,
            status: "uploaded",
        }),
        retestKnowledgeGap: vi.fn().mockResolvedValue({
            answer: "The approved warranty is two years.",
            citations: [{
                citationId: "80000000-0000-4000-a000-000000000001",
                label: "NF-500 approved warranty",
                sourceType: "manual",
                sourceUrl: null,
                supportingExcerpt: "Answer: The approved warranty is two years.",
            }],
            decision: "answer",
            gapId,
            testedAt: timestamp,
        }),
    };
}

/**
 * requestAnalyticsApp
 * ----------------
 * Dispatches an authenticated request through the Worker router with a narrow Day 5 service graph.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 API Validation
 */
async function requestAnalyticsApp(
    analytics: AnalyticsService,
    path: string,
    init?: RequestInit,
): Promise<Response>
{
    const app = createApp(() => ({
        analytics,
        authenticateAdmin: vi.fn().mockResolvedValue(identity),
    } as unknown as RuntimeServices));

    return app.request(
        `https://smartservice.test${path}`,
        init,
        {} as SmartServiceBindings,
    );
}

describe("analytics routes", () =>
{
    it("returns exact date-filtered dashboard metrics for the authenticated organization", async () =>
    {
        const analytics = createAnalyticsService();
        const response = await requestAnalyticsApp(
            analytics,
            "/api/v1/admin/dashboard/summary?from=2026-07-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z",
            {
                headers: {
                    authorization: "Bearer fixture",
                },
            },
        );
        const body: unknown = await response.json();

        expect(response.status).toBe(200);
        expect(dashboardSummarySchema.parse(body).aiContainmentRate).toBe(0.75);
        expect(analytics.getDashboard).toHaveBeenCalledWith(
            organizationId,
            "2026-07-01T00:00:00.000Z",
            "2026-08-01T00:00:00.000Z",
        );
    });

    it("rejects incomplete or excessive dashboard ranges before aggregation", async () =>
    {
        const analytics = createAnalyticsService();
        const incomplete = await requestAnalyticsApp(
            analytics,
            "/v1/admin/dashboard/summary?from=2026-07-01T00%3A00%3A00.000Z",
        );
        const excessive = await requestAnalyticsApp(
            analytics,
            "/v1/admin/dashboard/summary?from=2025-01-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z",
        );

        expect(incomplete.status).toBe(400);
        expect(excessive.status).toBe(400);
        expect(analytics.getDashboard).not.toHaveBeenCalled();
    });

    it("lists, loads, and state-manages only validated knowledge-gap routes", async () =>
    {
        const analytics = createAnalyticsService();
        const listed = await requestAnalyticsApp(
            analytics,
            "/api/v1/admin/knowledge-gaps?status=open",
        );
        const loaded = await requestAnalyticsApp(
            analytics,
            `/api/v1/admin/knowledge-gaps/${gapId}`,
        );
        const ignored = await requestAnalyticsApp(
            analytics,
            `/api/v1/admin/knowledge-gaps/${gapId}/actions/ignore`,
            {
                headers: {
                    "idempotency-key": crypto.randomUUID(),
                },
                method: "POST",
            },
        );

        expect(listed.status).toBe(200);
        expect((await listed.json() as { gaps: unknown[] }).gaps).toHaveLength(1);
        expect(knowledgeGapSchema.parse(await loaded.json()).id).toBe(gapId);
        expect(knowledgeGapSchema.parse(await ignored.json()).status).toBe("ignored");
        expect(analytics.listKnowledgeGaps).toHaveBeenCalledWith(organizationId, "open");
        expect(analytics.manageKnowledgeGap).toHaveBeenCalledWith(
            identity,
            gapId,
            "ignore",
            expect.any(String),
        );
    });

    it("requires idempotency and validates the one-click resolution payload", async () =>
    {
        const analytics = createAnalyticsService();
        const missingKey = await requestAnalyticsApp(
            analytics,
            `/api/v1/admin/knowledge-gaps/${gapId}/resolve`,
            {
                body: JSON.stringify({
                    answer: "Two years.",
                    title: "NF-500 warranty",
                }),
                headers: {
                    "content-type": "application/json",
                },
                method: "POST",
            },
        );
        const resolved = await requestAnalyticsApp(
            analytics,
            `/api/v1/admin/knowledge-gaps/${gapId}/resolve`,
            {
                body: JSON.stringify({
                    answer: "The approved warranty is two years.",
                    sourceNote: "Approved demo policy.",
                    title: "NF-500 approved warranty",
                }),
                headers: {
                    "content-type": "application/json",
                    "idempotency-key": "day5-gap-resolution-0001",
                },
                method: "POST",
            },
        );

        expect(missingKey.status).toBe(400);
        expect(resolved.status).toBe(202);
        expect(resolveKnowledgeGapResponseSchema.parse(await resolved.json()).jobId)
            .toBe(jobId);
        expect(analytics.resolveKnowledgeGap).toHaveBeenCalledWith(
            identity,
            gapId,
            {
                answer: "The approved warranty is two years.",
                sourceNote: "Approved demo policy.",
                title: "NF-500 approved warranty",
            },
            "day5-gap-resolution-0001",
            expect.any(String),
        );
    });

    it("returns a cited source-scoped re-test and preserves authentication failures", async () =>
    {
        const analytics = createAnalyticsService();
        const response = await requestAnalyticsApp(
            analytics,
            `/api/v1/admin/knowledge-gaps/${gapId}/retest`,
            {
                headers: {
                    "idempotency-key": crypto.randomUUID(),
                },
                method: "POST",
            },
        );
        const parsed = knowledgeGapRetestResponseSchema.parse(await response.json());

        expect(response.status).toBe(200);
        expect(parsed.citations).toHaveLength(1);
        expect(parsed.citations[0]?.sourceType).toBe("manual");

        const app = createApp(() => ({
            analytics,
            authenticateAdmin: vi.fn().mockRejectedValue(
                new ApiError(403, "ADMIN_REQUIRED", "An organization Admin role is required."),
            ),
        } as unknown as RuntimeServices));
        const denied = await app.request(
            "https://smartservice.test/api/v1/admin/knowledge-gaps",
            {},
            {} as SmartServiceBindings,
        );

        expect(denied.status).toBe(403);
    });
});
