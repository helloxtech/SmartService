import {
    buildFinalizationPrompt,
    buildGuardrailPrompt,
    conversationFinalizationJsonSchema,
    DeterministicConversationFinalizer,
    DeterministicGuardrailSupervisor,
    finalizationPromptVersion,
    guardrailEvaluationJsonSchema,
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
} from "@smartservice/contracts";

import { ApiError } from "./errors";
import { requestStructuredOutput } from "./openai-structured-output";
import type { SmartServiceBindings } from "./types";

/**
 * parseSupervisionBudgetMs
 * ----------------
 * Reads the customer-turn output-supervision wall-clock budget while preserving a bounded retry window and fail-closed behavior.
 *
 * August 06, 2026: Created by Forrest Zhang for Customer Answer Latency Hardening
 */
function parseSupervisionBudgetMs(bindings: SmartServiceBindings): number
{
    const value = Number.parseInt(bindings.CHAT_SUPERVISION_BUDGET_MS ?? "6000", 10);

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
            schema: guardrailEvaluationJsonSchema,
            timeoutMs: totalTimeoutMs,
            totalTimeoutMs,
        });
        const evaluation = guardrailEvaluationSchema.parse(result.value);
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

        const primaryRule = evaluation.allowed
            ? undefined
            : input.rules.find((rule) =>
                rule.enabled && rule.code === evaluation.violations[0]?.ruleCode,
            );
        const localizedEvaluation = primaryRule === undefined
            ? evaluation
            : guardrailEvaluationSchema.parse({
                ...evaluation,
                safeResponse: localizeGuardrailSafeResponse(primaryRule, input.language),
            });

        return {
            evaluation: localizedEvaluation,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
        };
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
 * Selects the live nano supervisor or explicit deterministic nonproduction implementation.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Guardrails
 */
export function createGuardrailSupervisor(
    bindings: SmartServiceBindings,
): GuardrailSupervisor
{
    return bindings.AUXILIARY_PROVIDER_MODE === "live"
        ? new OpenAiGuardrailSupervisor(bindings)
        : new DeterministicGuardrailSupervisor();
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
