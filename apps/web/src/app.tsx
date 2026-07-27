import { organizationMembershipSchema, type OrganizationMembership } from "@smartservice/contracts";
import { Button } from "@smartservice/ui";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { CheckCircle2, Headphones, Languages, LockKeyhole } from "lucide-react";
import { useEffect, useState, type FormEvent, type JSX } from "react";

import { getSupabaseClient } from "./lib/supabase";

type AuthenticationState =
    | { kind: "loading" }
    | { kind: "signed-out" }
    | { kind: "signed-in"; membership: OrganizationMembership; session: Session };

/**
 * describeError
 * ----------------
 * Converts an unknown operational failure into safe user-facing text without exposing credentials or response bodies.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
function describeError(error: unknown): string
{
    if (error instanceof Error)
    {
        return error.message;
    }

    return "The request could not be completed.";
}

/**
 * loadMembership
 * ----------------
 * Loads and validates the signed-in user's active organization membership under Supabase RLS.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
async function loadMembership(client: SupabaseClient, session: Session): Promise<OrganizationMembership>
{
    const { data, error } = await client
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", session.user.id)
        .eq("is_active", true)
        .single();

    if (error !== null)
    {
        throw new Error("Your organization membership could not be loaded.");
    }

    return organizationMembershipSchema.parse(data);
}

/**
 * App
 * ----------------
 * Renders the Day 1 authentication shell and proves role-aware organization membership after sign-in.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
export function App(): JSX.Element
{
    const client = getSupabaseClient();
    const [authentication, setAuthentication] = useState<AuthenticationState>(
        client === null ? { kind: "signed-out" } : { kind: "loading" },
    );
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [message, setMessage] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() =>
    {
        if (client === null)
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

                const membership = await loadMembership(client, data.session);

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
                    setMessage(describeError(error));
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
    }, [client]);

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

        if (client === null)
        {
            setMessage("Local Supabase configuration is required before sign-in.");
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
                throw new Error("The email or password is not valid.");
            }

            const membership = await loadMembership(client, data.session);
            setAuthentication({
                kind: "signed-in",
                membership,
                session: data.session,
            });
            setPassword("");
        }
        catch (error: unknown)
        {
            setMessage(describeError(error));
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
        if (client !== null)
        {
            await client.auth.signOut();
        }

        setAuthentication({ kind: "signed-out" });
    }

    return (
        <main className="min-h-screen bg-slate-50 text-slate-950">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-xl bg-sky-700 text-white">
                            <Headphones aria-hidden="true" className="size-5" />
                        </div>
                        <div>
                            <p className="text-base font-bold tracking-tight">SmartService</p>
                            <p className="text-xs text-slate-500">NovaFlow demonstration workspace</p>
                        </div>
                    </div>
                    <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600">
                        Day 1 foundation
                    </span>
                </div>
            </header>

            <section className="mx-auto grid max-w-6xl gap-10 px-6 py-14 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
                <div>
                    <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">
                        Bilingual service, grounded answers
                    </p>
                    <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
                        A secure workspace for customer conversations and human handoff.
                    </h1>
                    <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
                        SmartService keeps company answers tied to approved knowledge, routes uncertain requests to people, and gives agents the context they need.
                    </p>

                    <div className="mt-8 grid gap-4 sm:grid-cols-3">
                        <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <Languages aria-hidden="true" className="mb-3 size-5 text-sky-700" />
                            <p className="font-semibold">中文 + English</p>
                            <p className="mt-1 text-sm text-slate-500">One shared service path.</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <LockKeyhole aria-hidden="true" className="mb-3 size-5 text-sky-700" />
                            <p className="font-semibold">Tenant isolated</p>
                            <p className="mt-1 text-sm text-slate-500">RLS is enforced from Day 1.</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <CheckCircle2 aria-hidden="true" className="mb-3 size-5 text-sky-700" />
                            <p className="font-semibold">Evidence first</p>
                            <p className="mt-1 text-sm text-slate-500">No unsupported answer.</p>
                        </div>
                    </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
                    {authentication.kind === "signed-in"
                        ? (
                            <div aria-live="polite">
                                <p className="text-sm font-semibold text-emerald-700">Workspace ready</p>
                                <h2 className="mt-2 text-2xl font-bold">Welcome back</h2>
                                <dl className="mt-6 space-y-4 text-sm">
                                    <div>
                                        <dt className="text-slate-500">Signed in as</dt>
                                        <dd className="mt-1 font-medium">{authentication.session.user.email}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-slate-500">Organization role</dt>
                                        <dd className="mt-1 font-medium capitalize">{authentication.membership.role}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-slate-500">Organization</dt>
                                        <dd className="mt-1 break-all font-mono text-xs">{authentication.membership.organization_id}</dd>
                                    </div>
                                </dl>
                                <Button className="mt-7 w-full" onClick={handleSignOut} variant="outline">
                                    Sign out
                                </Button>
                            </div>
                        )
                        : (
                            <>
                                <p className="text-sm font-semibold text-sky-700">Team access</p>
                                <h2 className="mt-2 text-2xl font-bold">Sign in to SmartService</h2>
                                <p className="mt-2 text-sm leading-6 text-slate-500">
                                    Use a fictional demo Admin or Agent identity. Credentials remain in local secret storage.
                                </p>

                                <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                                    <label className="block text-sm font-medium" htmlFor="email">
                                        Email
                                    </label>
                                    <input
                                        autoComplete="username"
                                        className="h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
                                        id="email"
                                        onChange={(event) => setEmail(event.target.value)}
                                        required
                                        type="email"
                                        value={email}
                                    />

                                    <label className="block text-sm font-medium" htmlFor="password">
                                        Password
                                    </label>
                                    <input
                                        autoComplete="current-password"
                                        className="h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
                                        id="password"
                                        onChange={(event) => setPassword(event.target.value)}
                                        required
                                        type="password"
                                        value={password}
                                    />

                                    {client === null
                                        ? (
                                            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">
                                                Local Supabase configuration is not present yet. The shell is ready; sign-in unlocks after the local project starts.
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

                                    <Button className="w-full" disabled={submitting} size="lg" type="submit">
                                        {submitting ? "Signing in…" : "Sign in"}
                                    </Button>
                                </form>
                            </>
                        )}
                </div>
            </section>
        </main>
    );
}
