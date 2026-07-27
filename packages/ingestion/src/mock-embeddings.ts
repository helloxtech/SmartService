import type { EmbeddingProvider } from "./pipeline";

const multilingualConcepts: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
    [/最大流量|流量/gu, ["flow", "maximum"]],
    [/电压|电源/gu, ["voltage", "power"]],
    [/申请保修/gu, ["warranty", "claim", "information"]],
    [/保修期|保修/gu, ["warranty"]],
    [/零下|温度/gu, ["temperature", "operating"]],
    [/连续运行/gu, ["continuous", "run", "time"]],
    [/饮用水/gu, ["drinking-water", "potable"]],
    [/退货/gu, ["return", "returns"]],
    [/定制产品/gu, ["custom-configured", "products"]],
    [/技术支持/gu, ["technical", "support"]],
    [/时间|多久/gu, ["hours", "time"]],
    [/变低/gu, ["lower", "expected"]],
    [/检查什么|先检查/gu, ["check", "troubleshooting"]],
    [/认证/gu, ["certification"]],
    [/噪音|分贝/gu, ["noise", "decibel"]],
    [/资料/gu, ["information"]],
] as const;

/**
 * hashToken
 * ----------------
 * Produces a stable unsigned feature hash without network, randomness, or platform-specific crypto behavior.
 *
 * July 26, 2026: Updated by Forrest Zhang for SmartService Day 3 Deterministic Retrieval
 */
function hashToken(token: string, seed: number): number
{
    let hash = seed >>> 0;

    for (let index = 0; index < token.length; index += 1)
    {
        hash ^= token.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619) >>> 0;
    }

    return hash;
}

/**
 * tokenizeForFixtureRetrieval
 * ----------------
 * Extracts English, numeric, SKU, and mapped Chinese concept features for repeatable bilingual local retrieval.
 *
 * July 26, 2026: Updated by Forrest Zhang for SmartService Day 3 Deterministic Retrieval
 */
function tokenizeForFixtureRetrieval(text: string): string[]
{
    const normalized = text.normalize("NFKC").toLocaleLowerCase();
    const tokens: string[] = normalized.match(/[a-z0-9]+(?:[-–][a-z0-9]+)*/gu) ?? [];

    for (const [pattern, concepts] of multilingualConcepts)
    {
        pattern.lastIndex = 0;

        if (pattern.test(normalized))
        {
            tokens.push(...concepts);
        }
    }

    return tokens;
}

/**
 * getFeatureWeight
 * ----------------
 * Gives exact product identifiers and key domain concepts enough weight to rank relevant fixture chunks first.
 *
 * July 26, 2026: Updated by Forrest Zhang for SmartService Day 3 Deterministic Retrieval
 */
function getFeatureWeight(token: string): number
{
    if (/^nf[-–]\d+$/u.test(token))
    {
        return 8;
    }

    if (/\d/u.test(token))
    {
        return 3;
    }

    if ([
        "certification",
        "continuous",
        "drinking-water",
        "flow",
        "hours",
        "maximum",
        "potable",
        "return",
        "returns",
        "support",
        "temperature",
        "voltage",
        "warranty",
    ].includes(token))
    {
        return 4;
    }

    return token.length >= 4 ? 1 : 0.35;
}

/**
 * createDeterministicVector
 * ----------------
 * Produces a normalized multilingual feature-hash vector for deterministic zero-cost local retrieval.
 *
 * July 26, 2026: Updated by Forrest Zhang for SmartService Day 3 Deterministic Retrieval
 */
function createDeterministicVector(text: string): number[]
{
    const vector = Array.from({ length: 1024 }, () => 0);
    const counts = new Map<string, number>();

    for (const token of tokenizeForFixtureRetrieval(text))
    {
        counts.set(token, (counts.get(token) ?? 0) + 1);
    }

    for (const [token, count] of counts)
    {
        const index = hashToken(token, 2_166_136_261) % vector.length;
        const sign = hashToken(token, 3_747_613_931) % 2 === 0 ? 1 : -1;
        const weight = getFeatureWeight(token) * (1 + Math.log1p(count));
        vector[index] = (vector[index] ?? 0) + sign * weight;
    }

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
        return texts.map(createDeterministicVector);
    }
}
