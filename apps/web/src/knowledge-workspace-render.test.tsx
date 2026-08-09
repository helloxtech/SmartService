import type {
    KnowledgeSource,
    OrganizationMembership,
} from "@smartservice/contracts";
import type { Session } from "@supabase/supabase-js";
import {
    cleanup,
    render,
    screen,
} from "@testing-library/react";
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

const knowledgeMocks = vi.hoisted(() =>
{
    return {
        applySourceAction: vi.fn(),
        deleteKnowledgeSource: vi.fn(),
        listKnowledgeSources: vi.fn(),
        submitKnowledgeFile: vi.fn(),
        submitWebsite: vi.fn(),
    };
});

vi.mock("./lib/knowledge-api", () =>
{
    return {
        KnowledgeApiError: class extends Error
        {
        },
        ...knowledgeMocks,
    };
});

import { KnowledgeWorkspace } from "./knowledge-workspace";

const session = {
    access_token: "fixture-access-token",
    user: {
        id: "10000000-0000-4000-a000-000000000001",
    },
} as unknown as Session;
const membership: OrganizationMembership = {
    organization_id: "00000000-0000-4000-a000-000000000001",
    role: "admin",
};
const blockedSource: KnowledgeSource = {
    activeVersion: 1,
    chunkCount: 0,
    crawlMaxDepth: 2,
    crawlMaxPages: 10,
    createdAt: "2026-08-08T20:00:00.000Z",
    documentCount: 0,
    enabled: true,
    errorCode: "CRAWLER_POLICY_BLOCKED",
    errorMessage: "server fallback",
    id: "40000000-0000-4000-a000-000000000001",
    name: "example.com",
    pageCount: null,
    sourceUrl: "https://example.com/",
    standardPageCount: null,
    status: "failed",
    type: "url",
    updatedAt: "2026-08-08T20:01:00.000Z",
};

describe("knowledge workspace crawl-policy state", () =>
{
    afterEach(() =>
    {
        cleanup();
        vi.clearAllMocks();
    });

    it("renders the localized actionable policy diagnosis and retry control", async () =>
    {
        knowledgeMocks.listKnowledgeSources.mockResolvedValue([blockedSource]);

        render(
            <KnowledgeWorkspace
                language="zh-CN"
                membership={membership}
                session={session}
            />,
        );

        expect(await screen.findByText(/robots\.txt 已阻止/u)).toBeInTheDocument();
        expect(screen.getByText(/CloudflareBrowserRenderingCrawler/u)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "重新处理" })).toBeEnabled();
    });
});
