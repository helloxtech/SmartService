/**
 * toHex
 * ----------------
 * Encodes bytes as lowercase hexadecimal without exposing source content.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function toHex(bytes: Uint8Array): string
{
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * sha256Bytes
 * ----------------
 * Calculates a SHA-256 digest for browser, Worker, and Node-compatible byte input.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export async function sha256Bytes(input: ArrayBuffer | Uint8Array): Promise<string>
{
    const buffer = input instanceof Uint8Array
        ? new Uint8Array(input).buffer
        : input;
    const digest = await crypto.subtle.digest("SHA-256", buffer);

    return toHex(new Uint8Array(digest));
}

/**
 * sha256Text
 * ----------------
 * Calculates a SHA-256 digest for normalized UTF-8 text.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export async function sha256Text(input: string): Promise<string>
{
    return sha256Bytes(new TextEncoder().encode(input));
}

/**
 * deterministicUuid
 * ----------------
 * Derives a stable RFC 4122-shaped UUID from a namespaced value so duplicate queue deliveries use identical record IDs.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export async function deterministicUuid(namespace: string, value: string): Promise<string>
{
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`${namespace}\u0000${value}`),
    );
    const bytes = new Uint8Array(digest).slice(0, 16);
    const versionByte = bytes[6];
    const variantByte = bytes[8];

    if (versionByte === undefined || variantByte === undefined)
    {
        throw new Error("A SHA-256 digest did not contain enough bytes.");
    }

    bytes[6] = (versionByte & 0x0f) | 0x50;
    bytes[8] = (variantByte & 0x3f) | 0x80;

    const hex = toHex(bytes);

    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20, 32),
    ].join("-");
}
