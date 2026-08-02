import { afterEach, describe, expect, it, vi } from "vitest";

import {
    createEmbeddingProvider,
    OpenAiEmbeddingProvider,
} from "../src/embeddings";
import type { SmartServiceBindings } from "../src/types";

afterEach(() =>
{
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("OpenAiEmbeddingProvider", () =>
{
    it("can enable live embeddings independently from upload and crawl providers", () =>
    {
        expect(createEmbeddingProvider({
            EMBEDDING_PROVIDER_MODE: "live",
            INGESTION_PROVIDER_MODE: "mock",
        } as SmartServiceBindings)).toBeInstanceOf(OpenAiEmbeddingProvider);
    });

    it("retries one transient network failure and validates the 1024-dimension response", async () =>
    {
        vi.useFakeTimers();
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new Error("temporary network failure"))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                data: [{
                    embedding: Array.from({ length: 1024 }, () => 0.01),
                    index: 0,
                }],
                model: "text-embedding-3-large",
                usage: {
                    prompt_tokens: 1,
                    total_tokens: 1,
                },
            }), {
                headers: {
                    "content-type": "application/json",
                },
                status: 200,
            }));
        vi.stubGlobal("fetch", fetchMock);

        const provider = new OpenAiEmbeddingProvider({
            OPENAI_API_KEY: "unit-test-placeholder",
            OPENAI_EMBEDDING_DIMENSIONS: "1024",
            OPENAI_EMBEDDING_MODEL: "text-embedding-3-large",
        } as SmartServiceBindings);
        const pending = provider.embed(["bounded fixture text"]);

        await vi.advanceTimersByTimeAsync(500);

        await expect(pending).resolves.toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
