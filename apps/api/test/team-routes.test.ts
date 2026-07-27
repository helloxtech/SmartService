import {
    claimConversationResponseSchema,
    closeConversationResponseSchema,
    guardrailCandidateResponseSchema,
    guardrailEventListResponseSchema,
    teamConversationDetailSchema,
    teamInboxResponseSchema,
    type ConversationFinalizeMessage,
    type TeamConversationDetail,
} from "@smartservice/contracts";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type {
    AdminIdentity,
    MemberIdentity,
    RuntimeServices,
    SmartServiceBindings,
    TeamService,
} from "../src/types";

const organizationId = "00000000-0000-4000-a000-000000000001";
const userId = "10000000-0000-4000-a000-000000000001";
const conversationId = "20000000-0000-4000-a000-000000000001";
const eventId = "60000000-0000-4000-a000-000000000001";
const timestamp = "2026-07-26T12:00:00.000Z";
const identity: MemberIdentity = {
    organizationId,
    role: "agent",
    userId,
};
const adminIdentity: AdminIdentity = {
    organizationId,
    role: "admin",
    userId,
};
const guardrailEvent = {
    conversationId,
    createdAt: timestamp,
    customerMessageId: null,
    id: eventId,
    reason: "The request matched a configured rule.",
    ruleCode: "NO_PRICE_COMMITMENT",
    ruleId: null,
    severity: "high" as const,
};

const detail: TeamConversationDetail = {
    acceptedAt: null,
    acceptedBy: null,
    conversationId,
    customer: {
        channel: "text",
        company: null,
        email: null,
        language: "en",
        name: null,
        phone: null,
    },
    guardrailCount: 1,
    guardrailEvents: [guardrailEvent],
    handoffReason: "guardrail",
    handoffRequestedAt: timestamp,
    latestGuardrailCode: "NO_PRICE_COMMITMENT",
    messages: [],
    startedAt: timestamp,
    status: "handoff_requested",
    summary: {
        confirmedFacts: [],
        conversationSummary: "The customer requested a final price.",
        currentIntent: "Request pricing",
        customerQuestion: "Give me the final price.",
        nextStep: "Review approved commercial terms.",
        suggestedReply: "I can help review the approved pricing process.",
        triggerReason: "guardrail",
    },
    summaryRecord: null,
};

/**
 * createTeamService
 * ----------------
 * Creates a zero-network team service double with safe Day 4 fixture responses.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Workspace
 */
function createTeamService(): TeamService
{
    return {
        claim: vi.fn().mockResolvedValue({
            acceptedAt: timestamp,
            acceptedBy: userId,
            conversationId,
            status: "active_human",
        }),
        close: vi.fn().mockResolvedValue({
            created: true,
            language: "en",
        }),
        completeFinalization: vi.fn(),
        getConversation: vi.fn().mockResolvedValue(detail),
        getGuardrailCandidate: vi.fn().mockResolvedValue({
            blockedCandidate: "The withheld candidate.",
            eventId,
        }),
        listGuardrailEvents: vi.fn().mockResolvedValue([{
            ...guardrailEvent,
            blockedCandidate: "must not appear in normal event list",
        }]),
        listInbox: vi.fn().mockResolvedValue([detail]),
        listRules: vi.fn().mockResolvedValue([]),
        loadFinalizationAggregate: vi.fn(),
        manageRule: vi.fn(),
        markFinalizationQueued: vi.fn().mockResolvedValue(undefined),
        sendHumanMessage: vi.fn(),
    };
}

/**
 * requestTeamApp
 * ----------------
 * Dispatches an authenticated request through the team router with only explicit service doubles.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Workspace
 */
