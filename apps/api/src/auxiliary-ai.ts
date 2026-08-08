import {
    buildGuardrailEvaluationJsonSchema,
    buildFinalizationPrompt,
    buildGuardrailPrompt,
    conversationFinalizationJsonSchema,
    DeterministicConversationFinalizer,
    DeterministicGuardrailSupervisor,
    finalizationPromptVersion,
    guardrailPromptVersion,
    localizeGuardrailSafeResponse,
    type ConversationFinalizer,
    type FinalizationInput,
    type FinalizationResult,
    type GuardrailInput,
    type GuardrailSupervisionResult,
    type GuardrailSupervisor,
} from "@smartservice/assistant-core";
import {
    conversationFinalizationSchema,
    guardrailEvaluationSchema,
    type GuardrailEvaluation,
} from "@smartservice/contracts";
import { z } from "zod";

import { ApiError } from "./errors";
import { requestStructuredOutput } from "./openai-structured-output";
import type { SmartServiceBindings } from "./types";
import {
    parseWorkersAiChatModel,
    requestWorkersAiStructuredOutput,
    type WorkersAiChatModel,
} from "./workers-ai-structured-output";

const guardrailProviderEvaluationSchema = z.object({
    allowed: z.boolean(),
    requestHandoff: z.boolean(),
    safeResponse: z.string().min(1).max(600).nullable(),
    violations: z.array(z.object({
        reason: z.string().min(1).max(500),
        ruleCode: z.string().min(1).max(80),
        severity: z.enum(["low", "medium", "high", "critical"]),
    })).max(20),
});

/**
 * parseSupervisionBudgetMs
 * ----------------
 * Reads the customer-turn output-supervision wall-clock budget while preserving a bounded retry window and fail-closed behavior.
 *
 * August 06, 2026: Created by Forrest Zhang for Customer Answer Latency Hardening
 */
function parseSupervisionBudgetMs(bindings: SmartServiceBindings): number
{
    const defaultBudgetMs = bindings.CHAT_SUPERVISOR_PROVIDER === "workers-ai"
        ? "4500"
        : "6000";
    const value = Number.parseInt(bindings.CHAT_SUPERVISION_BUDGET_MS ?? defaultBudgetMs, 10);

    if (!Number.isInteger(value) || value < 2_000 || value > 10_000)
    {
        throw new ApiError(
            503,
            "CHAT_SUPERVISION_BUDGET_INVALID",
            "The customer answer supervision budget is not valid.",
        );
    }

    return value;
}

/**
 * validateGuardrailEvaluation
 * ----------------
 * Validates one auxiliary-model decision against enabled tenant rule codes and localizes any blocked response through the approved server-side template.
 *
 * August 06, 2026: Created by Forrest Zhang for Cloudflare Guardrail Latency Hardening
 */
function validateGuardrailEvaluation(
    value: unknown,
    input: GuardrailInput,
): GuardrailEvaluation
{
    const evaluation = guardrailProviderEvaluationSchema.parse(value);
    const allowedCodes = new Set(
        input.rules
            .filter((rule) => rule.enabled)
            .map((rule) => rule.code),
    );

    if (evaluation.violations.some((violation) => !allowedCodes.has(violation.ruleCode)))
    {
        throw new ApiError(
            502,
            "GUARDRAIL_RESPONSE_INVALID",
            "The guardrail provider returned an unknown rule.",
        );
    }

    if (!evaluation.allowed && evaluation.violations.length === 0)
    {
        throw new ApiError(
            502,
            "GUARDRAIL_RESPONSE_INVALID",
            "The guardrail provider blocked the answer without identifying an enabled rule.",
        );
    }

    const primaryRule = input.rules.find((rule) =>
        rule.enabled && rule.code === evaluation.violations[0]?.ruleCode,
    );

    return primaryRule === undefined
        ? guardrailEvaluationSchema.parse({
            allowed: true,
            requestHandoff: false,
            safeResponse: null,
            violations: [],
        })
        : guardrailEvaluationSchema.parse({
            allowed: false,
            requestHandoff: true,
            safeResponse: localizeGuardrailSafeResponse(primaryRule, input.language),
            violations: evaluation.violations,
        });
}

