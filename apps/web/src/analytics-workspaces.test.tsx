import type {
    DashboardSummary,
    KnowledgeGap,
    KnowledgeGapRetestResponse,
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
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

const analyticsMocks = vi.hoisted(() =>
{
    return {
        applyKnowledgeGapAction: vi.fn(),
        getDashboardSummary: vi.fn(),
        getKnowledgeGap: vi.fn(),
        listKnowledgeGaps: vi.fn(),
        resolveKnowledgeGap: vi.fn(),
        retestKnowledgeGap: vi.fn(),
    };
});

vi.mock("./lib/analytics-api", () =>
{
    return {
        AnalyticsApiError: class extends Error
        {
        },
        ...analyticsMocks,
    };
});

import { DashboardWorkspace } from "./dashboard-workspace";
import { KnowledgeGapWorkspace } from "./knowledge-gap-workspace";

const gapId = "70000000-0000-4000-a000-000000000001";
const timestamp = "2026-07-26T12:00:00.000Z";
const session = {
    access_token: "fixture-access-token",
    user: {
        id: "10000000-0000-4000-a000-000000000001",
    },
} as unknown as Session;
const dashboard: DashboardSummary = {
    aiContainedConversations: 3,
    aiContainmentRate: 0.75,
    from: "2026-07-01T00:00:00.000Z",
    handedOffConversations: 1,
    handoffRate: 0.25,
    openKnowledgeGapCount: 2,
    to: "2026-08-01T00:00:00.000Z",
    totalConversations: 4,
};
const openGap: KnowledgeGap = {
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
const resolvedGap: KnowledgeGap = {
    ...openGap,
    resolutionSource: {
        chunkCount: 1,
        id: "40000000-0000-4000-a000-000000000001",
        name: "NF-500 approved warranty",
        status: "ready",
    },
    status: "resolved",
};
const retest: KnowledgeGapRetestResponse = {
    answer: "The approved NF-500 warranty is two years.",
    citations: [{
        citationId: "80000000-0000-4000-a000-000000000001",
        label: "NF-500 approved warranty",
        sourceType: "manual",
        sourceUrl: null,
        supportingExcerpt: "Answer: The approved NF-500 warranty is two years.",
    }],
    decision: "answer",
    gapId,
    testedAt: timestamp,
};

describe("Day 5 analytics workspaces", () =>
{
    afterEach(() =>
    {
        cleanup();
    });

    beforeEach(() =>
    {
        vi.clearAllMocks();
        analyticsMocks.getDashboardSummary.mockResolvedValue(dashboard);
        analyticsMocks.listKnowledgeGaps.mockResolvedValue([openGap]);
        analyticsMocks.getKnowledgeGap.mockResolvedValue(openGap);
        analyticsMocks.resolveKnowledgeGap.mockResolvedValue({
            gapId,
            jobId: "50000000-0000-4000-a000-000000000001",
            sourceId: "40000000-0000-4000-a000-000000000001",
            status: "uploaded",
        });
        analyticsMocks.retestKnowledgeGap.mockResolvedValue(retest);
    });

    it("renders exact dashboard metrics and opens the grouped-gap workflow", async () =>
    {
        const openKnowledgeGaps = vi.fn();
        render(
            <DashboardWorkspace
                onOpenKnowledgeGaps={openKnowledgeGaps}
                session={session}
            />,
        );

        expect(await screen.findAllByText("75%")).toHaveLength(2);
        expect(screen.getAllByText("25%")).toHaveLength(2);
        expect(screen.getByText("3 AI-resolved without handoff")).toBeInTheDocument();
        expect(screen.getByText("2", { selector: "p" })).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: "Review knowledge gaps" }));
        expect(openKnowledgeGaps).toHaveBeenCalledOnce();
    });

    it("submits an approved manual answer through the selected gap detail", async () =>
    {
        render(
            <KnowledgeGapWorkspace
                initialGapId={gapId}
                onOpenGap={vi.fn()}
                session={session}
            />,
        );

        expect(await screen.findByText("One-click manual knowledge")).toBeInTheDocument();
        await userEvent.type(
            screen.getByLabelText("Knowledge title"),
            "NF-500 approved warranty",
        );
        await userEvent.type(
            screen.getByLabelText("Approved answer"),
            "The approved NF-500 warranty is two years.",
        );
        await userEvent.type(
            screen.getByLabelText(/Source note/u),
            "Approved demo policy.",
        );
        await userEvent.click(screen.getByRole("button", {
            name: "Create and embed knowledge",
        }));

        await waitFor(() =>
        {
            expect(analyticsMocks.resolveKnowledgeGap).toHaveBeenCalledWith(
                session,
                gapId,
                {
                    answer: "The approved NF-500 warranty is two years.",
                    sourceNote: "Approved demo policy.",
                    title: "NF-500 approved warranty",
                },
            );
        });
    });

    it("re-tests a resolved gap and displays its validated manual citation", async () =>
    {
        analyticsMocks.listKnowledgeGaps.mockResolvedValue([resolvedGap]);
        analyticsMocks.getKnowledgeGap.mockResolvedValue(resolvedGap);
        render(
            <KnowledgeGapWorkspace
                initialGapId={gapId}
                onOpenGap={vi.fn()}
                session={session}
            />,
        );

        const button = await screen.findByRole("button", {
            name: "Re-test original question",
        });
        await userEvent.click(button);

        expect(await screen.findByText("The approved NF-500 warranty is two years."))
            .toBeInTheDocument();
        expect(screen.getByText("Answer: The approved NF-500 warranty is two years."))
            .toBeInTheDocument();
        expect(analyticsMocks.retestKnowledgeGap).toHaveBeenCalledWith(session, gapId);
    });
});
