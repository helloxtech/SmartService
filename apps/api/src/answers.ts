import {
    buildRagRepairPrompt,
    buildRagPrompt,
    DeterministicRagAnswerProvider,
    RagValidationError,
    ragAnswerJsonSchema,
    ragPromptVersion,
    validateGroundedAnswer,
    type RagAnswerProvider,
    type RagGenerationInput,
    type RagGenerationResult,
    type RagRepairReason,
} from "@smartservice/assistant-core";
import { ragAnswerSchema } from "@smartservice/contracts";
import { z } from "zod";

import { ApiError } from "./errors";
import { requestStructuredOutput } from "./openai-structured-output";
import type { SmartServiceBindings } from "./types";
import {
    requestWorkersAiStructuredOutput,
    workersAiChatModels,
    type WorkersAiChatModel,
} from "./workers-ai-structured-output";

const workersAiChatModelSchema = z.enum(workersAiChatModels);

/**
 * parseWorkersAiChatModel
 * ----------------
 * Selects one explicitly supported Cloudflare-hosted JSON-mode model so production can change latency or quality profiles without a code rewrite.
 *
 * August 06, 2026: Created by Forrest Zhang for Customer Answer Latency Hardening
 */
function parseWorkersAiChatModel(bindings: SmartServiceBindings): WorkersAiChatModel
{
    const result = workersAiChatModelSchema.safeParse(
        bindings.CHAT_WORKERS_AI_MODEL ?? "@cf/meta/llama-3.1-8b-instruct-fast",
    );

    if (!result.success)
    {
        throw new ApiError(
            503,
            "CHAT_WORKERS_AI_MODEL_INVALID",
            "The primary answer model is not supported.",
        );
    }

    return result.data;
}

/**
 * parseAnswerBudgetMs
 * ----------------
 * Reads the tenant-generic grounded-answer wall-clock budget while rejecting values that would create an unusably short or unbounded customer wait.
 *
 * August 06, 2026: Created by Forrest Zhang for Customer Answer Latency Hardening
 */
function parseAnswerBudgetMs(bindings: SmartServiceBindings): number
{
    const value = Number.parseInt(bindings.CHAT_ANSWER_BUDGET_MS ?? "8500", 10);

    if (!Number.isInteger(value) || value < 3_000 || value > 15_000)
    {
        throw new ApiError(
            503,
            "CHAT_ANSWER_BUDGET_INVALID",
            "The customer answer latency budget is not valid.",
        );
    }

    return value;
}

/**
 * readAnswerErrorCode
 * ----------------
 * Converts a provider or validation failure into a bounded content-free code for structured reliability logs.
 *
 * August 06, 2026: Created by Forrest Zhang for Tenant-Generic Answer Reliability
 */
function readAnswerErrorCode(error: unknown): string
{
    return error instanceof ApiError
        ? error.code
        : error instanceof Error
            ? error.name.slice(0, 120)
            : "UNKNOWN_ERROR";
}

/**
 * classifyRagRepairReason
 * ----------------
 * Chooses the corrective second-request instruction from the first attempt's output, grounding, or provider failure class.
 *
 * August 06, 2026: Created by Forrest Zhang for Tenant-Generic Answer Reliability
 */
function classifyRagRepairReason(error: unknown): RagRepairReason
{
    if (error instanceof RagValidationError)
    {
        return "grounding_validation";
    }

    if (
        (error instanceof ApiError && error.code === "WORKERS_AI_RESPONSE_INVALID")
        || (error instanceof Error && error.name === "ZodError")
    )
    {
        return "response_format";
    }

    return "provider_failure";
}

/**
 * waitForWorkersAiRepair
 * ----------------
 * Applies a short bounded backoff before the single same-provider corrective attempt.
 *
 * August 06, 2026: Created by Forrest Zhang for Tenant-Generic Answer Reliability
 */
async function waitForWorkersAiRepair(): Promise<void>
{
    await new Promise<void>((resolve) =>
    {
        setTimeout(resolve, 100);
    });
}

export class OpenAiRagAnswerProvider implements RagAnswerProvider
{
    public readonly model: string;
    public readonly provider = "openai";

    /**
     * OpenAiRagAnswerProvider
     * ----------------
     * Creates a live OpenAI Responses API adapter with a configurable nondated model alias.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
     */
    public constructor(private readonly bindings: SmartServiceBindings)
    {
        this.model = bindings.OPENAI_CHAT_MODEL ?? "gpt-5-mini";
    }

