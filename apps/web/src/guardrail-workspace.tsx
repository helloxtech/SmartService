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
import type { UiLanguage } from "./language";

interface GuardrailWorkspaceProps
{
    language?: UiLanguage;
    session: Session;
}

interface RuleEditorProps
{
    language: UiLanguage;
    onSaved(rule: GuardrailRule): void;
    rule: GuardrailRule;
    session: Session;
}

const guardrailCopy: Record<UiLanguage, {
    activeConfiguration: string;
    adminCandidate: string;
    blockLog: string;
    candidateEmpty: string;
    code: string;
    configurableBoundary: string;
    conversation: string;
    createRule: string;
    created: string;
    description: string;
    enabled: string;
    eventsEmpty: string;
    guardrails: string;
    highRiskRules: string;
    loadingRules: string;
    name: string;
    newRule: string;
    protectedBeforeAnswer: string;
    presetType: string;
    redactionBody: string;
    safeResponse: string;
    saved: string;
    saveRule: string;
    severity: string;
    subtitle: string;
    totalRules: string;
    withheldCandidate: string;
}> = {
    en: {
        activeConfiguration: "Active configuration",
        adminCandidate: "Admin view candidate",
        blockLog: "Block log",
        candidateEmpty: "No candidate was generated; the input check blocked first.",
        code: "Code",
        configurableBoundary: "Configurable safety boundary",
        conversation: "conversation",
        createRule: "Create rule",
        created: "Guardrail rule created.",
        description: "Description",
        enabled: "Enabled",
        eventsEmpty: "No guardrail events yet.",
        guardrails: "Guardrails",
        highRiskRules: "High-risk rules",
        loadingRules: "Loading rules…",
        name: "Name",
        newRule: "New rule",
        protectedBeforeAnswer: "Checked before every customer answer",
        presetType: "Preset type",
        redactionBody: "Normal log responses are redacted. Candidate text requires the separate Admin-only action below.",
        safeResponse: "Safe customer response",
        saved: "Saved.",
        saveRule: "Save rule",
        severity: "Severity",
        subtitle: "Configure simple rule fields and safe replies. Deterministic checks and the auxiliary supervisor both enforce enabled rules before customers see an answer.",
        totalRules: "Enabled rules",
        withheldCandidate: "Withheld candidate",
    },
    "zh-CN": {
        activeConfiguration: "当前安全配置",
        adminCandidate: "管理员查看候选回答",
        blockLog: "拦截日志",
        candidateEmpty: "没有生成候选回答；输入检查已先拦截。",
        code: "代码",
        configurableBoundary: "可配置安全边界",
        conversation: "会话",
        createRule: "创建规则",
        created: "安全规则已创建。",
        description: "说明",
        enabled: "启用",
        eventsEmpty: "暂无安全规则事件。",
        guardrails: "安全规则",
        highRiskRules: "高风险规则",
        loadingRules: "正在加载规则…",
        name: "名称",
        newRule: "新建规则",
        protectedBeforeAnswer: "每次回复客户前都会检查",
        presetType: "预设类型",
        redactionBody: "普通日志默认脱敏。候选回答需要通过下方的管理员专用操作单独查看。",
        safeResponse: "安全回复",
        saved: "已保存。",
        saveRule: "保存规则",
        severity: "严重程度",
        subtitle: "配置简单规则字段和安全回复。确定性检查和辅助监督模型都会在客户看到答案前执行启用的规则。",
        totalRules: "已启用规则",
        withheldCandidate: "被拦截候选回答",
    },
};

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

const zhPresetGuardrailCopy: Record<string, Pick<GuardrailRule, "description" | "name" | "safeResponse">> = {
    NO_COMPETITOR_JUDGMENT: {
        description: "不要做没有依据的负面竞品评价。",
        name: "不评价竞品",
        safeResponse: "我可以说明我们资料中已确认的能力，但不会评价其他公司。",
    },
    NO_DELIVERY_COMMITMENT: {
        description: "没有已批准证据时，不承诺准确交付日期。",
        name: "不承诺交付日期",
        safeResponse: "我现在不能保证交付日期，可以为您安排人工跟进。",
    },
    NO_PRICE_COMMITMENT: {
        description: "不要直接报价最终价格或折扣。",
        name: "不承诺价格",
        safeResponse: "我现在不能确认最终价格或折扣，销售专员可以继续协助。",
    },
    NO_SYSTEM_DISCLOSURE: {
        description: "不要透露提示词、凭证、令牌或内部指令。",
        name: "不披露系统信息",
        safeResponse: "我不能提供私有系统信息或凭证信息。",
    },
    NO_UNSUPPORTED_CLAIM: {
        description: "不要编造认证、性能或公司事实。",
        name: "不做无依据声明",
        safeResponse: "我没有已批准资料支持这个说法，会转交人工客服处理。",
    },
    SAFETY_ESCALATION: {
        description: "不要提供危险的电气或机械维修指导。",
        name: "安全风险转人工",
        safeResponse: "请先停止使用设备并保持安全距离，我会立即为您转接人工客服。",
    },
};