async function requestTeamApp(
    team: TeamService,
    path: string,
    init?: RequestInit,
): Promise<{
    finalizeQueue: Queue<ConversationFinalizeMessage>;
    response: Response;
}>
{
    const finalizeQueue = {
        send: vi.fn().mockResolvedValue(undefined),
        sendBatch: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue<ConversationFinalizeMessage>;
    const app = createApp(() => ({
        authenticateAdmin: vi.fn().mockResolvedValue(adminIdentity),
        authenticateMember: vi.fn().mockResolvedValue(identity),
        finalizeQueue,
        team,
    } as unknown as RuntimeServices));
    const response = await app.request(
        `https://smartservice.test${path}`,
        init,
        {} as SmartServiceBindings,
    );

    return {
        finalizeQueue,
        response,
    };
}

describe("team routes", () =>
{
    it("lists the handoff package and returns redacted guardrail context", async () =>
    {
        const team = createTeamService();
        const { response } = await requestTeamApp(
            team,
            `/api/v1/admin/conversations/${conversationId}`,
            {
                headers: {
                    authorization: "Bearer fixture",
                },
            },
        );
        const body: unknown = await response.json();
        const parsed = teamConversationDetailSchema.parse(body);

        expect(response.status).toBe(200);
        expect(parsed.summary.customerQuestion).toContain("final price");
        expect(JSON.stringify(parsed.guardrailEvents)).not.toContain("blockedCandidate");
    });

    it("claims a waiting handoff through the state-transition endpoint", async () =>
    {
        const team = createTeamService();
        const { response } = await requestTeamApp(
            team,
            `/v1/admin/conversations/${conversationId}/takeover`,
            {
                headers: {
                    authorization: "Bearer fixture",
                    "idempotency-key": crypto.randomUUID(),
                },
                method: "POST",
            },
        );
        const body: unknown = await response.json();

        expect(response.status).toBe(200);
        expect(claimConversationResponseSchema.parse(body).status).toBe("active_human");
        expect(team.claim).toHaveBeenCalledOnce();
    });

    it("closes and queues only IDs with optional ticket scope disabled", async () =>
    {
        const team = createTeamService();
        const { finalizeQueue, response } = await requestTeamApp(
            team,
            `/api/v1/admin/conversations/${conversationId}/close`,
            {
                headers: {
                    authorization: "Bearer fixture",
                    "idempotency-key": crypto.randomUUID(),
                },
                method: "POST",
            },
        );
        const body: unknown = await response.json();

        expect(response.status).toBe(202);
        expect(closeConversationResponseSchema.parse(body).finalizationQueued).toBe(true);
        expect(finalizeQueue.send).toHaveBeenCalledWith({
            conversationId,
            includeTicketClassification: false,
            organizationId,
            type: "conversation.finalize",
            version: 1,
        }, {
            contentType: "json",
        });
        expect(team.markFinalizationQueued)
            .toHaveBeenCalledWith(organizationId, conversationId);
    });

    it("separates redacted event listing from explicit Admin candidate access", async () =>
    {
        const team = createTeamService();
        const listed = await requestTeamApp(
            team,
            "/api/v1/admin/guardrails/events",
            {
                headers: {
                    authorization: "Bearer fixture",
                },
            },
        );
        const listBody: unknown = await listed.response.json();

        expect(JSON.stringify(guardrailEventListResponseSchema.parse(listBody)))
            .not.toContain("must not appear");

        const candidate = await requestTeamApp(
            team,
            `/api/v1/admin/guardrails/events/${eventId}/candidate`,
            {
                headers: {
                    authorization: "Bearer fixture",
                },
            },
        );
        const candidateBody: unknown = await candidate.response.json();

        expect(guardrailCandidateResponseSchema.parse(candidateBody).blockedCandidate)
            .toBe("The withheld candidate.");
    });

    it("lists the inbox with a validated collection contract", async () =>
    {
        const team = createTeamService();
        const { response } = await requestTeamApp(
            team,
            "/v1/admin/conversations",
            {
                headers: {
                    authorization: "Bearer fixture",
                },
            },
        );
        const body: unknown = await response.json();

        expect(teamInboxResponseSchema.parse(body).conversations).toHaveLength(1);
    });
});
