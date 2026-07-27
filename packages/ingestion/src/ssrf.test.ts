import { describe, expect, it } from "vitest";

import {
    assertPublicIpAddress,
    isSameOriginPublicUrl,
    parsePublicHttpUrl,
    revalidateCrawlTarget,
    UrlSafetyError,
    validateCrawlTarget,
    type DnsResolver,
} from "./ssrf";

/**
 * createResolver
 * ----------------
 * Creates a deterministic DNS resolver for fixed SSRF acceptance cases.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function createResolver(addresses: string[]): DnsResolver
{
    return {
        /**
         * resolve
         * ----------------
         * Returns the configured DNS answer without touching the network.
         *
         * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
         */
        async resolve(): Promise<string[]>
        {
            return addresses;
        },
    };
}

describe("URL SSRF validation", () =>
{
    it.each([
        "127.0.0.1",
        "10.10.10.10",
        "172.16.0.1",
        "192.168.1.1",
        "169.254.169.254",
        "100.64.0.1",
        "::1",
        "fc00::1",
        "fe80::1",
        "::ffff:127.0.0.1",
        "0.0.0.0",
        "224.0.0.1",
        "192.0.2.1",
    ])("rejects non-public address %s", (address) =>
    {
        expect(() => assertPublicIpAddress(address)).toThrow(UrlSafetyError);
    });

    it.each([
        "file:///etc/passwd",
        "http://user:password@example.com",
        "http://localhost",
        "https://service.internal",
        "https://example.com:8443",
        "http://2130706433",
        "http://0x7f000001",
        "http://0177.0.0.1",
        "http://[::ffff:127.0.0.1]",
    ])("rejects unsafe URL representation %s", (url) =>
    {
        expect(() => parsePublicHttpUrl(url)).toThrow(UrlSafetyError);
    });

    it("accepts a public same-origin site and rejects cross-origin expansion", async () =>
    {
        const target = await validateCrawlTarget(
            "https://example.com/docs#section",
            createResolver(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]),
        );

        expect(target.url).toBe("https://example.com/docs");
        expect(isSameOriginPublicUrl("https://example.com/products", target.origin)).toBe(true);
        expect(isSameOriginPublicUrl("https://other.example/products", target.origin)).toBe(false);
    });

    it("rejects private DNS answers and DNS changes", async () =>
    {
        await expect(validateCrawlTarget(
            "https://example.com",
            createResolver(["169.254.169.254"]),
        )).rejects.toMatchObject({
            code: "URL_PRIVATE_ADDRESS",
        });

        const target = await validateCrawlTarget(
            "https://example.com",
            createResolver(["93.184.216.34"]),
        );

        await expect(revalidateCrawlTarget(
            target,
            createResolver(["93.184.216.35"]),
        )).rejects.toMatchObject({
            code: "URL_DNS_CHANGED",
        });
    });
});
