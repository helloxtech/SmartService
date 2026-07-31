import { organizationMembershipSchema, type OrganizationMembership } from "@smartservice/contracts";
import { Button } from "@smartservice/ui";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
    CheckCircle2,
    Headphones,
    Languages,
    LockKeyhole,
    MessageCircle,
} from "lucide-react";
import {
    lazy,
    Suspense,
    useEffect,
    useState,
    type FormEvent,
    type JSX,
} from "react";

import { getSupabaseClient } from "./lib/supabase";
import {
    readInitialUiLanguage,
    writeUiLanguage,
} from "./language-state";
import {
    LanguageSwitch,
    type UiLanguage,
} from "./language";

type AuthenticationState =
    | { kind: "loading" }
    | { kind: "signed-out" }
    | { kind: "signed-in"; membership: OrganizationMembership; session: Session };

const appCopy: Record<UiLanguage, {
    authLoading: string;
    bilingualCardBody: string;
    bilingualCardTitle: string;
    configurationLoading: string;
    configurationMissing: string;
    email: string;
    evidenceCardBody: string;
    evidenceCardTitle: string;
    heroBody: string;
    heroEyebrow: string;
    heroTitle: string;
    membershipError: string;
    password: string;
    requestFailed: string;
    signIn: string;
    signInHeading: string;
    signInIntro: string;
    signInInvalid: string;
    signInLoading: string;
    signInRequiredConfiguration: string;
    signOut: string;
    teamAccess: string;
    tenantCardBody: string;
    tenantCardTitle: string;
    tryChat: string;
    voiceLoading: string;
    workspaceLoading: string;
    workspaceReady: string;
    workspaceSubtitle: string;
}> = {
    en: {
        authLoading: "Loading secure customer chat…",
        bilingualCardBody: "Choose English or Chinese; both use the same grounded service path.",
        bilingualCardTitle: "Language switch",
        configurationLoading: "Loading hosted Supabase configuration…",
        configurationMissing: "Supabase configuration is not available yet. Sign-in unlocks after hosted or local configuration is ready.",
        email: "Email",
        evidenceCardBody: "No unsupported answer.",
        evidenceCardTitle: "Evidence first",
        heroBody: "Smart Service keeps company answers tied to approved knowledge, routes uncertain requests to people, and gives agents the context they need.",
        heroEyebrow: "Bilingual service",
        heroTitle: "Secure customer conversations with AI and human handoff.",
        membershipError: "Your organization membership could not be loaded.",
        password: "Password",
        requestFailed: "The request could not be completed.",
        signIn: "Sign in",
        signInHeading: "Sign in to Smart Service",
        signInIntro: "Use a fictional demo Admin or Agent identity. Credentials remain in local secret storage.",
        signInInvalid: "The email or password is not valid.",
        signInLoading: "Signing in…",
        signInRequiredConfiguration: "Supabase configuration is required before sign-in.",
        signOut: "Sign out",
        teamAccess: "Team access",
        tenantCardBody: "RLS is enforced from Day 1.",
        tenantCardTitle: "Tenant isolated",
        tryChat: "Try customer chat",
        voiceLoading: "Loading secure voice support…",
        workspaceLoading: "Loading team workspace…",
        workspaceReady: "Workspace ready",
        workspaceSubtitle: "AI Assistant Workspace",
    },
    "zh-CN": {
        authLoading: "正在加载安全客户聊天…",
        bilingualCardBody: "可选择中文或英文；后台使用同一个有依据的客服流程。",
        bilingualCardTitle: "语言切换",
        configurationLoading: "正在加载 Supabase 配置…",
        configurationMissing: "Supabase 配置尚不可用；托管或本地配置完成后即可登录。",
        email: "邮箱",
        evidenceCardBody: "不编造没有证据的答案。",
        evidenceCardTitle: "证据优先",
        heroBody: "Smart Service 会基于已批准知识回答客户问题；证据不足时转交人工，并把上下文交给客服人员。",
        heroEyebrow: "中英文客服",
        heroTitle: "安全的 AI 客服对话和人工接入工作台。",
        membershipError: "无法加载组织权限。",
        password: "密码",
        requestFailed: "请求未完成。",
        signIn: "登录",
        signInHeading: "登录 Smart Service",
        signInIntro: "使用演示管理员或客服账号登录；凭据只保存在本地安全配置中。",
        signInInvalid: "邮箱或密码不正确。",
        signInLoading: "登录中…",
        signInRequiredConfiguration: "登录前需要 Supabase 配置。",
        signOut: "退出",
        teamAccess: "团队入口",
        tenantCardBody: "从第一天启用行级安全。",
        tenantCardTitle: "租户隔离",
        tryChat: "体验客户聊天",
        voiceLoading: "正在加载安全语音客服…",
        workspaceLoading: "正在加载团队工作台…",
        workspaceReady: "工作台已就绪",
        workspaceSubtitle: "AI 助手工作台",
    },
};

