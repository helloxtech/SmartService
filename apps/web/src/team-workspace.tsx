import type { OrganizationMembership } from "@smartservice/contracts";
import type { Session } from "@supabase/supabase-js";
import {
    BookOpenCheck,
    Inbox,
    ShieldCheck,
} from "lucide-react";
import {
    useEffect,
    useState,
    type JSX,
    type MouseEvent,
} from "react";

import { AgentWorkspace } from "./agent-workspace";
import { GuardrailWorkspace } from "./guardrail-workspace";
import { KnowledgeWorkspace } from "./knowledge-workspace";

interface TeamWorkspaceProps
{
    membership: OrganizationMembership;
    session: Session;
}

type WorkspaceView = "guardrails" | "inbox" | "knowledge";

/**
 * readWorkspaceRoute
 * ----------------
 * Maps the current same-origin path to a bounded workspace view and optional conversation identifier.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Workspace
 */
function readWorkspaceRoute(pathname: string): {
    conversationId: string | null;
    view: WorkspaceView;
}
{
    const conversationMatch = /^\/app\/conversations\/([0-9a-f-]{36})\/?$/iu.exec(pathname);

    if (conversationMatch?.[1] !== undefined)
    {
        return {
            conversationId: conversationMatch[1],
            view: "inbox",
        };
    }

    if (pathname.startsWith("/app/settings/guardrails"))
    {
        return {
            conversationId: null,
            view: "guardrails",
        };
    }

    if (pathname.startsWith("/app/knowledge"))
    {
        return {
            conversationId: null,
            view: "knowledge",
        };
    }

    return {
        conversationId: null,
        view: "inbox",
    };
}

/**
 * TeamWorkspace
 * ----------------
 * Provides role-aware same-origin navigation across the agent inbox, knowledge, and Admin guardrail workspaces.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Agent Workspace
 */
export function TeamWorkspace({
    membership,
    session,
}: TeamWorkspaceProps): JSX.Element
{
    const [pathname, setPathname] = useState(window.location.pathname);
    const route = readWorkspaceRoute(pathname);
    const view = route.view === "guardrails" && membership.role !== "admin"
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
        {
            icon: Inbox,
            label: "Inbox",
            path: "/app/inbox",
            view: "inbox" as const,
        },
        {
            icon: BookOpenCheck,
            label: "Knowledge",
            path: "/app/knowledge",
            view: "knowledge" as const,
        },
        ...(membership.role === "admin"
            ? [{
                icon: ShieldCheck,
                label: "Guardrails",
                path: "/app/settings/guardrails",
                view: "guardrails" as const,
            }]
            : []),
    ];

    return (
        <>
            <nav aria-label="Team workspace" className="mx-auto mb-7 max-w-6xl px-6">
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
                        {view === "guardrails"
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
