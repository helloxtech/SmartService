import { z } from "zod";

import { ApiError } from "./errors";

const workersAiChatCompletionSchema = z.object({
    choices: z.array(z.object({
        finish_reason: z.string(),
        message: z.object({
            content: z.string().nullable(),
        }).passthrough(),
    }).passthrough()).min(1),
    usage: z.object({
        completion_tokens: z.number().int().nonnegative(),
        prompt_tokens: z.number().int().nonnegative(),
    }).optional(),
}).passthrough();

export interface WorkersAiStructuredOutputRequest
{
    ai: Ai;
    description: string;
    gatewayId: string;
    maxOutputTokens: number;
    model: "@cf/zai-org/glm-4.7-flash";
    name: string;
    prompt: {
        system: string;
        user: string;
    };
    promptVersion: string;
    schema: Record<string, unknown>;
    timeoutMs: number;
}

export interface WorkersAiStructuredOutputResult
{
    inputTokens: number | null;
    outputTokens: number | null;
    value: unknown;
}

/**
 * requestWorkersAiStructuredOutput
 * ----------------
 * Calls the Cloudflare-hosted GLM model in non-thinking JSON Schema mode with bounded output, timeout, and content logging disabled.
 *
 * August 03, 2026: Created by Forrest Zhang for SmartService Workers AI Cost Optimization
 */
export async function requestWorkersAiStructuredOutput(
    input: WorkersAiStructuredOutputRequest,
): Promise<WorkersAiStructuredOutputResult>
{
    const startedAt = Date.now();

    try
    {
        const rawResponse = await input.ai.run(input.model, {
            chat_template_kwargs: {
                enable_thinking: false,
            },
            max_completion_tokens: input.maxOutputTokens,
            messages: [
                {
                    content: input.prompt.system,
                    role: "system",
                },
                {
                    content: input.prompt.user,
                    role: "user",
                },
            ],
            response_format: {
                json_schema: {
                    description: input.description,
                    name: input.name,
                    schema: input.schema,
                    strict: true,
                },
                type: "json_schema",
            },
            store: false,
            temperature: 0,
        }, {
            gateway: {
                collectLog: false,
                id: input.gatewayId,
                metadata: {
                    component: "rag-answer",
                    promptVersion: input.promptVersion,
                },
                requestTimeoutMs: input.timeoutMs,
            },
            signal: AbortSignal.timeout(input.timeoutMs),
            tags: ["smartservice", "rag-answer"],
        });
        const response = workersAiChatCompletionSchema.parse(rawResponse);
        const structuredText = response.choices[0]?.message.content;

        if (structuredText === null || structuredText === undefined)
        {
            throw new ApiError(
                502,
                "WORKERS_AI_RESPONSE_INVALID",
                "Workers AI returned no structured answer.",
            );
        }

        let value: unknown;

        try
        {
            value = JSON.parse(structuredText) as unknown;
        }
        catch
        {
            throw new ApiError(
                502,
                "WORKERS_AI_RESPONSE_INVALID",
                "Workers AI returned invalid Structured Output JSON.",
            );
        }

        console.info(JSON.stringify({
            event: "workers_ai.structured_output.succeeded",
            inputTokens: response.usage?.prompt_tokens ?? null,
            latencyMs: Date.now() - startedAt,
            model: input.model,
            outputTokens: response.usage?.completion_tokens ?? null,
            promptVersion: input.promptVersion,
        }));

        return {
            inputTokens: response.usage?.prompt_tokens ?? null,
            outputTokens: response.usage?.completion_tokens ?? null,
            value,
        };
    }
    catch (error: unknown)
    {
        console.error(JSON.stringify({
            errorCode: error instanceof ApiError
                ? error.code
                : error instanceof Error
                    ? error.name.slice(0, 120)
                    : "UNKNOWN_ERROR",
            event: "workers_ai.structured_output.failed",
            latencyMs: Date.now() - startedAt,
            model: input.model,
            promptVersion: input.promptVersion,
        }));

        if (error instanceof ApiError)
        {
            throw error;
        }

        throw new ApiError(
            502,
            "WORKERS_AI_PROVIDER_FAILED",
            "The primary answer provider request failed.",
        );
    }
}
