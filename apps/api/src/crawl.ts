import {
    extractedKnowledgePayloadSchema,
    type ExtractedKnowledgePayload,
} from "@smartservice/contracts";
import {
    calculateStandardPages,
    isSameOriginPublicUrl,
    revalidateCrawlTarget,
    validateCrawlTarget,
    type DnsResolver,
    type IngestionAggregate,
} from "@smartservice/ingestion";
import { z } from "zod";

import { ApiError } from "./errors";
import type { CrawlProvider, SmartServiceBindings } from "./types";

const crawlStartResponseSchema = z.object({
    errors: z.array(z.object({
        code: z.number(),
        message: z.string(),
    })).optional(),
    result: z.string().min(1),
    success: z.literal(true),
});

const crawlRecordSchema = z.object({
    markdown: z.string().optional(),
    metadata: z.object({
        status: z.number().int(),
        title: z.string().optional(),
        url: z.url(),
    }),
    status: z.enum([
        "queued",
        "errored",
        "completed",
        "disallowed",
        "skipped",
        "cancelled",
    ]),
    url: z.url(),
});

const crawlStatusResponseSchema = z.object({
    result: z.object({
        cursor: z.string().optional(),
        finished: z.number().int().nonnegative(),
        records: z.array(crawlRecordSchema),
        skipped: z.number().int().nonnegative(),
        status: z.string(),
        total: z.number().int().nonnegative(),
    }),
    success: z.literal(true),
});

