/**
 * token
 * ----------------
 * Generates a 256-bit capability that is never logged or placed in URLs.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export function token(): string
{
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * digest
 * ----------------
 * Hashes capabilities before database storage.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export async function digest(value: string): Promise<string>
{
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * encryptionKey
 * ----------------
 * Imports a server-only AES key. Invalid deployment secrets fail closed.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
async function encryptionKey(encoded: string): Promise<CryptoKey>
{
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    if (bytes.length !== 32)
    {
        throw new Error("Invalid encryption configuration");
    }
    return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/**
 * seal
 * ----------------
 * Encrypts a selected report snapshot with an independent nonce and share binding.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export async function seal(value: unknown, key: string, shareId: string): Promise<string>
{
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(shareId) },
        await encryptionKey(key), new TextEncoder().encode(JSON.stringify(value)),
    );
    const packed = new Uint8Array(iv.length + data.byteLength);
    packed.set(iv);
    packed.set(new Uint8Array(data), iv.length);
    // Chunk to avoid call-stack limits on large reports.
    let encoded = "";
    for (let index = 0; index < packed.length; index += 8192)
    {
        encoded += String.fromCharCode(...packed.subarray(index, index + 8192));
    }
    return btoa(encoded);
}

/**
 * unseal
 * ----------------
 * Authenticates the ciphertext and its original share before decoding JSON.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export async function unseal(value: string, key: string, shareId: string): Promise<unknown>
{
    const packed = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    const data = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: packed.slice(0, 12), additionalData: new TextEncoder().encode(shareId) },
        await encryptionKey(key), packed.slice(12),
    );
    return JSON.parse(new TextDecoder().decode(data)) as unknown;
}