const TeamWorkspace = lazy(async () =>
{
    const module = await import("./team-workspace");

    return {
        default: module.TeamWorkspace,
    };
});

const PublicChat = lazy(async () =>
{
    const module = await import("./public-chat");

    return {
        default: module.PublicChat,
    };
});

const VoiceExperience = lazy(async () =>
{
    const module = await import("./voice-experience");

    return {
        default: module.VoiceExperience,
    };
});

/**
 * describeError
 * ----------------
 * Converts an unknown operational failure into safe user-facing text without exposing credentials or response bodies.
 *
 * July 30, 2026: Updated by Forrest Zhang for SmartService Chinese UI
 */
function describeError(error: unknown, language: UiLanguage): string
{
    if (error instanceof Error)
    {
        return error.message;
    }

    return appCopy[language].requestFailed;
}

/**
 * formatMembershipRole
 * ----------------
 * Converts stored membership role values into localized workspace labels without changing authorization logic.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService Workspace UX
 */
function formatMembershipRole(role: OrganizationMembership["role"], language: UiLanguage): string
{
    if (language === "zh-CN")
    {
        return role === "admin" ? "管理员" : "客服";
    }

    return role === "admin" ? "Admin" : "Agent";
}

/**
 * loadMembership
 * ----------------
 * Loads and validates the signed-in user's active organization membership under Supabase RLS.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
async function loadMembership(
    client: SupabaseClient,
    session: Session,
    language: UiLanguage,
): Promise<OrganizationMembership>
{
    const { data, error } = await client
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", session.user.id)
        .eq("is_active", true)
        .single();

    if (error !== null)
    {
        throw new Error(appCopy[language].membershipError);
    }

    return organizationMembershipSchema.parse(data);
}

/**
 * WorkspaceApp
 * ----------------
 * Renders the authenticated SmartService shell and role-aware operations workspace.
 *
 * July 30, 2026: Updated by Forrest Zhang for SmartService Language Switch
 */
