import {
    teamConversationListItemSchema,
    type TeamConversationDetail,
} from "@smartservice/contracts";
import type { Session } from "@supabase/supabase-js";
import {
    cleanup,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import {
    AgentWorkspace,
    type AgentWorkspaceApi,
} from "./agent-workspace";

const organizationConversationId = "20000000-0000-4000-a000-000000000001";
const operatorId = "10000000-0000-4000-a000-000000000001";
const suggestionId = "80000000-0000-4000-a000-000000000001";
const triggerMessageId = "30000000-0000-4000-a000-000000000001";
const timestamp = "2026-08-07T20:00:00.000Z";
const session = {
    access_token: "fixture-token",
    user: {
        id: operatorId,
    },
} as unknown as Session;
const detail: TeamConversationDetail = {
    acceptedAt: timestamp,
    acceptedBy: operatorId,
    assistantSuggestion: {
        citations: [{
            citationId: "50000000-0000-4000-a000-000000000001",
            label: "Approved course guide",
            sourceType: "url",
            sourceUrl: "https://example.test/courses",
            supportingExcerpt: "The company offers the requested course.",
        }],
        createdAt: timestamp,
        draftText: "Yes, we offer that course. What schedule would work best for you?",
        errorCode: null,
        generatedAt: timestamp,
        id: suggestionId,
        kind: "grounded_answer",
        status: "ready",
        triggerMessageId,
        updatedAt: timestamp,
        usedAt: null,
    },
    conversationId: organizationConversationId,
    customer: {
        channel: "text",
        company: null,
        email: null,
        language: "en",
        name: "Customer",
        phone: null,
    },
    guardrailCount: 0,
    guardrailEvents: [],
    handoffReason: "customer_requested",
    handoffRequestedAt: timestamp,
    latestActivityAt: timestamp,
    latestGuardrailCode: null,
    messages: [{
        citations: [],
        createdAt: timestamp,
        decision: null,
        messageId: triggerMessageId,
        senderType: "customer",
        senderUserId: null,
        text: "Do you offer that course?",
    }],
    preview: "Do you offer that course?",
    startedAt: timestamp,
    status: "active_human",
    summary: {
        confirmedFacts: [],
        conversationSummary: "The customer is asking about a course.",
        currentIntent: "Course inquiry",
        customerQuestion: "Do you offer that course?",
        nextStep: "Verify the source and reply.",
        suggestedReply: "Let me confirm that for you.",
        triggerReason: "Customer requested a person.",
    },
    summaryRecord: null,
    voiceSession: null,
    voiceSessionStatus: null,
};

describe("agent reply assistance", () =>
{
    afterEach(() =>
    {
        cleanup();
    });

    it("shows a cited draft, inserts it for editing, and audits its ID only when the human sends it", async () =>
    {
        const api: AgentWorkspaceApi = {
            claim: vi.fn(),
            close: vi.fn(),
            get: vi.fn().mockResolvedValue(detail),
            list: vi.fn().mockResolvedValue([
                teamConversationListItemSchema.parse(detail),
            ]),
            send: vi.fn().mockResolvedValue({
                created: true,
                message: {
                    citations: [],
                    createdAt: timestamp,
                    decision: "human",
                    messageId: "30000000-0000-4000-a000-000000000002",
                    senderType: "human",
                    senderUserId: operatorId,
                    text: "sent",
                },
            }),
        };
        render(
            <AgentWorkspace
                api={api}
                initialConversationId={organizationConversationId}
                onOpenConversation={vi.fn()}
                session={session}
            />,
        );

        expect(await screen.findByText("Grounded draft ready")).toBeInTheDocument();
        expect(screen.getAllByText("Approved course guide").length).toBeGreaterThan(0);
        await userEvent.click(screen.getByRole("button", { name: "Use suggested reply" }));
        const composer = screen.getByPlaceholderText("Write a human reply…");
        expect(composer).toHaveValue(detail.assistantSuggestion?.draftText);
        await userEvent.type(composer, " Thank you.");
        await userEvent.click(screen.getByRole("button", { name: "Send" }));

        await waitFor(() =>
        {
            expect(api.send).toHaveBeenCalledWith(
                session,
                organizationConversationId,
                `${detail.assistantSuggestion?.draftText} Thank you.`,
                suggestionId,
            );
        });
    });
});