export class OpenAiGuardrailSupervisor implements GuardrailSupervisor
{
    public readonly model: string;
    public readonly provider = "openai";

    /**
     * OpenAiGuardrailSupervisor
     * ----------------
     * Creates the live auxiliary-model supervisor using the configurable nondated nano alias.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrails
     */
    public constructor(private readonly bindings: SmartServiceBindings)
    {
        this.model = bindings.OPENAI_SUPERVISOR_MODEL ?? "gpt-5-nano";
    }

    /**
     * supervise
     * ----------------
     * Validates a candidate against enabled tenant rules with strict Structured Output and rejects invented rule codes.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrails
     */
    public async supervise(input: GuardrailInput): Promise<GuardrailSupervisionResult>
    {
        const apiKey = this.bindings.OPENAI_API_KEY;

        if (apiKey === undefined || apiKey.length === 0)
        {
            throw new ApiError(503, "OPENAI_CONFIGURATION_MISSING", "The guardrail provider is not configured.");
        }

        const totalTimeoutMs = parseSupervisionBudgetMs(this.bindings);
        const result = await requestStructuredOutput({
            apiKey,
            description: "A safety decision over one candidate answer and enabled tenant guardrail rules.",
            errorCode: "GUARDRAIL_PROVIDER_FAILED",
            errorMessage: "The guardrail provider request failed.",
            eventName: "guardrail.supervisor.failed",
            maxOutputTokens: 500,
            model: this.model,
            name: "smartservice_guardrail_evaluation",
            prompt: buildGuardrailPrompt(input),
            promptVersion: guardrailPromptVersion,
            reasoningEffort: "low",
            schema: buildGuardrailEvaluationJsonSchema(
                input.rules
                    .filter((rule) => rule.enabled)
                    .map((rule) => rule.code),
            ),
            timeoutMs: totalTimeoutMs,
            totalTimeoutMs,
        });
        return {
            evaluation: validateGuardrailEvaluation(result.value, input),
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
        };
    }
}

export class WorkersAiGuardrailSupervisor implements GuardrailSupervisor
{
    public readonly model: WorkersAiChatModel;
    public readonly provider = "cloudflare-workers-ai";

    /**
     * WorkersAiGuardrailSupervisor
     * ----------------
     * Creates the Cloudflare-hosted per-turn auxiliary supervisor while preserving deterministic prechecks and fail-closed output handling.
     *
     * August 06, 2026: Created by Forrest Zhang for Cloudflare Guardrail Latency Hardening
     */
    public constructor(private readonly bindings: SmartServiceBindings)
    {
        this.model = parseWorkersAiChatModel(bindings.CHAT_WORKERS_AI_MODEL);
    }

    /**
     * supervise
     * ----------------
     * Classifies one candidate with strict JSON output, tenant-rule validation, and at most one retry inside a shared Cloudflare time budget.
     *
     * August 06, 2026: Created by Forrest Zhang for Cloudflare Guardrail Latency Hardening
     */
    public async supervise(input: GuardrailInput): Promise<GuardrailSupervisionResult>
    {
        const ai = this.bindings.AI;

        if (ai === undefined)
        {
            throw new ApiError(
                503,
                "WORKERS_AI_CONFIGURATION_MISSING",
                "The guardrail provider is not configured.",
            );
        }

        const totalTimeoutMs = parseSupervisionBudgetMs(this.bindings);
        const startedAt = Date.now();
        let lastError: unknown;

        for (let attempt = 1; attempt <= 2; attempt += 1)
        {
            const remainingMs = totalTimeoutMs - (Date.now() - startedAt);

            if (remainingMs <= 150)
            {
                break;
            }

            try
            {
                const result = await requestWorkersAiStructuredOutput({
                    ai,
                    component: "guardrail-supervisor",
                    description: "A safety decision over one candidate answer and enabled tenant guardrail rules.",
                    gatewayId: this.bindings.WORKERS_AI_GATEWAY_ID ?? "default",
                    maxOutputTokens: 500,
                    model: this.model,
                    name: "smartservice_guardrail_evaluation",
                    prompt: buildGuardrailPrompt(input),
                    promptVersion: guardrailPromptVersion,
                    schema: buildGuardrailEvaluationJsonSchema(
                        input.rules
                            .filter((rule) => rule.enabled)
                            .map((rule) => rule.code),
                    ),
                    tags: ["smartservice", "guardrail-supervisor"],
                    timeoutMs: remainingMs,
                });

                return {
                    evaluation: validateGuardrailEvaluation(result.value, input),
                    inputTokens: result.inputTokens,
                    outputTokens: result.outputTokens,
                };
            }
            catch (error: unknown)
            {
                lastError = error;

                if (attempt === 1 && totalTimeoutMs - (Date.now() - startedAt) > 150)
                {
                    console.warn(JSON.stringify({
                        attempt,
                        event: "workers_ai.guardrail.retry",
                        model: this.model,
                        nextAttempt: 2,
                    }));
                }
            }
        }

        if (lastError instanceof ApiError)
        {
            throw lastError;
        }

        throw new ApiError(
            502,
            "GUARDRAIL_PROVIDER_FAILED",
            "The guardrail provider request failed.",
        );
    }
}