function WorkspaceApp({
    language,
    onLanguageChange,
}: {
    language: UiLanguage;
    onLanguageChange: (language: UiLanguage) => void;
}): JSX.Element
{
    const copy = appCopy[language];
    const [client, setClient] = useState<SupabaseClient | null | undefined>(undefined);
    const [authentication, setAuthentication] = useState<AuthenticationState>({ kind: "loading" });
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [message, setMessage] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() =>
    {
        let mounted = true;

        getSupabaseClient()
            .then((configuredClient) =>
            {
                if (mounted)
                {
                    setClient(configuredClient);
                    if (configuredClient === null)
                    {
                        setAuthentication({ kind: "signed-out" });
                    }
                }
            })
            .catch((error: unknown) =>
            {
                if (mounted)
                {
                    setClient(null);
                    setMessage(describeError(error, language));
                    setAuthentication({ kind: "signed-out" });
                }
            });

        return () =>
        {
            mounted = false;
        };
    }, [language]);

    useEffect(() =>
    {
        if (client === null)
        {
            return;
        }

        if (client === undefined)
        {
            return;
        }

        let mounted = true;

        client.auth.getSession()
            .then(async ({ data }) =>
            {
                if (!mounted)
                {
                    return;
                }

                if (data.session === null)
                {
                    setAuthentication({ kind: "signed-out" });
                    return;
                }

                const membership = await loadMembership(client, data.session, language);

                if (mounted)
                {
                    setAuthentication({
                        kind: "signed-in",
                        membership,
                        session: data.session,
                    });
                }
            })
            .catch((error: unknown) =>
            {
                if (mounted)
                {
                    setMessage(describeError(error, language));
                    setAuthentication({ kind: "signed-out" });
                }
            });

        const { data } = client.auth.onAuthStateChange((event) =>
        {
            if (event === "SIGNED_OUT" && mounted)
            {
                setAuthentication({ kind: "signed-out" });
            }
        });

        return () =>
        {
            mounted = false;
            data.subscription.unsubscribe();
        };
    }, [client, language]);

    /**
     * handleSubmit
     * ----------------
     * Authenticates a user and verifies the RLS-constrained organization membership before showing the workspace.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
     */
    async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void>
    {
        event.preventDefault();
        setMessage(null);

        if (client === null || client === undefined)
        {
            setMessage(copy.signInRequiredConfiguration);
            return;
        }

        setSubmitting(true);

        try
        {
            const { data, error } = await client.auth.signInWithPassword({
                email,
                password,
            });

            if (error !== null)
            {
                throw new Error(copy.signInInvalid);
            }

            const membership = await loadMembership(client, data.session, language);
            setAuthentication({
                kind: "signed-in",
                membership,
                session: data.session,
            });
            setPassword("");
        }
        catch (error: unknown)
        {
            setMessage(describeError(error, language));
        }
        finally
        {
            setSubmitting(false);
        }
    }

    /**
     * handleSignOut
     * ----------------
     * Ends the current local Supabase session and clears the role-aware workspace state.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
     */
    async function handleSignOut(): Promise<void>
    {
        if (client !== null && client !== undefined)
        {
            await client.auth.signOut();
        }

        setAuthentication({ kind: "signed-out" });
    }

    return (
        <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_#dff6ff_0,_transparent_35rem),linear-gradient(135deg,_#f8fafc_0%,_#eef4ff_48%,_#f8fafc_100%)] text-slate-950">
            <header className="sticky top-0 z-20 border-b border-white/70 bg-white/75 backdrop-blur-2xl">
                <div className="mx-auto flex max-w-[118rem] items-center justify-between px-6 py-4 lg:px-8">
                    <div className="flex items-center gap-3">
                        <div className="flex size-11 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg shadow-slate-950/15">
                            <Headphones aria-hidden="true" className="size-5" />
                        </div>
                        <div>
                            <p className="text-base font-semibold tracking-tight">Smart Service</p>
                            <p className="text-xs text-slate-500">{copy.workspaceSubtitle}</p>
                        </div>
                    </div>
                    <LanguageSwitch
                        language={language}
                        onLanguageChange={onLanguageChange}
                    />
                </div>
            </header>

            <section className={authentication.kind === "signed-in"
                ? "mx-auto max-w-[118rem] px-6 py-5 lg:px-8"
                : "mx-auto grid max-w-[92rem] gap-10 px-6 py-14 lg:grid-cols-[1.2fr_0.8fr] lg:items-center lg:px-8"}>
                {authentication.kind === "signed-in"
                    ? null
                    : (
                        <div>
                            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">
                                {copy.heroEyebrow}
                            </p>
                            <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
                                {copy.heroTitle}
                            </h1>
                            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
                                {copy.heroBody}
                            </p>
                            <div className="mt-7">
                                <Button asChild size="lg">
                                    <a href="/chat">
                                        <MessageCircle aria-hidden="true" className="size-4" />
                                        {copy.tryChat}
                                    </a>
                                </Button>
                            </div>

                            <div className="mt-8 grid gap-4 sm:grid-cols-3">
                                <div className="rounded-2xl border border-white/70 bg-white/70 p-5 shadow-sm backdrop-blur-xl">
                                    <Languages aria-hidden="true" className="mb-3 size-5 text-sky-700" />
                                    <p className="font-semibold">{copy.bilingualCardTitle}</p>
                                    <p className="mt-1 text-sm text-slate-500">{copy.bilingualCardBody}</p>
                                </div>
                                <div className="rounded-2xl border border-white/70 bg-white/70 p-5 shadow-sm backdrop-blur-xl">
                                    <LockKeyhole aria-hidden="true" className="mb-3 size-5 text-sky-700" />
                                    <p className="font-semibold">{copy.tenantCardTitle}</p>
                                    <p className="mt-1 text-sm text-slate-500">{copy.tenantCardBody}</p>
                                </div>
                                <div className="rounded-2xl border border-white/70 bg-white/70 p-5 shadow-sm backdrop-blur-xl">
                                    <CheckCircle2 aria-hidden="true" className="mb-3 size-5 text-sky-700" />
                                    <p className="font-semibold">{copy.evidenceCardTitle}</p>
                                    <p className="mt-1 text-sm text-slate-500">{copy.evidenceCardBody}</p>
                                </div>
                            </div>
                        </div>
                    )}

                <div className={authentication.kind === "signed-in"
                    ? "rounded-2xl border border-white/70 bg-white/78 px-4 py-3 shadow-[0_18px_50px_rgb(15_23_42/0.08)] backdrop-blur-2xl"
                    : "rounded-[2rem] border border-white/70 bg-white/82 p-7 shadow-[0_24px_80px_rgb(15_23_42/0.12)] backdrop-blur-2xl"}>
                    {authentication.kind === "signed-in"
                        ? (
                            <div
                                aria-live="polite"
                                className="flex flex-wrap items-center justify-between gap-3"
                            >
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                                        {copy.workspaceReady}
                                    </p>
                                    <p className="mt-1 text-sm font-medium">
                                        {authentication.session.user.email}
                                        <span className="ml-2 text-slate-500">
                                            · {formatMembershipRole(authentication.membership.role, language)}
                                        </span>
                                    </p>
                                </div>
                                <Button onClick={handleSignOut} size="sm" variant="outline">
                                    {copy.signOut}
                                </Button>
                            </div>
                        )
                        : (
                            <>
                                <p className="text-sm font-semibold text-sky-700">{copy.teamAccess}</p>
                                <h2 className="mt-2 text-2xl font-bold">{copy.signInHeading}</h2>
                                <p className="mt-2 text-sm leading-6 text-slate-500">
                                    {copy.signInIntro}
                                </p>

                                <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                                    <label className="block text-sm font-medium" htmlFor="email">
                                        {copy.email}
                                    </label>
                                    <input
                                        autoComplete="username"
                                        className="h-11 w-full rounded-xl border border-slate-200 bg-white/90 px-3 outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-200/70"
                                        id="email"
                                        onChange={(event) => setEmail(event.target.value)}
                                        required
                                        type="email"
                                        value={email}
                                    />

                                    <label className="block text-sm font-medium" htmlFor="password">
                                        {copy.password}
                                    </label>
                                    <input
                                        autoComplete="current-password"
                                        className="h-11 w-full rounded-xl border border-slate-200 bg-white/90 px-3 outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-200/70"
                                        id="password"
                                        onChange={(event) => setPassword(event.target.value)}
                                        required
                                        type="password"
                                        value={password}
                                    />

                                    {client === undefined
                                        ? (
                                            <p className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900" role="status">
                                                {copy.configurationLoading}
                                            </p>
                                        )
                                        : null}

                                    {client === null
                                        ? (
                                            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">
                                                {copy.configurationMissing}
                                            </p>
                                        )
                                        : null}

                                    {message === null
                                        ? null
                                        : (
                                            <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800" role="alert">
                                                {message}
                                            </p>
                                        )}

                                    <Button className="w-full" disabled={submitting || client === undefined} size="lg" type="submit">
                                        {submitting ? copy.signInLoading : copy.signIn}
                                    </Button>
                                </form>
                            </>
                        )}
                </div>
            </section>

            {authentication.kind === "signed-in"
                ? (
                    <Suspense
                        fallback={(
                            <div className="mx-auto max-w-[118rem] px-6 pb-16 text-sm text-slate-500 lg:px-8" role="status">
                                {copy.workspaceLoading}
                            </div>
                        )}
                    >
                        <TeamWorkspace
                            language={language}
                            membership={authentication.membership}
                            session={authentication.session}
                        />
                    </Suspense>
                )
                : null}
        </main>
    );
}

