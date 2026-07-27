import type { EmbeddingProvider } from "./pipeline";

/**
 * createDeterministicVector
 * ----------------
 * Produces a nonzero normalized 1024-dimension fixture vector without making a cost-bearing provider call.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function createDeterministicVector(text: string): Promise<number[]>
{
    const seed = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    );
    const vector = Array.from({ length: 1024 }, (_, index) =>
    {
        const byte = seed[index % seed.length] ?? 0;
        const alternate = seed[(index * 7 + 11) % seed.length] ?? 0;

        return (byte - alternate) / 255;
    });
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

    if (magnitude === 0)
    {
        vector[0] = 1;
        return vector;
    }

    return vector.map((value) => Number((value / magnitude).toFixed(8)));
}

export class DeterministicEmbeddingProvider implements EmbeddingProvider
{
    /**
     * embed
     * ----------------
     * Generates deterministic local vectors for tests and approved mock-mode demonstrations.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async embed(texts: string[]): Promise<number[][]>
    {
        return Promise.all(texts.map(createDeterministicVector));
    }
}