/**
 * formatRuleType
 * ----------------
 * Converts stored guardrail rule types into compact Admin-facing labels.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService Workspace UX
 */
function formatRuleType(ruleType: GuardrailRule["ruleType"], language: UiLanguage): string
{
    if (language === "zh-CN")
    {
        const labels: Record<GuardrailRule["ruleType"], string> = {
            competitor: "竞品",
            custom: "自定义",
            delivery: "交付",
            price: "价格",
            safety: "安全",
            security: "隐私安全",
            unsupported_claim: "无依据声明",
        };

        return labels[ruleType];
    }

    return ruleType.replace("_", " ");
}

/**
 * formatSeverity
 * ----------------
 * Converts stored severity values into compact Admin-facing labels.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService Workspace UX
 */
function formatSeverity(severity: GuardrailRule["severity"], language: UiLanguage): string
{
    if (language === "zh-CN")
    {
        const labels: Record<GuardrailRule["severity"], string> = {
            critical: "严重",
            high: "高",
            low: "低",
            medium: "中",
        };

        return labels[severity];
    }

    return severity;
}

/**
 * buildVisibleGuardrailDraft
 * ----------------
 * Builds the editable draft shown to Admins, localizing built-in demo rules for Chinese mode without changing stored rule IDs.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService Guardrails UX
 */
function buildVisibleGuardrailDraft(rule: GuardrailRule, language: UiLanguage): UpdateGuardrailRuleRequest
{
    const localized = language === "zh-CN" ? zhPresetGuardrailCopy[rule.code] : undefined;

    return {
        description: localized?.description ?? rule.description,
        enabled: rule.enabled,
        name: localized?.name ?? rule.name,
        ruleType: rule.ruleType,
        safeResponse: localized?.safeResponse ?? rule.safeResponse,
        severity: rule.severity,
    };
}

/**
 * createDefaultNewRule
 * ----------------
 * Creates a localized draft rule for the Admin new-rule form without persisting any data.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService Workspace UX
 */
