import type {
    KnowledgeSource,
    OrganizationMembership,
} from "@smartservice/contracts";
import type { Session } from "@supabase/supabase-js";
import {
    cleanup,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
const disabledSource: KnowledgeSource = {
    ...blockedSource,
    chunkCount: 37,
    documentCount: 10,
    enabled: false,
    errorCode: null,
    errorMessage: null,
    name: "appleseedsmhp.com",
    sourceUrl: "https://appleseedsmhp.com/",
    status: "disabled",
};

describe("knowledge workspace source management", () =>
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

    it("requires an in-page confirmation and supports cancel before deleting", async () =>
    {
        const user = userEvent.setup();
        knowledgeMocks.listKnowledgeSources.mockResolvedValue([disabledSource]);

        render(
            <KnowledgeWorkspace
                language="zh-CN"
                membership={membership}
                session={session}
            />,
        );

        const deleteButton = await screen.findByRole("button", { name: "删除 appleseedsmhp.com" });
        await user.click(deleteButton);

        const dialog = screen.getByRole("alertdialog", { name: "删除 appleseedsmhp.com" });
        expect(within(dialog).getByText("删除“appleseedsmhp.com”并从检索中移除？")).toBeInTheDocument();
        expect(knowledgeMocks.deleteKnowledgeSource).not.toHaveBeenCalled();

        await user.click(within(dialog).getByRole("button", { name: "取消" }));

        expect(screen.queryByRole("alertdialog", { name: "删除 appleseedsmhp.com" })).not.toBeInTheDocument();
        expect(knowledgeMocks.deleteKnowledgeSource).not.toHaveBeenCalled();
    });

    it("deletes only after explicit confirmation and removes the source immediately", async () =>
    {
        const user = userEvent.setup();
        knowledgeMocks.listKnowledgeSources
            .mockResolvedValueOnce([disabledSource])
            .mockResolvedValue([]);
        knowledgeMocks.deleteKnowledgeSource.mockResolvedValue(undefined);

        render(
            <KnowledgeWorkspace
                language="zh-CN"
                membership={membership}
                session={session}
            />,
        );

        await user.click(await screen.findByRole("button", { name: "删除 appleseedsmhp.com" }));
        const dialog = screen.getByRole("alertdialog", { name: "删除 appleseedsmhp.com" });
        await user.click(within(dialog).getByRole("button", { name: "确认删除" }));

        await waitFor(() =>
        {
            expect(knowledgeMocks.deleteKnowledgeSource).toHaveBeenCalledWith(
                session,
                disabledSource.id,
            );
        });
        expect(await screen.findByText("暂无知识来源")).toBeInTheDocument();
    });

    it("keeps the in-page confirmation visible when deletion fails", async () =>
    {
        const user = userEvent.setup();
        knowledgeMocks.listKnowledgeSources.mockResolvedValue([disabledSource]);
        knowledgeMocks.deleteKnowledgeSource.mockRejectedValue(new Error("Delete request failed."));

        render(
            <KnowledgeWorkspace
                language="zh-CN"
                membership={membership}
                session={session}
            />,
        );

        await user.click(await screen.findByRole("button", { name: "删除 appleseedsmhp.com" }));
        await user.click(screen.getByRole("button", { name: "确认删除" }));

        expect(await screen.findByText("Delete request failed.")).toBeInTheDocument();
        expect(screen.getByRole("alertdialog", { name: "删除 appleseedsmhp.com" })).toBeInTheDocument();
    });

    it("does not create a duplicate when the website already exists", async () =>
    {
        const user = userEvent.setup();
        knowledgeMocks.listKnowledgeSources.mockResolvedValue([disabledSource]);

        render(
            <KnowledgeWorkspace
                language="zh-CN"
                membership={membership}
                session={session}
            />,
        );

        const urlInput = screen.getByRole("textbox", { name: "网站地址" });
        await user.clear(urlInput);
        await user.type(urlInput, "https://appleseedsmhp.com/");
        await user.click(screen.getByRole("button", { name: "验证并抓取" }));

        expect(await screen.findByText(/该网站已在下方来源列表中/u)).toBeInTheDocument();
        expect(knowledgeMocks.submitWebsite).not.toHaveBeenCalled();
    });

    it("adds a deliberately resubmitted deleted website to the refreshed source list", async () =>
    {
        const user = userEvent.setup();
        const uploadedSource: KnowledgeSource = {
            ...disabledSource,
            enabled: true,
            id: "40000000-0000-4000-a000-000000000002",
            status: "uploaded",
        };
        knowledgeMocks.listKnowledgeSources
            .mockResolvedValueOnce([])
            .mockResolvedValue([uploadedSource]);
        knowledgeMocks.submitWebsite.mockResolvedValue({
            jobId: "50000000-0000-4000-a000-000000000001",
            sourceId: uploadedSource.id,
            status: "uploaded",
        });

        render(
            <KnowledgeWorkspace
                language="zh-CN"
                membership={membership}
                session={session}
            />,
        );

        const urlInput = await screen.findByRole("textbox", { name: "网站地址" });
        await user.clear(urlInput);
        await user.type(urlInput, "https://appleseedsmhp.com/");
        await user.click(screen.getByRole("button", { name: "验证并抓取" }));

        await waitFor(() =>
        {
            expect(knowledgeMocks.submitWebsite).toHaveBeenCalledWith(session, {
                maxDepth: 2,
                maxPages: 10,
                url: "https://appleseedsmhp.com/",
            });
        });
        expect(await screen.findByText("appleseedsmhp.com")).toBeInTheDocument();
    });
});
