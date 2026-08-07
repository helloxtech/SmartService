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

import { ApiError } from "./errors";
import { requestStructuredOutput } from "./openai-structured-output";
import type { SmartServiceBindings } from "./types";
import { requestWorkersAiStructuredOutput } from "./workers-ai-structured-output";

const workersAiChatModel = "@cf/zai-org/glm-4.7-flash" as const;

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
        setTimeout(resolve, 250);
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
     * Requests a strict RAG Structured Output with no provider-side storage, a 15-second timeout, and one retry.
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

        const result = await requestStructuredOutput({
            apiKey,
            description: "A grounded customer-service answer or safe handoff decision.",
            errorCode: "ANSWER_PROVIDER_FAILED",
            errorMessage: "The answer provider request failed.",
            eventName: "rag.answer.failed",
            maxOutputTokens: 2_500,
            model: this.model,
            name: "smartservice_rag_answer",
            prompt: buildRagPrompt(input),
            promptVersion: ragPromptVersion,
            reasoningEffort: "low",
            schema: ragAnswerJsonSchema,
            timeoutMs: 15_000,
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
    public readonly model = workersAiChatModel;
    public readonly provider = "cloudflare-workers-ai";

    /**
     * WorkersAiRagAnswerProvider
     * ----------------
     * Creates the Cloudflare-hosted GLM primary answer provider while retaining all server-side RAG validation boundaries.
     *
     * August 03, 2026: Created by Forrest Zhang for SmartService Workers AI Cost Optimization
     */
    public constructor(private readonly bindings: SmartServiceBindings)
    {
    }

    /**
     * generate
     * ----------------
     * Requests a bounded non-thinking GLM answer in JSON Schema mode with one same-model retry after provider, schema, or citation validation failure.
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

        for (let attempt = 1; attempt <= 2; attempt += 1)
        {
            try
            {
                const isRepairAttempt = attempt === 2;
                const result = await requestWorkersAiStructuredOutput({
                    ai,
                    description: "A grounded customer-service answer or safe clarification decision.",
                    gatewayId: this.bindings.WORKERS_AI_GATEWAY_ID ?? "default",
                    maxOutputTokens: 1_800,
                    model: this.model,
                    name: "smartservice_rag_answer",
                    prompt: isRepairAttempt
                        ? buildRagRepairPrompt(input, repairReason)
                        : buildRagPrompt(input),
                    promptVersion: isRepairAttempt
                        ? `${ragPromptVersion}-repair`
                        : ragPromptVersion,
                    schema: ragAnswerJsonSchema,
                    timeoutMs: 12_000,
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

                if (attempt === 1)
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
            attempts: 2,
            errorCode: readAnswerErrorCode(lastError),
            event: "workers_ai.answer.failed",
            model: this.model,
            repairReason,
        }));

        throw lastError;
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