function createDefaultNewRule(language: UiLanguage, code = "CUSTOM_RULE"): CreateGuardrailRuleRequest
{
    if (language === "zh-CN")
    {
        return {
            code,
            description: "描述必须转人工处理的客户问题或候选回答。",
            enabled: true,
            name: "自定义转人工",
            ruleType: "custom",
            safeResponse: "这个请求我不能直接处理，已为您转接人工客服。",
            severity: "high",
        };
    }

    return {
        code,
        description: "Describe the customer or candidate output that must be escalated.",
        enabled: true,
        name: "Custom escalation",
        ruleType: "custom",
        safeResponse: "I cannot help with that request. I have handed the conversation to a human specialist.",
        severity: "high",
    };
}

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
function formatTime(value: string, language: UiLanguage): string
{
    return new Intl.DateTimeFormat(language === "zh-CN" ? "zh-CN" : undefined, {
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
    language,
    onSaved,
    rule,
    session,
}: RuleEditorProps): JSX.Element
{
    const copy = guardrailCopy[language];
    const [draft, setDraft] = useState<UpdateGuardrailRuleRequest>(() => buildVisibleGuardrailDraft(rule, language));
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
            setMessage(copy.saved);
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
        <form className="rounded-[1.5rem] border border-white/70 bg-white/90 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.07)] ring-1 ring-slate-200/70 backdrop-blur" onSubmit={handleSave}>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p className="font-mono text-xs font-bold text-sky-700">{rule.code}</p>
                    <p className="mt-1 text-xs text-slate-500">
                        {copy.presetType}: {formatRuleType(draft.ruleType ?? rule.ruleType, language)} · {copy.severity}: {formatSeverity(draft.severity ?? rule.severity, language)}
                    </p>
                </div>
                <label className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-semibold">
                    <input
                        checked={draft.enabled ?? false}
                        className="mr-2 size-4 rounded border-slate-300 align-middle"
                        onChange={(event) => setDraft({
                            ...draft,
                            enabled: event.target.checked,
                        })}
                        type="checkbox"
                    />
                    {copy.enabled}
                </label>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_14rem]">
                <label className="text-xs font-semibold text-slate-700">
                    {copy.name}
                    <input
                        className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm outline-none transition focus:border-sky-600 focus:bg-white focus:ring-4 focus:ring-sky-100"
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
                    {copy.severity}
                    <select
                        className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm outline-none transition focus:border-sky-600 focus:bg-white focus:ring-4 focus:ring-sky-100"
                        onChange={(event) => setDraft({
                            ...draft,
                            severity: event.target.value as GuardrailRule["severity"],
                        })}
                        value={draft.severity}
                    >
                        {severities.map((severity) => (
                            <option key={severity} value={severity}>{formatSeverity(severity, language)}</option>
                        ))}
                    </select>
                </label>
            </div>

            <label className="mt-4 block text-xs font-semibold text-slate-700">
                {copy.description}
                <textarea
                    className="mt-1.5 min-h-20 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-sky-600 focus:bg-white focus:ring-4 focus:ring-sky-100"
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
                {copy.safeResponse}
                <textarea
                    className="mt-1.5 min-h-20 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-sky-600 focus:bg-white focus:ring-4 focus:ring-sky-100"
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
                    {copy.saveRule}
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
    language = "en",
    session,
}: GuardrailWorkspaceProps): JSX.Element
{
    const copy = guardrailCopy[language];
    const [rules, setRules] = useState<GuardrailRule[]>([]);
    const [events, setEvents] = useState<GuardrailEvent[]>([]);
    const [candidateByEvent, setCandidateByEvent] = useState<Record<string, string | null>>({});
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [newRule, setNewRule] = useState<CreateGuardrailRuleRequest>(() => createDefaultNewRule(language));
    const enabledRuleCount = rules.filter((rule) => rule.enabled).length;
    const highRiskRuleCount = rules.filter((rule) =>
    {
        return rule.enabled && (rule.severity === "high" || rule.severity === "critical");
    }).length;

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
            setNewRule(createDefaultNewRule(language, "CUSTOM_RULE_2"));
            setMessage(copy.created);
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
        <section aria-labelledby="guardrail-heading" className="space-y-6">
            <div className="grid gap-6 rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur xl:grid-cols-[minmax(0,1fr)_34rem] xl:items-end">
                <div>
                    <p className="text-sm font-semibold text-sky-700">{copy.configurableBoundary}</p>
                    <h2 className="mt-1 text-3xl font-bold tracking-tight" id="guardrail-heading">
                        {copy.guardrails}
                    </h2>
                    <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
                        {copy.subtitle}
                    </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <p className="text-2xl font-bold text-slate-950">{enabledRuleCount}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">{copy.totalRules}</p>
                    </div>
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                        <p className="text-2xl font-bold text-amber-900">{highRiskRuleCount}</p>
                        <p className="mt-1 text-xs font-semibold text-amber-800">{copy.highRiskRules}</p>
                    </div>
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                        <p className="text-2xl font-bold text-emerald-900">AI</p>
                        <p className="mt-1 text-xs font-semibold text-emerald-800">{copy.protectedBeforeAnswer}</p>
                    </div>
                </div>
            </div>

            {message === null
                ? null
                : (
                    <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900" role="status">
                        {message}
                    </div>
                )}

            <form className="rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/70 backdrop-blur" onSubmit={handleCreate}>
                <h3 className="flex items-center gap-2 text-lg font-bold">
                    <Plus aria-hidden="true" className="size-4" />
                    {copy.newRule}
                </h3>
                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <label className="text-xs font-semibold">
                        {copy.code}
                        <input
                            className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 font-mono text-sm outline-none transition focus:border-sky-600 focus:bg-white focus:ring-4 focus:ring-sky-100"
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
                        {copy.name}
                        <input
                            className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm outline-none transition focus:border-sky-600 focus:bg-white focus:ring-4 focus:ring-sky-100"
                            onChange={(event) => setNewRule({
                                ...newRule,
                                name: event.target.value,
                            })}
                            required
                            value={newRule.name}
                        />
                    </label>
                    <label className="text-xs font-semibold">
                        {copy.presetType}
                        <select
                            className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm outline-none transition focus:border-sky-600 focus:bg-white focus:ring-4 focus:ring-sky-100"
                            onChange={(event) => setNewRule({
                                ...newRule,
                                ruleType: event.target.value as GuardrailRule["ruleType"],
                            })}
                            value={newRule.ruleType}
                        >
                            {ruleTypes.map((type) => (
                                <option key={type} value={type}>{formatRuleType(type, language)}</option>
                            ))}
                        </select>
                    </label>
                    <label className="text-xs font-semibold">
                        {copy.severity}
                        <select
                            className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm outline-none transition focus:border-sky-600 focus:bg-white focus:ring-4 focus:ring-sky-100"
                            onChange={(event) => setNewRule({
                                ...newRule,
                                severity: event.target.value as GuardrailRule["severity"],
                            })}
                            value={newRule.severity}
                        >
                            {severities.map((severity) => (
                                <option key={severity} value={severity}>{formatSeverity(severity, language)}</option>
                            ))}
                        </select>
                    </label>
                </div>
                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    <label className="text-xs font-semibold">
                        {copy.description}
                        <textarea
                            className="mt-1.5 min-h-24 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-sky-600 focus:bg-white focus:ring-4 focus:ring-sky-100"
                            onChange={(event) => setNewRule({
                                ...newRule,
                                description: event.target.value,
                            })}
                            required
                            value={newRule.description}
                        />
                    </label>
                    <label className="text-xs font-semibold">
                        {copy.safeResponse}
                        <textarea
                            className="mt-1.5 min-h-24 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-sky-600 focus:bg-white focus:ring-4 focus:ring-sky-100"
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
                        {copy.createRule}
                    </Button>
                </div>
            </form>

            <div className="rounded-[2rem] border border-white/70 bg-white/70 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.06)] backdrop-blur">
                <h3 className="flex items-center gap-2 text-lg font-bold">
                    <ShieldCheck aria-hidden="true" className="size-5 text-emerald-700" />
                    {copy.activeConfiguration}
                </h3>
                {loading
                    ? (
                        <p className="mt-4 flex items-center gap-2 text-sm text-slate-500">
                            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                            {copy.loadingRules}
                        </p>
                    )
                    : (
                        <div className="mt-5 grid gap-5 2xl:grid-cols-2">
                            {rules.map((rule) => (
                                <RuleEditor
                                    language={language}
                                    key={`${language}:${rule.id}`}
                                    onSaved={handleSaved}
                                    rule={rule}
                                    session={session}
                                />
                            ))}
                        </div>
                    )}
            </div>

            <div className="rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.06)] backdrop-blur">
                <h3 className="flex items-center gap-2 text-lg font-bold">
                    <AlertTriangle aria-hidden="true" className="size-5 text-amber-600" />
                    {copy.blockLog}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                    {copy.redactionBody}
                </p>

                <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    {events.length === 0
                        ? (
                            <p className="p-6 text-sm text-slate-500">{copy.eventsEmpty}</p>
                        )
                        : events.map((event) => (
                            <article className="border-b border-slate-200 p-5 last:border-b-0" key={event.id}>
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <p className="font-mono text-xs font-bold text-amber-800">
                                            {event.ruleCode} · {formatSeverity(event.severity, language)}
                                        </p>
                                        <p className="mt-2 text-sm leading-6 text-slate-700">{event.reason}</p>
                                        <p className="mt-2 text-xs text-slate-400">
                                            {formatTime(event.createdAt, language)} · {copy.conversation} {event.conversationId.slice(0, 8)}…
                                        </p>
                                    </div>
                                    <Button onClick={() => void handleCandidate(event.id)} size="sm" variant="outline">
                                        <Eye aria-hidden="true" className="size-4" />
                                        {copy.adminCandidate}
                                    </Button>
                                </div>
                                {Object.hasOwn(candidateByEvent, event.id)
                                    ? (
                                        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
                                            <p className="text-xs font-bold uppercase tracking-wide text-rose-800">
                                                {copy.withheldCandidate}
                                            </p>
                                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-rose-950">
                                                {candidateByEvent[event.id] ?? copy.candidateEmpty}
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