export class OpenAiConversationFinalizer implements ConversationFinalizer
{
    public readonly model: string;
    public readonly provider = "openai";

    /**
     * OpenAiConversationFinalizer
     * ----------------
     * Creates the close-time finalizer using the same configurable auxiliary model without enabling optional ticket scope.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Conversation Finalization
     */
    public constructor(private readonly bindings: SmartServiceBindings)
    {
        this.model = bindings.OPENAI_SUPERVISOR_MODEL ?? "gpt-5-nano";
    }

    /**
     * finalize
     * ----------------
     * Produces the required summary/follow-up Structured Output and fails if optional R11 classification appears before G3.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Conversation Finalization
     */
    public async finalize(input: FinalizationInput): Promise<FinalizationResult>
    {
        const apiKey = this.bindings.OPENAI_API_KEY;

        if (apiKey === undefined || apiKey.length === 0)
        {
            throw new ApiError(503, "OPENAI_CONFIGURATION_MISSING", "Conversation finalization is not configured.");
        }

        const result = await requestStructuredOutput({
            apiKey,
            description: "A closed conversation summary, intent, outcome, next actions, and suggested follow-up wording.",
            errorCode: "FINALIZATION_PROVIDER_FAILED",
            errorMessage: "The conversation finalization request failed.",
            eventName: "conversation.finalization.failed",
            maxOutputTokens: 2_500,
            model: this.model,
            name: "smartservice_conversation_finalization",
            prompt: buildFinalizationPrompt(input),
            promptVersion: finalizationPromptVersion,
            reasoningEffort: "low",
            schema: conversationFinalizationJsonSchema,
            timeoutMs: 15_000,
        });
        const finalization = conversationFinalizationSchema.parse(result.value);

        if (finalization.ticket !== null)
        {
            throw new ApiError(
                502,
                "OPTIONAL_SCOPE_FORBIDDEN",
                "Ticket classification is disabled before G3.",
            );
        }

        return {
            finalization,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
        };
    }
}

/**
 * createGuardrailSupervisor
 * ----------------
 * Selects the configured live OpenAI or Cloudflare supervisor, or the explicit deterministic nonproduction implementation.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrails
 */
export function createGuardrailSupervisor(
    bindings: SmartServiceBindings,
): GuardrailSupervisor
{
    if (bindings.AUXILIARY_PROVIDER_MODE !== "live")
    {
        return new DeterministicGuardrailSupervisor();
    }

    return bindings.CHAT_SUPERVISOR_PROVIDER === "workers-ai"
        ? new WorkersAiGuardrailSupervisor(bindings)
        : new OpenAiGuardrailSupervisor(bindings);
}

/**
 * createConversationFinalizer
 * ----------------
 * Selects the live nano finalizer or explicit deterministic nonproduction implementation.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Conversation Finalization
 */
export function createConversationFinalizer(
    bindings: SmartServiceBindings,
): ConversationFinalizer
{
    return bindings.AUXILIARY_PROVIDER_MODE === "live"
        ? new OpenAiConversationFinalizer(bindings)
        : new DeterministicConversationFinalizer();
}