    /**
     * generate
     * ----------------
     * Requests a strict RAG Structured Output with no provider-side storage and a shared bounded retry budget.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
     */
    public async generate(input: RagGenerationInput): Promise<RagGenerationResult>
    {
        const apiKey = this.bindings.OPENAI_API_KEY;

        if (apiKey === undefined || apiKey.length === 0)
        {
            throw new ApiError(503, "OPENAI_CONFIGURATION_MISSING", "The answer provider is not configured.");
        }

        const totalTimeoutMs = parseAnswerBudgetMs(this.bindings);
        const result = await requestStructuredOutput({
            apiKey,
            description: "A grounded customer-service answer or safe handoff decision.",
            errorCode: "ANSWER_PROVIDER_FAILED",
            errorMessage: "The answer provider request failed.",
            eventName: "rag.answer.failed",
            maxOutputTokens: 1_000,
            model: this.model,
            name: "smartservice_rag_answer",
            prompt: buildRagPrompt(input),
            promptVersion: ragPromptVersion,
            reasoningEffort: "low",
            schema: ragAnswerJsonSchema,
            timeoutMs: Math.min(6_500, totalTimeoutMs),
            totalTimeoutMs,
        });

        return {
            answer: ragAnswerSchema.parse(result.value),
            inputTokens: result.inputTokens,
            model: this.model,
            outputTokens: result.outputTokens,
            provider: this.provider,
        };
    }
}

export class WorkersAiRagAnswerProvider implements RagAnswerProvider
{
    public readonly model: WorkersAiChatModel;
    public readonly provider = "cloudflare-workers-ai";

    /**
     * WorkersAiRagAnswerProvider
     * ----------------
     * Creates the configured Cloudflare-hosted primary answer provider while retaining all server-side RAG validation boundaries.
     *
     * August 03, 2026: Created by Forrest Zhang for SmartService Workers AI Cost Optimization
     */
    public constructor(private readonly bindings: SmartServiceBindings)
    {
        this.model = parseWorkersAiChatModel(bindings);
    }

    /**
     * generate
     * ----------------
     * Requests a bounded Workers AI answer in JSON Schema mode with one same-model repair inside one shared wall-clock budget.
     *
     * August 03, 2026: Updated by Forrest Zhang for SmartService Primary-Only Reliability
     */
    public async generate(input: RagGenerationInput): Promise<RagGenerationResult>
    {
        const ai = this.bindings.AI;

        if (ai === undefined)
        {
            throw new ApiError(
                503,
                "WORKERS_AI_CONFIGURATION_MISSING",
                "The primary answer provider is not configured.",
            );
        }

        let lastError: unknown;
        let repairReason: RagRepairReason = "provider_failure";
        let attempts = 0;
        const startedAt = Date.now();
        const totalTimeoutMs = parseAnswerBudgetMs(this.bindings);

        for (let attempt = 1; attempt <= 2; attempt += 1)
        {
            const remainingMs = totalTimeoutMs - (Date.now() - startedAt);

            if (remainingMs <= 150)
            {
                break;
            }

            attempts = attempt;

            try
            {
                const isRepairAttempt = attempt === 2;
                const result = await requestWorkersAiStructuredOutput({
                    ai,
                    description: "A grounded customer-service answer or safe clarification decision.",
                    gatewayId: this.bindings.WORKERS_AI_GATEWAY_ID ?? "default",
                    maxOutputTokens: 900,
                    model: this.model,
                    name: "smartservice_rag_answer",
                    prompt: isRepairAttempt
                        ? buildRagRepairPrompt(input, repairReason)
                        : buildRagPrompt(input),
                    promptVersion: isRepairAttempt
                        ? `${ragPromptVersion}-repair`
                        : ragPromptVersion,
                    schema: ragAnswerJsonSchema,
                    timeoutMs: attempt === 1
                        ? Math.min(6_500, remainingMs)
                        : remainingMs,
                });
                const answer = validateGroundedAnswer(
                    ragAnswerSchema.parse(result.value),
                    input.evidence,
                );

                if (isRepairAttempt)
                {
                    console.info(JSON.stringify({
                        attempts: attempt,
                        event: "workers_ai.answer.recovered",
                        model: this.model,
                        repairReason,
                    }));
                }

                return {
                    answer,
                    generationAttempts: attempt,
                    inputTokens: result.inputTokens,
                    model: this.model,
                    outputTokens: result.outputTokens,
                    provider: this.provider,
                    ...(isRepairAttempt
                        ? { recoveryMode: "same_provider_repair" as const }
                        : {}),
                };
            }
            catch (error: unknown)
            {
                lastError = error;

                if (
                    attempt === 1
                    && totalTimeoutMs - (Date.now() - startedAt) > 150
                )
                {
                    repairReason = classifyRagRepairReason(error);
                    console.warn(JSON.stringify({
                        attempt,
                        errorCode: readAnswerErrorCode(error),
                        event: "workers_ai.answer.retry",
                        maxAttempts: 2,
                        model: this.model,
                        nextAttempt: 2,
                        repairReason,
                    }));
                    await waitForWorkersAiRepair();
                }
            }
        }

        console.error(JSON.stringify({
            attempts,
            errorCode: readAnswerErrorCode(lastError),
            event: "workers_ai.answer.failed",
            latencyMs: Date.now() - startedAt,
            model: this.model,
            repairReason,
        }));

        throw lastError ?? new ApiError(
            502,
            "WORKERS_AI_TIME_BUDGET_EXCEEDED",
            "The primary answer provider exceeded its latency budget.",
        );
    }
}

