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
import { z } from "zod";

import { ApiError } from "./errors";
import type { SmartServiceBindings } from "./types";

const responsesApiSchema = z.object({
    output: z.array(z.object({
        content: z.array(z.object({
            text: z.string().optional(),
            type: z.string(),
        }).passthrough()).optional(),
        type: z.string(),
    }).passthrough()),
    usage: z.object({
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.number().int().nonnegative(),
    }).optional(),
}).passthrough();

/**
 * isRetryableResponseStatus
 * ----------------
 * Identifies transient Responses API statuses eligible for the one bounded retry.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
 */
function isRetryableResponseStatus(status: number): boolean
{
    return status === 408 || status === 429 || status >= 500;
}

/**
 * waitForResponseRetry
 * ----------------
 * Applies the locked short backoff before the second Responses API attempt.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
 */
async function waitForResponseRetry(): Promise<void>
{
    await new Promise<void>((resolve) =>
    {
        setTimeout(resolve, 500);
    });
}

/**
 * extractStructuredText
 * ----------------
 * Extracts the sole Structured Output JSON text item from a validated raw Responses API envelope.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Grounded Text Q&A
 */
function extractStructuredText(response: z.infer<typeof responsesApiSchema>): string
{
    for (const output of response.output)
    {
        if (output.type !== "message")
        {
            continue;
        }

        for (const content of output.content ?? [])
        {
            if (content.type === "output_text" && content.text !== undefined)
            {
                return content.text;
            }
        }
    }

    throw new ApiError(
        502,
        "ANSWER_RESPONSE_INVALID",
        "The answer provider did not return a usable Structured Output.",
    );
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

        const prompt = buildRagPrompt(input);
        let lastStatus = 0;

        for (let attempt = 1; attempt <= 2; attempt += 1)
        {
            let response: Response;

            try
            {
                response = await fetch("https://api.openai.com/v1/responses", {
                    body: JSON.stringify({
                        input: [
                            {
                                content: prompt.system,
                                role: "system",
                            },
                            {
                                content: prompt.user,
                                role: "user",
                            },
                        ],
                        max_output_tokens: 1_000,
                        model: this.model,
                        store: false,
                        text: {
                            format: {
                                description: "A grounded customer-service answer or safe handoff decision.",
                                name: "smartservice_rag_answer",
                                schema: ragAnswerJsonSchema,
                                strict: true,
                                type: "json_schema",
                            },
                        },
                    }),
                    headers: {
                        authorization: `Bearer ${apiKey}`,
                        "content-type": "application/json",
                        "x-client-request-id": crypto.randomUUID(),
                    },
                    method: "POST",
                    signal: AbortSignal.timeout(15_000),
                });
            }
            catch
            {
                if (attempt < 2)
                {
                    await waitForResponseRetry();
                    continue;
                }

                break;
            }

            lastStatus = response.status;

            if (response.ok)
            {
                const payload = responsesApiSchema.parse(await response.json());
                let parsedJson: unknown;

                try
                {
                    parsedJson = JSON.parse(extractStructuredText(payload)) as unknown;
                }
                catch (error: unknown)
                {
                    if (error instanceof ApiError)
                    {
                        throw error;
                    }

                    throw new ApiError(
                        502,
                        "ANSWER_RESPONSE_INVALID",
                        "The answer provider returned invalid Structured Output JSON.",
                    );
                }

                return {
                    answer: ragAnswerSchema.parse(parsedJson),
                    inputTokens: payload.usage?.input_tokens ?? null,
                    outputTokens: payload.usage?.output_tokens ?? null,
                };
            }

            if (!isRetryableResponseStatus(response.status) || attempt === 2)
            {
                break;
            }

            await waitForResponseRetry();
        }

        console.error(JSON.stringify({
            event: "rag.answer.failed",
            model: this.model,
            promptVersion: ragPromptVersion,
            status: lastStatus,
        }));

        throw new ApiError(502, "ANSWER_PROVIDER_FAILED", "The answer provider request failed.");
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
