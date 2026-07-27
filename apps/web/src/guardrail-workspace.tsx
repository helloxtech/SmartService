import type {
    CreateGuardrailRuleRequest,
    GuardrailEvent,
    GuardrailRule,
    UpdateGuardrailRuleRequest,
} from "@smartservice/contracts";
import { Button } from "@smartservice/ui";
import type { Session } from "@supabase/supabase-js";
import {
    AlertTriangle,
    Eye,
    LoaderCircle,
    Plus,
    Save,
    ShieldCheck,
} from "lucide-react";
import {
    useEffect,
    useState,
    type FormEvent,
    type JSX,
} from "react";

import {
    createGuardrailRule,
    getGuardrailCandidate,
    listGuardrailEvents,
    listGuardrailRules,
    TeamApiError,
    updateGuardrailRule,
} from "./lib/team-api";

interface GuardrailWorkspaceProps
{
    session: Session;
}

interface RuleEditorProps
{
    onSaved(rule: GuardrailRule): void;
    rule: GuardrailRule;
    session: Session;
}

const ruleTypes: GuardrailRule["ruleType"][] = [
    "price",
    "delivery",
    "competitor",
    "security",
    "unsupported_claim",
    "safety",
    "custom",
];

const severities: GuardrailRule["severity"][] = [
    "low",
    "medium",
    "high",
    "critical",
];

/**
 * describeError
 * ----------------
 * Converts guardrail API failures into concise Admin-facing guidance.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrail Administration
 */
function describeError(error: unknown): string
{
    if (error instanceof TeamApiError || error instanceof Error)
    {
        return error.message;
    }

    return "The guardrail operation could not be completed.";
}

/**
 * formatTime
 * ----------------
 * Formats a guardrail event timestamp in the Admin's local browser timezone.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrail Logs
 */
function formatTime(value: string): string
{
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(value));
}

/**
 * RuleEditor
 * ----------------
 * Lets an Admin edit simple typed rule fields without authoring regular expressions or model prompts.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrail Administration
 */
function RuleEditor({
    onSaved,
    rule,
    session,
}: RuleEditorProps): JSX.Element
{
    const [draft, setDraft] = useState<UpdateGuardrailRuleRequest>({
        description: rule.description,
        enabled: rule.enabled,
        name: rule.name,
        ruleType: rule.ruleType,
        safeResponse: rule.safeResponse,
        severity: rule.severity,
    });
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    /**
     * handleSave
     * ----------------
     * Persists the complete visible rule draft through the audited Admin endpoint.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrail Administration
     */
    async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void>
    {
        event.preventDefault();
        setSaving(true);
        setMessage(null);

        try
        {
            const saved = await updateGuardrailRule(session, rule.id, draft);
            onSaved(saved);
            setMessage("Saved.");
        }
        catch (error: unknown)
        {
            setMessage(describeError(error));
        }
        finally
        {
            setSaving(false);
        }
    }

    return (
        <form className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={handleSave}>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p className="font-mono text-xs font-bold text-sky-700">{rule.code}</p>
                    <p className="mt-1 text-xs text-slate-400">Preset type: {draft.ruleType}</p>
                </div>
                <label className="flex items-center gap-2 text-sm font-semibold">
                    <input
                        checked={draft.enabled ?? false}
                        className="size-4 rounded border-slate-300"
                        onChange={(event) => setDraft({
                            ...draft,
                            enabled: event.target.checked,
                        })}
                        type="checkbox"
                    />
                    Enabled
                </label>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-700">
                    Rule name
                    <input
                        className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                        maxLength={160}
                        onChange={(event) => setDraft({
                            ...draft,
                            name: event.target.value,
                        })}
                        required
                        value={draft.name ?? ""}
                    />
                </label>
                <label className="text-xs font-semibold text-slate-700">
                    Severity
                    <select
                        className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                        onChange={(event) => setDraft({
                            ...draft,
                            severity: event.target.value as GuardrailRule["severity"],
                        })}
                        value={draft.severity}
                    >
                        {severities.map((severity) => (
                            <option key={severity} value={severity}>{severity}</option>
                        ))}
                    </select>
                </label>
            </div>

            <label className="mt-4 block text-xs font-semibold text-slate-700">
                Description
                <textarea
                    className="mt-1.5 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    maxLength={2000}
                    onChange={(event) => setDraft({
                        ...draft,
                        description: event.target.value,
                    })}
                    required
                    value={draft.description ?? ""}
                />
            </label>

            <label className="mt-4 block text-xs font-semibold text-slate-700">
                Safe customer response
                <textarea
                    className="mt-1.5 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    maxLength={4000}
                    onChange={(event) => setDraft({
                        ...draft,
                        safeResponse: event.target.value,
                    })}
                    required
                    value={draft.safeResponse ?? ""}
                />
            </label>

            <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500" role="status">{message}</p>
                <Button disabled={saving} size="sm" type="submit">
                    {saving
                        ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                        : <Save aria-hidden="true" className="size-4" />}
                    Save rule
                </Button>
            </div>
        </form>
    );
}