export class HybridRagAnswerProvider implements RagAnswerProvider
{
    public readonly model: string;
    public readonly provider: string;

    /**
     * HybridRagAnswerProvider
     * ----------------
     * Uses the lower-cost Workers AI provider first and preserves OpenAI as a bounded reliability fallback.
     *
     * August 03, 2026: Created by Forrest Zhang for SmartService Workers AI Cost Optimization
     */
    public constructor(
        private readonly primary: RagAnswerProvider,
        private readonly fallback: RagAnswerProvider,
    )
    {
        this.model = primary.model;
        this.provider = primary.provider;
    }

    /**
     * generate
     * ----------------
     * Accepts the primary result only after schema and citation validation, then falls back once without exposing provider errors to the customer.
     *
     * August 03, 2026: Created by Forrest Zhang for SmartService Workers AI Cost Optimization
     */
    public async generate(input: RagGenerationInput): Promise<RagGenerationResult>
    {
        try
        {
            return this.validateResult(await this.primary.generate(input), input);
        }
        catch (error: unknown)
        {
            console.warn(JSON.stringify({
                errorCode: error instanceof ApiError
                    ? error.code
                    : error instanceof Error
                        ? error.name.slice(0, 120)
                        : "UNKNOWN_ERROR",
                event: "rag.answer.fallback",
                fallbackModel: this.fallback.model,
                primaryModel: this.primary.model,
            }));
        }

        return {
            ...this.validateResult(await this.fallback.generate(input), input),
            recoveryMode: "provider_fallback",
        };
    }

    /**
     * validateResult
     * ----------------
     * Validates the provider result against the exact retrieval set before it is eligible for persistence or customer delivery.
     *
     * August 03, 2026: Created by Forrest Zhang for SmartService Workers AI Cost Optimization
     */
    private validateResult(
        result: RagGenerationResult,
        input: RagGenerationInput,
    ): RagGenerationResult
    {
        return {
            ...result,
            answer: validateGroundedAnswer(result.answer, input.evidence),
        };
    }
}

/**
 * createRagAnswerProvider
 * ----------------
 * Selects deterministic, OpenAI, Workers AI primary-only, or Workers AI with OpenAI fallback behavior from explicit runtime configuration.
 *
 * August 03, 2026: Updated by Forrest Zhang for SmartService Primary-Model Testing
 */
export function createRagAnswerProvider(bindings: SmartServiceBindings): RagAnswerProvider
{
    if (bindings.CHAT_PROVIDER_MODE !== "live")
    {
        return new DeterministicRagAnswerProvider();
    }

    if (bindings.CHAT_PRIMARY_PROVIDER !== "workers-ai")
    {
        return new OpenAiRagAnswerProvider(bindings);
    }

    const workersAiProvider = new WorkersAiRagAnswerProvider(bindings);

    return bindings.CHAT_FALLBACK_PROVIDER === "none"
        ? workersAiProvider
        : new HybridRagAnswerProvider(
            workersAiProvider,
            new OpenAiRagAnswerProvider(bindings),
        );
}