/**
 * requireCrawlerBinding
 * ----------------
 * Reads a required Browser Run configuration value without exposing it in an error response.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function requireCrawlerBinding(
    bindings: SmartServiceBindings,
    name: "CLOUDFLARE_ACCOUNT_ID" | "CLOUDFLARE_BROWSER_RUN_API_TOKEN",
): string
{
    const value = bindings[name];

    if (value === undefined || value.length === 0)
    {
        throw new ApiError(
            503,
            "CRAWLER_CONFIGURATION_MISSING",
            `The server binding ${name} is not configured.`,
        );
    }

    return value;
}

/**
 * escapeRegularExpression
 * ----------------
 * Escapes a validated origin before it is used as a Browser Run request allow-pattern.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function escapeRegularExpression(value: string): string
{
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * delay
 * ----------------
 * Waits briefly between bounded Browser Run status polls without consuming CPU.
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

/**
 * parseProviderResponse
 * ----------------
 * Parses a successful Cloudflare API envelope and hides provider response bodies on failure.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function parseProviderResponse<T>(
    response: Response,
    parser: { parse(input: unknown): T },
): Promise<T>
{
    if (!response.ok)
    {
        throw new ApiError(502, "CRAWLER_PROVIDER_FAILED", "The website crawler request failed.");
    }

    try
    {
        return parser.parse(await response.json());
    }
    catch
    {
        throw new ApiError(502, "CRAWLER_RESPONSE_INVALID", "The website crawler returned an invalid response.");
    }
}

export class CloudflareBrowserRunCrawlProvider implements CrawlProvider
{
    /**
     * CloudflareBrowserRunCrawlProvider
     * ----------------
     * Creates a live bounded crawler with explicit Worker bindings and DNS validation.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public constructor(
        private readonly bindings: SmartServiceBindings,
        private readonly resolver: DnsResolver,
    )
    {
    }

    /**
     * startCrawl
     * ----------------
     * Starts a same-origin Markdown crawl with explicit page/depth bounds and no AI-training purpose.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    private async startCrawl(
        targetUrl: string,
        origin: string,
        maxPages: number,
        maxDepth: number,
    ): Promise<string>
    {
        const accountId = requireCrawlerBinding(this.bindings, "CLOUDFLARE_ACCOUNT_ID");
        const token = requireCrawlerBinding(
            this.bindings,
            "CLOUDFLARE_BROWSER_RUN_API_TOKEN",
        );
        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/browser-rendering/crawl`,
            {
                body: JSON.stringify({
                    allowRequestPattern: [
                        `^${escapeRegularExpression(origin)}(?:/|$)`,
                    ],
                    crawlPurposes: ["search", "ai-input"],
                    depth: Math.max(1, maxDepth),
                    formats: ["markdown"],
                    limit: maxDepth === 0 ? 1 : maxPages,
                    options: {
                        includeExternalLinks: false,
                        includePatterns: [`${origin}/**`],
                        includeSubdomains: false,
                    },
                    render: true,
                    source: "links",
                    url: targetUrl,
                }),
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                },
                method: "POST",
                signal: AbortSignal.timeout(20_000),
            },
        );
        const payload = await parseProviderResponse(response, crawlStartResponseSchema);

        return payload.result;
    }

    /**
     * fetchStatus
     * ----------------
     * Loads one bounded status or result page for a Browser Run crawl job.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    private async fetchStatus(
        jobId: string,
        cursor?: string,
    ): Promise<z.infer<typeof crawlStatusResponseSchema>["result"]>
    {
        const accountId = requireCrawlerBinding(this.bindings, "CLOUDFLARE_ACCOUNT_ID");
        const token = requireCrawlerBinding(
            this.bindings,
            "CLOUDFLARE_BROWSER_RUN_API_TOKEN",
        );
        const url = new URL(
            `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/browser-rendering/crawl/${encodeURIComponent(jobId)}`,
        );

        if (cursor !== undefined)
        {
            url.searchParams.set("cursor", cursor);
        }

        const response = await fetch(url, {
            headers: {
                authorization: `Bearer ${token}`,
            },
            signal: AbortSignal.timeout(20_000),
        });
        const payload = await parseProviderResponse(response, crawlStatusResponseSchema);

        return payload.result;
    }

    /**
     * collectRecords
     * ----------------
     * Polls for at most two minutes, then collects all completed result pages without exceeding the configured limit.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    private async collectRecords(
        jobId: string,
        maxPages: number,
    ): Promise<z.infer<typeof crawlRecordSchema>[]>
    {
        let completedResult: z.infer<typeof crawlStatusResponseSchema>["result"] | null = null;

        for (let attempt = 0; attempt < 60; attempt += 1)
        {
            const result = await this.fetchStatus(jobId);
            const normalizedStatus = result.status.toLowerCase();

            if (normalizedStatus === "completed")
            {
                completedResult = result;
                break;
            }

            if (
                normalizedStatus === "errored"
                || normalizedStatus === "cancelled"
                || normalizedStatus === "failed"
            )
            {
                throw new ApiError(502, "CRAWLER_JOB_FAILED", "The website crawl did not complete.");
            }

            await delay(2_000);
        }

        if (completedResult === null)
        {
            throw new ApiError(502, "CRAWLER_TIMEOUT", "The website crawl exceeded the two-minute processing limit.");
        }

        const records = [...completedResult.records];
        let cursor = completedResult.cursor;

        while (cursor !== undefined && records.length < maxPages)
        {
            const result = await this.fetchStatus(jobId, cursor);
            records.push(...result.records);
            cursor = result.cursor;
        }

        return records.slice(0, maxPages);
    }

    /**
     * load
     * ----------------
     * Revalidates DNS, runs Browser Run, drops cross-origin/skipped records, and returns bounded extracted knowledge.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async load(aggregate: IngestionAggregate): Promise<ExtractedKnowledgePayload>
    {
        if (
            aggregate.sourceType !== "url"
            || aggregate.sourceUrl === null
            || aggregate.crawlMaxPages === null
            || aggregate.crawlMaxDepth === null
        )
        {
            throw new ApiError(500, "CRAWL_SOURCE_INVALID", "The stored crawl source is incomplete.");
        }

        const target = await validateCrawlTarget(aggregate.sourceUrl, this.resolver);
        const jobId = await this.startCrawl(
            target.url,
            target.origin,
            aggregate.crawlMaxPages,
            aggregate.crawlMaxDepth,
        );
        const records = await this.collectRecords(jobId, aggregate.crawlMaxPages);
        await revalidateCrawlTarget(target, this.resolver);

        const documents = records
            .filter((record) =>
            {
                return (
                    record.status === "completed"
                    && record.metadata.status >= 200
                    && record.metadata.status < 400
                    && record.markdown !== undefined
                    && record.markdown.trim().length > 0
                    && isSameOriginPublicUrl(record.metadata.url, target.origin)
                    && isSameOriginPublicUrl(record.url, target.origin)
                );
            })
            .map((record) =>
            {
                const canonicalUrl = new URL(record.metadata.url).toString();
                const title = record.metadata.title?.trim() || new URL(canonicalUrl).pathname || canonicalUrl;

                return {
                    canonicalUrl,
                    sections: [{
                        heading: title,
                        text: record.markdown?.trim() ?? "",
                    }],
                    title,
                };
            });

        if (documents.length === 0)
        {
            throw new ApiError(422, "CRAWL_NO_CONTENT", "The website crawl did not return usable same-origin text.");
        }

        const combinedText = documents
            .flatMap((document) => document.sections.map((section) => section.text))
            .join("\n\n");

        return extractedKnowledgePayloadSchema.parse({
            documents,
            schemaVersion: 1,
            sourceType: "url",
            standardPageCount: calculateStandardPages(combinedText),
            title: documents[0]?.title ?? new URL(target.url).hostname,
        });
    }
}

export class MockWebsiteCrawlProvider implements CrawlProvider
{
    /**
     * load
     * ----------------
     * Returns a fixed fictional same-origin mini-site for zero-cost local and automated ingestion validation.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async load(aggregate: IngestionAggregate): Promise<ExtractedKnowledgePayload>
    {
        if (aggregate.sourceType !== "url" || aggregate.sourceUrl === null)
        {
            throw new ApiError(500, "CRAWL_SOURCE_INVALID", "The stored crawl source is incomplete.");
        }

        const origin = new URL(aggregate.sourceUrl).origin;
        const documents = [
            {
                canonicalUrl: `${origin}/`,
                sections: [{
                    heading: "Smart Service Demo Knowledge",
                    text: "Smart Service demo knowledge describes fictional NF-Series industrial liquid-transfer pumps in Canada and the United States.",
                }],
                title: "Smart Service Demo Knowledge",
            },
            {
                canonicalUrl: `${origin}/products`,
                sections: [{
                    heading: "NF-Series products",
                    text: "The NF-200 and NF-500 are intended for compatible non-potable, non-flammable industrial liquids.",
                }],
                title: "NF-Series products",
            },
            {
                canonicalUrl: `${origin}/support`,
                sections: [{
                    heading: "Support and warranty",
                    text: "Warranty review requires the model, serial number, purchase date, and a description of the issue.",
                }],
                title: "Support and warranty",
            },
        ].slice(0, aggregate.crawlMaxPages ?? 3);
        const combinedText = documents
            .flatMap((document) => document.sections.map((section) => section.text))
            .join("\n\n");

        return extractedKnowledgePayloadSchema.parse({
            documents,
            schemaVersion: 1,
            sourceType: "url",
            standardPageCount: calculateStandardPages(combinedText),
            title: "Smart Service demo website",
        });
    }
}

export class FirecrawlProviderStub implements CrawlProvider
{
    /**
     * load
     * ----------------
     * Preserves the approved fallback interface while refusing use until credentials and budget are explicitly approved.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async load(): Promise<ExtractedKnowledgePayload>
    {
        throw new ApiError(
            503,
            "FIRECRAWL_NOT_APPROVED",
            "The Firecrawl fallback is not configured or approved.",
        );
    }
}
