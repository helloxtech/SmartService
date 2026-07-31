import type { OrganizationMembership } from "@smartservice/contracts";
import type { Session } from "@supabase/supabase-js";
import {
    BookOpenCheck,
    CircleHelp,
    Inbox,
    LayoutDashboard,
    ShieldCheck,
} from "lucide-react";
import {
    useEffect,
    useState,
    type JSX,
    type MouseEvent,
} from "react";

import { AgentWorkspace } from "./agent-workspace";
import { DashboardWorkspace } from "./dashboard-workspace";
import { GuardrailWorkspace } from "./guardrail-workspace";
import { KnowledgeGapWorkspace } from "./knowledge-gap-workspace";
import { KnowledgeWorkspace } from "./knowledge-workspace";
import type { UiLanguage } from "./language";

interface TeamWorkspaceProps
{
    language: UiLanguage;
    membership: OrganizationMembership;
    session: Session;
}

type WorkspaceView = "dashboard" | "gaps" | "guardrails" | "inbox" | "knowledge";

const navigationLabels: Record<UiLanguage, Record<WorkspaceView, string>> = {
    en: {
        dashboard: "Dashboard",
        gaps: "Knowledge gaps",
        guardrails: "Guardrails",
        inbox: "Inbox",
        knowledge: "Knowledge",
    },
    "zh-CN": {
        dashboard: "数据看板",
        gaps: "知识缺口",
        guardrails: "安全规则",
        inbox: "会话",
        knowledge: "知识库",
    },
};

/**
 * readWorkspaceRoute
 * ----------------
 * Maps the current same-origin path to a bounded workspace view and optional conversation identifier.
 *
 * July 30, 2026: Updated by Forrest Zhang for SmartService XFlow Chinese UI
 */
function readWorkspaceRoute(pathname: string): {
    conversationId: string | null;
    gapId: string | null;
    view: WorkspaceView;
}
{
    const conversationMatch = /^\/app\/conversations\/([0-9a-f-]{36})\/?$/iu.exec(pathname);

    if (conversationMatch?.[1] !== undefined)
    {
        return {
            conversationId: conversationMatch[1],
            gapId: null,
            view: "inbox",
        };
    }

    const gapMatch = /^\/app\/knowledge-gaps\/([0-9a-f-]{36})\/?$/iu.exec(pathname);

    if (gapMatch?.[1] !== undefined)
    {
        return {
            conversationId: null,
            gapId: gapMatch[1],
            view: "gaps",
        };
    }

    if (pathname.startsWith("/app/knowledge-gaps"))
    {
        return {
            conversationId: null,
            gapId: null,
            view: "gaps",
        };
    }

    if (pathname.startsWith("/app/dashboard"))
    {
        return {
            conversationId: null,
            gapId: null,
            view: "dashboard",
        };
    }

    if (pathname.startsWith("/app/settings/guardrails"))
    {
        return {
            conversationId: null,
            gapId: null,
            view: "guardrails",
        };
    }

    if (pathname.startsWith("/app/knowledge"))
    {
        return {
            conversationId: null,
            gapId: null,
            view: "knowledge",
        };
    }

    return {
        conversationId: null,
        gapId: null,
        view: "inbox",
    };
}

/**
 * TeamWorkspace
 * ----------------
 * Provides role-aware navigation across inbox, knowledge, dashboard, gap-resolution, and guardrail workspaces.
 *
 * July 30, 2026: Updated by Forrest Zhang for SmartService Language Switch
 */
