import { z } from "zod";

import { ApiError } from "./errors";

const responsesApiSchema = z.object({
    incomplete_details: z.object({
        reason: z.string(),
    }).nullable().optional(),
    output: z.array(z.object({
        content: z.array(z.object({
            text: z.string().optional(),
            type: z.string(),
        }).passthrough()).optional(),
        type: z.string(),
    }).passthrough()),
    status: z.string().optional(),
    usage: z.object({
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.number().int().nonnegative(),
        output_tokens_details: z.object({
            reasoning_tokens: z.number().int().nonnegative().optional(),
        }).optional(),
    }).optional(),
}).passthrough();

export interface StructuredOutputRequest
{
    apiKey: string;
    description: string;
    errorCode: string;
    errorMessage: string;
    eventName: string;
    maxOutputTokens: number;
    model: string;
    name: string;
    prompt: {
        system: string;
        user: string;
    };
    promptVersion: string;
    reasoningEffort?: "minimal" | "low" | "medium" | "high";
    schema: Record<string, unknown>;
    timeoutMs: number;
}

export interface StructuredOutputResult
{
    inputTokens: number | null;
    outputTokens: number | null;
    value: unknown;
}

/**
 * isRetryableResponseStatus
 * ----------------
 * Identifies transient Responses API statuses eligible for the one bounded retry.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Shared AI Adapters
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
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Shared AI Adapters
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
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Shared AI Adapters
 */
function extractStructuredText(response: z.infer<typeof responsesApiSchema>): string | null
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

    return null;
}

/**
 * requestStructuredOutput
 * ----------------
 * Calls the OpenAI Responses API with strict JSON schema output, no provider storage, timeout, and one bounded retry.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Shared AI Adapters
 */
export async function requestStructuredOutput(
    input: StructuredOutputRequest,
): Promise<StructuredOutputResult>
{
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
                            content: input.prompt.system,
                            role: "system",
                        },
                        {
                            content: input.prompt.user,
                            role: "user",
                        },
                    ],
                    max_output_tokens: input.maxOutputTokens,
                    model: input.model,
                    ...(input.reasoningEffort === undefined
                        ? {}
                        : { reasoning: { effort: input.reasoningEffort } }),
                    store: false,
                    text: {
                        format: {
                            description: input.description,
                            name: input.name,
                            schema: input.schema,
                            strict: true,
                            type: "json_schema",
                        },
                    },
                }),
                headers: {
                    authorization: `Bearer ${input.apiKey}`,
                    "content-type": "application/json",
                    "x-client-request-id": crypto.randomUUID(),
                },
                method: "POST",
                signal: AbortSignal.timeout(input.timeoutMs),
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
            const structuredText = extractStructuredText(payload);
            let value: unknown;

            if (structuredText === null)
            {
                console.error(JSON.stringify({
                    contentTypes: payload.output.flatMap((output) =>
                    {
                        return (output.content ?? []).map((content) => content.type);
                    }),
                    event: "structured_output.missing",
                    incompleteReason: payload.incomplete_details?.reason ?? null,
                    model: input.model,
                    outputTypes: payload.output.map((output) => output.type),
                    reasoningTokens: payload.usage?.output_tokens_details?.reasoning_tokens ?? null,
                    responseStatus: payload.status ?? null,
                }));

                throw new ApiError(502, input.errorCode, input.errorMessage);
            }

            try
            {
                value = JSON.parse(structuredText) as unknown;
            }
            catch (error: unknown)
            {
                if (error instanceof ApiError)
                {
                    throw error;
                }

                throw new ApiError(
                    502,
                    input.errorCode,
                    "The AI provider returned invalid Structured Output JSON.",
                );
            }

            return {
                inputTokens: payload.usage?.input_tokens ?? null,
                outputTokens: payload.usage?.output_tokens ?? null,
                value,
            };
        }

        if (!isRetryableResponseStatus(response.status) || attempt === 2)
        {
            break;
        }

        await waitForResponseRetry();
    }

    console.error(JSON.stringify({
        event: input.eventName,
        model: input.model,
        promptVersion: input.promptVersion,
        status: lastStatus,
    }));

    throw new ApiError(502, input.errorCode, input.errorMessage);
}
