import ipaddr from "ipaddr.js";
import { z } from "zod";

const blockedHostnameSuffixes = [
    ".home.arpa",
    ".internal",
    ".local",
    ".localhost",
] as const;

const dnsResponseSchema = z.object({
    Answer: z.array(z.object({
        data: z.string(),
        type: z.number().int(),
    })).optional(),
    Status: z.number().int(),
});

export interface DnsResolver
{
    resolve(hostname: string): Promise<string[]>;
}

export interface ValidatedCrawlTarget
{
    addresses: string[];
    origin: string;
    url: string;
}

export class UrlSafetyError extends Error
{
    public readonly code: string;

    /**
     * UrlSafetyError
     * ----------------
     * Creates a bounded URL-security failure with a stable user-safe error code.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public constructor(code: string, message: string)
    {
        super(message);
        this.code = code;
        this.name = "UrlSafetyError";
    }
}

/**
 * normalizeIpLiteral
 * ----------------
 * Removes URL-only IPv6 brackets while rejecting scoped addresses that can bypass host comparisons.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function normalizeIpLiteral(value: string): string
{
    const normalized = value.startsWith("[") && value.endsWith("]")
        ? value.slice(1, -1)
        : value;

    if (normalized.includes("%"))
    {
        throw new UrlSafetyError("URL_PRIVATE_ADDRESS", "Scoped IP addresses are not allowed.");
    }

    return normalized;
}

/**
 * assertPublicIpAddress
 * ----------------
 * Rejects loopback, private, mapped, link-local, metadata-adjacent, documentation, and otherwise non-unicast IP ranges.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export function assertPublicIpAddress(value: string): void
{
    let address: ipaddr.IPv4 | ipaddr.IPv6;

    try
    {
        address = ipaddr.parse(normalizeIpLiteral(value));
    }
    catch
    {
        throw new UrlSafetyError("URL_INVALID_ADDRESS", "The website resolved to an invalid IP address.");
    }

    if (address.kind() === "ipv6")
    {
        const ipv6Address = address as ipaddr.IPv6;

        if (ipv6Address.isIPv4MappedAddress())
        {
            assertPublicIpAddress(ipv6Address.toIPv4Address().toString());
            return;
        }
    }

    if (address.range() !== "unicast")
    {
        throw new UrlSafetyError(
            "URL_PRIVATE_ADDRESS",
            "Private, local, reserved, or non-routable website addresses are not allowed.",
        );
    }
}

/**
 * parsePublicHttpUrl
 * ----------------
 * Normalizes an HTTP(S) URL and rejects credentials, fragments, nonstandard ports, local names, and direct private IPs.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export function parsePublicHttpUrl(input: string): URL
{
    let url: URL;

    try
    {
        url = new URL(input);
    }
    catch
    {
        throw new UrlSafetyError("URL_INVALID", "Enter a valid public HTTP or HTTPS URL.");
    }

    if (url.protocol !== "http:" && url.protocol !== "https:")
    {
        throw new UrlSafetyError("URL_SCHEME_NOT_ALLOWED", "Only HTTP and HTTPS websites are allowed.");
    }

    if (url.username.length > 0 || url.password.length > 0)
    {
        throw new UrlSafetyError("URL_USERINFO_NOT_ALLOWED", "Website URLs cannot contain credentials.");
    }

    if (
        url.port.length > 0
        && !(
            (url.protocol === "http:" && url.port === "80")
            || (url.protocol === "https:" && url.port === "443")
        )
    )
    {
        throw new UrlSafetyError("URL_PORT_NOT_ALLOWED", "Only standard HTTP and HTTPS ports are allowed.");
    }

    const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");

    if (
        hostname === "localhost"
        || blockedHostnameSuffixes.some((suffix) => hostname.endsWith(suffix))
    )
    {
        throw new UrlSafetyError("URL_LOCAL_HOSTNAME", "Local website hostnames are not allowed.");
    }

    if (ipaddr.isValid(normalizeIpLiteral(hostname)))
    {
        assertPublicIpAddress(hostname);
    }

    url.hostname = hostname;
    url.hash = "";

    return url;
}

/**
 * sortUnique
 * ----------------
 * Produces a stable DNS-address set for resolution-change detection.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function sortUnique(values: string[]): string[]
{
    return [...new Set(values)].sort();
}

/**
 * validateCrawlTarget
 * ----------------
 * Resolves and validates every address before a crawl and records the exact public DNS set for rebinding checks.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export async function validateCrawlTarget(
    input: string,
    resolver: DnsResolver,
): Promise<ValidatedCrawlTarget>
{
    const url = parsePublicHttpUrl(input);
    const literalHostname = normalizeIpLiteral(url.hostname);
    const addresses = ipaddr.isValid(literalHostname)
        ? [literalHostname]
        : sortUnique(await resolver.resolve(url.hostname));

    if (addresses.length === 0)
    {
        throw new UrlSafetyError("URL_DNS_EMPTY", "The website hostname did not resolve.");
    }

    for (const address of addresses)
    {
        assertPublicIpAddress(address);
    }

    return {
        addresses,
        origin: url.origin,
        url: url.toString(),
    };
}

/**
 * revalidateCrawlTarget
 * ----------------
 * Re-resolves the hostname after crawling and rejects DNS changes that could indicate rebinding.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export async function revalidateCrawlTarget(
    target: ValidatedCrawlTarget,
    resolver: DnsResolver,
): Promise<void>
{
    const url = parsePublicHttpUrl(target.url);
    const literalHostname = normalizeIpLiteral(url.hostname);
    const addresses = ipaddr.isValid(literalHostname)
        ? [literalHostname]
        : sortUnique(await resolver.resolve(url.hostname));

    for (const address of addresses)
    {
        assertPublicIpAddress(address);
    }

    if (JSON.stringify(addresses) !== JSON.stringify(target.addresses))
    {
        throw new UrlSafetyError(
            "URL_DNS_CHANGED",
            "The website address changed during validation. Try again after confirming its DNS settings.",
        );
    }
}

/**
 * isSameOriginPublicUrl
 * ----------------
 * Accepts only validated same-origin crawl records and rejects redirect or expansion targets outside the approved site.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export function isSameOriginPublicUrl(input: string, expectedOrigin: string): boolean
{
    try
    {
        return parsePublicHttpUrl(input).origin === expectedOrigin;
    }
    catch
    {
        return false;
    }
}

/**
 * resolveDnsOverHttps
 * ----------------
 * Resolves A and AAAA records through Cloudflare DNS-over-HTTPS with a bounded timeout and validated response shape.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function resolveDnsOverHttps(hostname: string, type: "A" | "AAAA"): Promise<string[]>
{
    const url = new URL("https://cloudflare-dns.com/dns-query");
    url.searchParams.set("name", hostname);
    url.searchParams.set("type", type);

    const response = await fetch(url, {
        headers: {
            accept: "application/dns-json",
        },
        signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok)
    {
        throw new UrlSafetyError("URL_DNS_FAILED", "The website hostname could not be validated.");
    }

    const payload = dnsResponseSchema.parse(await response.json());

    if (payload.Status !== 0 && payload.Status !== 3)
    {
        throw new UrlSafetyError("URL_DNS_FAILED", "The website hostname could not be validated.");
    }

    const expectedType = type === "A" ? 1 : 28;

    return (payload.Answer ?? [])
        .filter((answer) => answer.type === expectedType)
        .map((answer) => answer.data);
}

export const cloudflareDnsResolver: DnsResolver = {
    /**
     * resolve
     * ----------------
     * Resolves both IPv4 and IPv6 addresses and returns a stable unique set for SSRF validation.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    async resolve(hostname: string): Promise<string[]>
    {
        const results = await Promise.all([
            resolveDnsOverHttps(hostname, "A"),
            resolveDnsOverHttps(hostname, "AAAA"),
        ]);

        return sortUnique(results.flat());
    },
};
