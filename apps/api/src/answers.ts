import {
    buildRagPrompt,
    DeterministicRagAnswerProvider,
    ragAnswerJsonSchema,
    ragPromptVersion,
    type RagAnswerProvider,
    type RagGenerationInput,
    type RagGenerationResult,
} from "@smartservice/assistant-core";
import { ragAnswerSchema } from "@smartservice/contracts";

import { ApiError } from "./errors";
import { requestStructuredOutput } from "./openai-structured-output";
import type { SmartServiceBindings } from "./types";

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
            maxOutputTokens: 1_000,
            model: this.model,
            name: "smartservice_rag_answer",
            prompt: buildRagPrompt(input),
            promptVersion: ragPromptVersion,
            schema: ragAnswerJsonSchema,
            timeoutMs: 15_000,
        });

        return {
            answer: ragAnswerSchema.parse(result.value),
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
        };
    }
}

/**
 * createRagAnswerProvider
 * ----------------
 * Selects the live Structured Output adapter or the explicit deterministic nonproduction provider.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
 */
export function createRagAnswerProvider(bindings: SmartServiceBindings): RagAnswerProvider
{
    return bindings.CHAT_PROVIDER_MODE === "live"
        ? new OpenAiRagAnswerProvider(bindings)
        : new DeterministicRagAnswerProvider();
}