export function TeamWorkspace({
    language,
    membership,
    session,
}: TeamWorkspaceProps): JSX.Element
{
    const labels = navigationLabels[language];
    const [pathname, setPathname] = useState(window.location.pathname);
    const route = readWorkspaceRoute(pathname);
    const view = (
        route.view === "guardrails"
        || route.view === "dashboard"
        || route.view === "gaps"
    ) && membership.role !== "admin"
        ? "inbox"
        : route.view;

    useEffect(() =>
    {
        /**
         * handlePopState
         * ----------------
         * Synchronizes the lightweight workspace router with browser back and forward navigation.
         *
         * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Workspace
         */
        function handlePopState(): void
        {
            setPathname(window.location.pathname);
        }

        globalThis.addEventListener("popstate", handlePopState);
        return () =>
        {
            globalThis.removeEventListener("popstate", handlePopState);
        };
    }, []);

    /**
     * navigate
     * ----------------
     * Updates same-origin history and the current workspace view without adding a routing dependency.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Workspace
     */
    function navigate(path: string): void
    {
        globalThis.history.pushState({}, "", path);
        setPathname(path);
    }

    /**
     * handleNavigation
     * ----------------
     * Preserves accessible links while intercepting unmodified local clicks for in-app navigation.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Workspace
     */
    function handleNavigation(
        event: MouseEvent<HTMLAnchorElement>,
        path: string,
    ): void
    {
        if (
            event.button !== 0
            || event.metaKey
            || event.ctrlKey
            || event.shiftKey
            || event.altKey
        )
        {
            return;
        }

        event.preventDefault();
        navigate(path);
    }

    const navigation = [
        ...(membership.role === "admin"
            ? [{
                icon: LayoutDashboard,
                label: labels.dashboard,
                path: "/app/dashboard",
                view: "dashboard" as const,
            }]
            : []),
        {
            icon: Inbox,
            label: labels.inbox,
            path: "/app/inbox",
            view: "inbox" as const,
        },
        {
            icon: BookOpenCheck,
            label: labels.knowledge,
            path: "/app/knowledge",
            view: "knowledge" as const,
        },
        ...(membership.role === "admin"
            ? [
                {
                    icon: CircleHelp,
                    label: labels.gaps,
                    path: "/app/knowledge-gaps",
                    view: "gaps" as const,
                },
                {
                    icon: ShieldCheck,
                    label: labels.guardrails,
                    path: "/app/settings/guardrails",
                    view: "guardrails" as const,
                },
            ]
            : []),
    ];

    return (
        <>
            <nav aria-label={language === "zh-CN" ? "团队工作台" : "Team workspace"} className="mx-auto mb-7 max-w-6xl px-6">
                <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                    {navigation.map((item) =>
                    {
                        const Icon = item.icon;
                        const active = view === item.view;

                        return (
                            <a
                                aria-current={active ? "page" : undefined}
                                className={active
                                    ? "flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
                                    : "flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"}
                                href={item.path}
                                key={item.path}
                                onClick={(event) => handleNavigation(event, item.path)}
                            >
                                <Icon aria-hidden="true" className="size-4" />
                                {item.label}
                            </a>
                        );
                    })}
                </div>
            </nav>

            {view === "knowledge"
                ? (
                    <KnowledgeWorkspace
                        membership={membership}
                        session={session}
                    />
                )
                : (
                    <div className="mx-auto max-w-6xl px-6 pb-16">
                        {view === "dashboard"
                            ? (
                                <DashboardWorkspace
                                    onOpenKnowledgeGaps={() => navigate("/app/knowledge-gaps")}
                                    session={session}
                                />
                            )
                            : view === "gaps"
                                ? (
                                    <KnowledgeGapWorkspace
                                        initialGapId={route.gapId}
                                        key={route.gapId ?? "knowledge-gaps"}
                                        onOpenGap={(gapId) =>
                                        {
                                            navigate(gapId === null
                                                ? "/app/knowledge-gaps"
                                                : `/app/knowledge-gaps/${gapId}`);
                                        }}
                                        session={session}
                                    />
                                )
                                : view === "guardrails"
                                    ? <GuardrailWorkspace session={session} />
                                    : (
                                        <AgentWorkspace
                                            initialConversationId={route.conversationId}
                                            key={route.conversationId ?? "inbox"}
                                            onOpenConversation={(conversationId) =>
                                            {
                                                navigate(`/app/conversations/${conversationId}`);
                                            }}
                                            session={session}
                                        />
                                    )}
                    </div>
                )}
        </>
    );
}