/**
 * GuardrailWorkspace
 * ----------------
 * Renders Admin rule configuration, redacted event logs, and explicit candidate-access controls.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrail Administration
 */
export function GuardrailWorkspace({
    session,
}: GuardrailWorkspaceProps): JSX.Element
{
    const [rules, setRules] = useState<GuardrailRule[]>([]);
    const [events, setEvents] = useState<GuardrailEvent[]>([]);
    const [candidateByEvent, setCandidateByEvent] = useState<Record<string, string | null>>({});
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [newRule, setNewRule] = useState<CreateGuardrailRuleRequest>({
        code: "CUSTOM_RULE",
        description: "Describe the customer or candidate output that must be escalated.",
        enabled: true,
        name: "Custom escalation",
        ruleType: "custom",
        safeResponse: "I cannot help with that request. I have handed the conversation to a human specialist.",
        severity: "high",
    });

    useEffect(() =>
    {
        let active = true;

        /**
         * loadGuardrails
         * ----------------
         * Loads rule configuration and redacted event logs while ignoring results after unmount.
         *
         * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrail Administration
         */
        async function loadGuardrails(): Promise<void>
        {
            try
            {
                const [currentRules, currentEvents] = await Promise.all([
                    listGuardrailRules(session),
                    listGuardrailEvents(session),
                ]);

                if (active)
                {
                    setRules(currentRules);
                    setEvents(currentEvents);
                    setLoading(false);
                }
            }
            catch (error: unknown)
            {
                if (active)
                {
                    setMessage(describeError(error));
                    setLoading(false);
                }
            }
        }

        void loadGuardrails();
        const intervalId = globalThis.setInterval(() =>
        {
            void listGuardrailEvents(session)
                .then((currentEvents) =>
                {
                    if (active)
                    {
                        setEvents(currentEvents);
                    }
                })
                .catch(() =>
                {
                    // Keep the last valid log view during a transient poll failure.
                });
        }, 3_000);

        return () =>
        {
            active = false;
            globalThis.clearInterval(intervalId);
        };
    }, [session]);

    /**
     * handleCreate
     * ----------------
     * Creates a new typed tenant rule and inserts it into the current Admin view.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrail Administration
     */
    async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void>
    {
        event.preventDefault();
        setCreating(true);
        setMessage(null);

        try
        {
            const created = await createGuardrailRule(session, newRule);
            setRules((current) => [...current, created].sort((left, right) =>
            {
                return left.code.localeCompare(right.code);
            }));
            setNewRule({
                ...newRule,
                code: "CUSTOM_RULE_2",
                name: "New custom escalation",
            });
            setMessage("Guardrail rule created.");
        }
        catch (error: unknown)
        {
            setMessage(describeError(error));
        }
        finally
        {
            setCreating(false);
        }
    }

    /**
     * handleSaved
     * ----------------
     * Replaces one edited rule with the authoritative API response.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrail Administration
     */
    function handleSaved(saved: GuardrailRule): void
    {
        setRules((current) => current.map((rule) =>
        {
            return rule.id === saved.id ? saved : rule;
        }));
    }

    /**
     * handleCandidate
     * ----------------
     * Performs the explicit Admin-only candidate read and never includes that text in the normal event list.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrail Privacy
     */
    async function handleCandidate(eventId: string): Promise<void>
    {
        setMessage(null);

        try
        {
            const candidate = await getGuardrailCandidate(session, eventId);
            setCandidateByEvent((current) => ({
                ...current,
                [eventId]: candidate,
            }));
        }
        catch (error: unknown)
        {
            setMessage(describeError(error));
        }
    }

    return (
        <section aria-labelledby="guardrail-heading">
            <div>
                <p className="text-sm font-semibold text-sky-700">Configurable safety boundary</p>
                <h2 className="mt-1 text-3xl font-bold tracking-tight" id="guardrail-heading">
                    Guardrails
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                    Configure simple rule fields and safe replies. Deterministic checks and the auxiliary supervisor both enforce enabled rules before customers see an answer.
                </p>
            </div>

            {message === null
                ? null
                : (
                    <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900" role="status">
                        {message}
                    </div>
                )}

            <form className="mt-6 rounded-2xl border border-sky-200 bg-sky-50/50 p-5" onSubmit={handleCreate}>
                <h3 className="flex items-center gap-2 font-bold">
                    <Plus aria-hidden="true" className="size-4" />
                    New rule
                </h3>
                <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <label className="text-xs font-semibold">
                        Code
                        <input
                            className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm"
                            onChange={(event) => setNewRule({
                                ...newRule,
                                code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/gu, "_"),
                            })}
                            pattern="[A-Z][A-Z0-9_]{2,79}"
                            required
                            value={newRule.code}
                        />
                    </label>
                    <label className="text-xs font-semibold">
                        Name
                        <input
                            className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                            onChange={(event) => setNewRule({
                                ...newRule,
                                name: event.target.value,
                            })}
                            required
                            value={newRule.name}
                        />
                    </label>
                    <label className="text-xs font-semibold">
                        Preset type
                        <select
                            className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                            onChange={(event) => setNewRule({
                                ...newRule,
                                ruleType: event.target.value as GuardrailRule["ruleType"],
                            })}
                            value={newRule.ruleType}
                        >
                            {ruleTypes.map((type) => (
                                <option key={type} value={type}>{type}</option>
                            ))}
                        </select>
                    </label>
                    <label className="text-xs font-semibold">
                        Severity
                        <select
                            className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                            onChange={(event) => setNewRule({
                                ...newRule,
                                severity: event.target.value as GuardrailRule["severity"],
                            })}
                            value={newRule.severity}
                        >
                            {severities.map((severity) => (
                                <option key={severity} value={severity}>{severity}</option>
                            ))}
                        </select>
                    </label>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="text-xs font-semibold">
                        Description
                        <textarea
                            className="mt-1.5 min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            onChange={(event) => setNewRule({
                                ...newRule,
                                description: event.target.value,
                            })}
                            required
                            value={newRule.description}
                        />
                    </label>
                    <label className="text-xs font-semibold">
                        Safe response
                        <textarea
                            className="mt-1.5 min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            onChange={(event) => setNewRule({
                                ...newRule,
                                safeResponse: event.target.value,
                            })}
                            required
                            value={newRule.safeResponse}
                        />
                    </label>
                </div>
                <div className="mt-4 flex justify-end">
                    <Button disabled={creating} type="submit">
                        {creating
                            ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                            : <Plus aria-hidden="true" className="size-4" />}
                        Create rule
                    </Button>
                </div>
            </form>

            <div className="mt-8">
                <h3 className="flex items-center gap-2 text-lg font-bold">
                    <ShieldCheck aria-hidden="true" className="size-5 text-emerald-700" />
                    Active configuration
                </h3>
                {loading
                    ? (
                        <p className="mt-4 flex items-center gap-2 text-sm text-slate-500">
                            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                            Loading rules…
                        </p>
                    )
                    : (
                        <div className="mt-4 grid gap-4 xl:grid-cols-2">
                            {rules.map((rule) => (
                                <RuleEditor
                                    key={rule.id}
                                    onSaved={handleSaved}
                                    rule={rule}
                                    session={session}
                                />
                            ))}
                        </div>
                    )}
            </div>

            <div className="mt-10">
                <h3 className="flex items-center gap-2 text-lg font-bold">
                    <AlertTriangle aria-hidden="true" className="size-5 text-amber-600" />
                    Block log
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                    Normal log responses are redacted. Candidate text requires the separate Admin-only action below.
                </p>

                <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    {events.length === 0
                        ? (
                            <p className="p-6 text-sm text-slate-500">No guardrail events yet.</p>
                        )
                        : events.map((event) => (
                            <article className="border-b border-slate-200 p-5 last:border-b-0" key={event.id}>
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <p className="font-mono text-xs font-bold text-amber-800">
                                            {event.ruleCode} · {event.severity}
                                        </p>
                                        <p className="mt-2 text-sm leading-6 text-slate-700">{event.reason}</p>
                                        <p className="mt-2 text-xs text-slate-400">
                                            {formatTime(event.createdAt)} · conversation {event.conversationId.slice(0, 8)}…
                                        </p>
                                    </div>
                                    <Button onClick={() => void handleCandidate(event.id)} size="sm" variant="outline">
                                        <Eye aria-hidden="true" className="size-4" />
                                        Admin view candidate
                                    </Button>
                                </div>
                                {Object.hasOwn(candidateByEvent, event.id)
                                    ? (
                                        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
                                            <p className="text-xs font-bold uppercase tracking-wide text-rose-800">
                                                Withheld candidate
                                            </p>
                                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-rose-950">
                                                {candidateByEvent[event.id] ?? "No candidate was generated; the input check blocked first."}
                                            </p>
                                        </div>
                                    )
                                    : null}
                            </article>
                        ))}
                </div>
            </div>
        </section>
    );
}
