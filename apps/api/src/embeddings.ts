import { DeterministicEmbeddingProvider, type EmbeddingProvider } from "@smartservice/ingestion";
import { z } from "zod";

import { ApiError } from "./errors";
import type { SmartServiceBindings } from "./types";

const embeddingResponseSchema = z.object({
    data: z.array(z.object({
        embedding: z.array(z.number()),
        index: z.number().int().nonnegative(),
    })),
    model: z.string(),
    usage: z.object({
        prompt_tokens: z.number().int().nonnegative(),
        total_tokens: z.number().int().nonnegative(),
    }).optional(),
});

/**
 * isRetryableStatus
 * ----------------
 * Identifies transient OpenAI HTTP failures eligible for the one bounded retry.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function isRetryableStatus(status: number): boolean
{
    return status === 408 || status === 429 || status >= 500;
}

/**
 * delay
 * ----------------
 * Applies a short bounded backoff between embedding attempts without consuming CPU.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function delay(milliseconds: number): Promise<void>
{
    await new Promise<void>((resolve) =>
    {
        setTimeout(resolve, milliseconds);
    });
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider
{
    /**
     * OpenAiEmbeddingProvider
     * ----------------
     * Creates a live embedding adapter from server-only Worker bindings.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public constructor(private readonly bindings: SmartServiceBindings)
    {
    }

    /**
     * embed
     * ----------------
     * Requests configurable 1024-dimension OpenAI embeddings with a 15-second timeout, one retry, and validated output.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async embed(texts: string[]): Promise<number[][]>
    {
        const apiKey = this.bindings.OPENAI_API_KEY;

        if (apiKey === undefined || apiKey.length === 0)
        {
            throw new ApiError(503, "OPENAI_CONFIGURATION_MISSING", "The embedding provider is not configured.");
        }

        const model = this.bindings.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-large";
        const dimensions = Number.parseInt(
            this.bindings.OPENAI_EMBEDDING_DIMENSIONS ?? "1024",
            10,
        );

        if (dimensions !== 1024)
        {
            throw new ApiError(
                503,
                "EMBEDDING_DIMENSIONS_INVALID",
                "SmartService requires exactly 1024 embedding dimensions.",
            );
        }

        let lastStatus = 0;

        for (let attempt = 1; attempt <= 2; attempt += 1)
        {
            const startedAt = Date.now();
            let response: Response;

            try
            {
                response = await fetch("https://api.openai.com/v1/embeddings", {
                    body: JSON.stringify({
                        dimensions,
                        input: texts,
                        model,
                    }),
                    headers: {
                        authorization: `Bearer ${apiKey}`,
                        "content-type": "application/json",
                    },
                    method: "POST",
                    signal: AbortSignal.timeout(15_000),
                });
            }
            catch
            {
                if (attempt < 2)
                {
                    await delay(500 * attempt);
                    continue;
                }

                break;
            }

            lastStatus = response.status;

            if (response.ok)
            {
                const payload = embeddingResponseSchema.parse(await response.json());
                const vectors = [...payload.data]
                    .sort((first, second) => first.index - second.index)
                    .map((item) => item.embedding);

                if (
                    vectors.length !== texts.length
                    || vectors.some((vector) => vector.length !== dimensions)
                )
                {
                    throw new ApiError(
                        502,
                        "EMBEDDING_RESPONSE_INVALID",
                        "The embedding provider returned an unexpected result shape.",
                    );
                }

                console.log(JSON.stringify({
                    event: "embedding.request.completed",
                    inputCount: texts.length,
                    latencyMs: Date.now() - startedAt,
                    model: payload.model,
                    promptTokens: payload.usage?.prompt_tokens ?? null,
                }));

                return vectors;
            }

            if (!isRetryableStatus(response.status) || attempt === 2)
            {
                break;
            }

            await delay(500 * attempt);
        }

        console.error(JSON.stringify({
            event: "embedding.request.failed",
            inputCount: texts.length,
            model,
            status: lastStatus,
        }));

        throw new ApiError(502, "EMBEDDING_PROVIDER_FAILED", "The embedding provider request failed.");
    }
}

/**
 * createEmbeddingProvider
 * ----------------
 * Selects the live OpenAI embedding adapter or deterministic zero-cost local provider.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export function createEmbeddingProvider(bindings: SmartServiceBindings): EmbeddingProvider
{
    return bindings.INGESTION_PROVIDER_MODE === "live"
        ? new OpenAiEmbeddingProvider(bindings)
        : new DeterministicEmbeddingProvider();
}