/**
 * App
 * ----------------
 * Routes public customer chat separately from the authenticated P0 operations workspace without exposing Supabase to customers.
 *
 * July 30, 2026: Updated by Forrest Zhang for SmartService Language Switch
 */
export function App(): JSX.Element
{
    const [language, setLanguage] = useState<UiLanguage>(readInitialUiLanguage);
    const copy = appCopy[language];

    /**
     * handleLanguageChange
     * ----------------
     * Updates the current UI language, persists it locally, and keeps the document language aligned for assistive technology.
     *
     * July 30, 2026: Created by Forrest Zhang for SmartService Language Switch
     */
    function handleLanguageChange(nextLanguage: UiLanguage): void
    {
        setLanguage(nextLanguage);
        writeUiLanguage(nextLanguage);
        document.documentElement.lang = nextLanguage === "zh-CN" ? "zh-CN" : "en";
    }

    useEffect(() =>
    {
        document.documentElement.lang = language === "zh-CN" ? "zh-CN" : "en";
    }, [language]);

    if (window.location.pathname.startsWith("/voice"))
    {
        return (
            <Suspense
                fallback={(
                    <main className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">
                        {copy.voiceLoading}
                    </main>
                )}
            >
                <VoiceExperience
                    uiLanguage={language}
                    onUiLanguageChange={handleLanguageChange}
                />
            </Suspense>
        );
    }

    if (window.location.pathname.startsWith("/chat"))
    {
        return (
            <Suspense
                fallback={(
                    <main className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">
                        {copy.authLoading}
                    </main>
                )}
            >
                <PublicChat
                    uiLanguage={language}
                    onUiLanguageChange={handleLanguageChange}
                />
            </Suspense>
        );
    }

    return (
        <WorkspaceApp
            language={language}
            onLanguageChange={handleLanguageChange}
        />
    );
}
