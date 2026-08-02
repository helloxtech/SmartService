import type { DnsResolver, IngestionAggregate } from "@smartservice/ingestion";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CloudflareBrowserRunCrawlProvider } from "../src/crawl";
import type { SmartServiceBindings } from "../src/types";

afterEach(() =>
{
    vi.unstubAllGlobals();
});

describe("CloudflareBrowserRunCrawlProvider", () =>
{
    it("uses the documented static crawl contract and accepts a result without skipped", async () =>
    {
        const resolver: DnsResolver = {
            resolve: vi.fn().mockResolvedValue(["93.184.216.34"]),
        };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({
                result: "40000000-0000-4000-a000-000000000001",
                success: true,
            }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                result: {
                    status: "running",
                },
                success: true,
            }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                result: {
                    finished: 1,
                    records: [{
                        markdown: "# Example Academy\nApproved course information.",
                        metadata: {
                            status: 200,
                            title: "Example Academy",
                            url: "https://example.com/",
                        },
                        status: "completed",
                        url: "https://example.com/",
                    }],
                    status: "completed",
                    total: 1,
                },
                success: true,
            }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        const provider = new CloudflareBrowserRunCrawlProvider({
            CLOUDFLARE_ACCOUNT_ID: "account-id",
            CLOUDFLARE_BROWSER_RUN_API_TOKEN: "unit-test-placeholder",
        } as SmartServiceBindings, resolver);
        const result = await provider.load({
            completedAt: null,
            crawlMaxDepth: 2,
            crawlMaxPages: 10,
            extractedObjectKey: null,
            jobId: "40000000-0000-4000-a000-000000000002",
            jobStatus: "uploaded",
            organizationId: "40000000-0000-4000-a000-000000000003",
            sourceId: "40000000-0000-4000-a000-000000000004",
            sourceStatus: "uploaded",
            sourceType: "url",
            sourceUrl: "https://example.com/",
            targetVersion: 1,
        } satisfies IngestionAggregate);

        const startRequest = fetchMock.mock.calls[0];
        const requestBody = JSON.parse(String(startRequest?.[1]?.body)) as Record<string, unknown>;

        expect(requestBody).toMatchObject({
            crawlPurposes: ["search", "ai-input"],
            formats: ["markdown"],
            render: false,
            url: "https://example.com/",
        });
        expect(requestBody).not.toHaveProperty("allowRequestPattern");
        expect(result.documents).toHaveLength(1);
        expect(result.documents[0]?.title).toBe("Example Academy");
    });
});
