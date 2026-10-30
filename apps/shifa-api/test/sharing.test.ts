import { beforeEach, describe, expect, it } from "vitest";
import { createApp, type Bindings } from "../src/index";
import { digest, seal, token, unseal } from "../src/crypto";
import { localCommand, sql } from "./postgres";

const env: Bindings = {
    SHIFA_SUPABASE_URL: "http://127.0.0.1:54321", SHIFA_SUPABASE_SERVICE_KEY: "synthetic-local-only",
    SHIFA_ENCRYPTION_KEY: btoa("12345678901234567890123456789012"), SHIFA_PUBLIC_ORIGIN: "http://localhost",
};
const report = {
    version: 1, generatedAt: "2026-10-28T12:00:00Z", timezone: "America/Vancouver", patientLabel: "Synthetic test",
    period: { start: "2026-10-01T00:00:00Z", end: "2026-10-28T23:59:59Z" },
    metrics: [{ id: "bp", name: "Blood pressure", unit: "mmHg", category: "vitals", aggregation: "mean" }],
    readings: [{ id: "r1", metricId: "bp", timestamp: "2026-10-28T12:00:00Z", value: 120, secondaryValue: 80, source: "Manual" }],
    events: [], concerns: [],
};
const app = createApp(localCommand);

/**
 * request
 * ----------------
 * Calls the production HTTP app against an isolated real SQL backend.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
async function request(path: string, method = "GET", body?: unknown, capability?: string): Promise<Response>
{
    return app.request(`http://localhost/api/shifa${path}`, {
        method, headers: { "Content-Type": "application/json", ...(capability ? { Authorization: `Bearer ${capability}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env);
}

beforeEach(async () =>
{
    await sql("truncate shifa_private.requests, shifa_private.shares, shifa_private.rate_limits;");
});

describe("temporary accountless sharing", () =>
{
    it("requires the right browser approval, returns exact snapshot, then revokes and deletes", async () =>
    {
        const created = await request("/shares", "POST", { report, consent: true });
        expect(created.status).toBe(201);
        expect(created.headers.get("cache-control")).toContain("no-store");
        const share = await created.json() as { shareId: string; code: string; ownerToken: string };
        expect(share.code).toMatch(/^\d{4}$/);
        expect(share.code).not.toBe("1234");
        const browser = await (await request("/requests", "POST", { code: share.code })).json() as { requestId: string; requestToken: string; phrase: string };
        const other = await (await request("/requests", "POST", { code: share.code })).json() as { requestId: string; requestToken: string };
        expect(await (await request(`/requests/${browser.requestId}`, "GET", undefined, browser.requestToken)).json()).toMatchObject({ status: "pending" });
        expect(await (await request(`/requests/${browser.requestId}`, "GET", undefined, token())).json()).toEqual({ status: "expired" });
        const owner = await (await request(`/shares/${share.shareId}/requests`, "GET", undefined, share.ownerToken)).json() as { requests: { phrase: string }[] };
        expect(owner.requests.map((item) => item.phrase)).toContain(browser.phrase);
        expect(await (await request(`/shares/${share.shareId}/requests/${browser.requestId}`, "POST", { approve: true }, token())).json()).toEqual({ status: "expired" });
        await request(`/shares/${share.shareId}/requests/${browser.requestId}`, "POST", { approve: true }, share.ownerToken);
        expect(await (await request(`/requests/${browser.requestId}`, "GET", undefined, browser.requestToken)).json()).toMatchObject({ status: "approved", report });
        expect(await (await request(`/requests/${other.requestId}`, "GET", undefined, other.requestToken)).json()).toMatchObject({ status: "pending" });
        expect(await sql("select count(*) from shifa_private.shares where ciphertext like '%Blood pressure%';")).toBe("0");
        await request(`/shares/${share.shareId}`, "DELETE", undefined, share.ownerToken);
        expect(await (await request(`/requests/${browser.requestId}`, "GET", undefined, browser.requestToken)).json()).toEqual({ status: "expired" });
        expect(await sql("select count(*) from shifa_private.shares;")).toBe("0");
        expect(await sql("select count(*) from shifa_private.requests;")).toBe("0");
    });

    it("deletes expired snapshots and never allows old capabilities to access recycled codes", async () =>
    {
        const hash = await digest(token());
        const id = crypto.randomUUID();
        const base = { ownerHash: hash, ciphertext: "synthetic", durationMinutes: 15, clientHash: "test", codeStart: 0 };
        expect(await localCommand("create", { ...base, shareId: id }, env)).toMatchObject({ code: "0000" });
        const browserId = crypto.randomUUID();
        await localCommand("request", { code: "0000", requestId: browserId, requestHash: hash, phrase: "Test", clientHash: "test" }, env);
        await localCommand("decide", { shareId: id, requestId: browserId, ownerHash: hash, approve: true }, env);
        await sql(`update shifa_private.shares set expires_at = clock_timestamp() - interval '1 second' where id='${id}';`);
        await localCommand("cleanup", {}, env);
        expect(await sql("select count(*) from shifa_private.shares;")).toBe("0");
        await localCommand("create", { ...base, shareId: crypto.randomUUID() }, env);
        expect(await localCommand("read", { requestId: browserId, requestHash: hash }, env)).toEqual({ status: "expired" });
    });

    it("reserves demo, allocates colliding concurrent requests uniquely, and bounds full capacity", async () =>
    {
        const base = { ownerHash: await digest(token()), ciphertext: "synthetic", durationMinutes: 60, codeStart: 1234 };
        const results = await Promise.all(Array.from({ length: 8 }, (_, index) => localCommand("create", { ...base, shareId: crypto.randomUUID(), clientHash: `client${index}` }, env)));
        const codes = results.map((item) => (item as { code: string }).code);
        expect(new Set(codes).size).toBe(8);
        expect(codes).not.toContain("1234");
        await sql("insert into shifa_private.shares select gen_random_uuid(), lpad(n::text,4,'0'), repeat('a',64), 'synthetic', clock_timestamp()+interval '1 hour', clock_timestamp() from generate_series(0,9999) n where n<>1234 on conflict(code) do nothing;");
        expect(await localCommand("create", { ...base, shareId: crypto.randomUUID(), clientHash: "full" }, env)).toEqual({ status: "full" });
    }, 15000);

    it("conceals code existence, enforces rate limits, rejects malformed scope and permits symptom-only reports", async () =>
    {
        expect((await request("/requests", "POST", { code: "1234" })).status).toBe(400);
        const unknown = await (await request("/requests", "POST", { code: "0000" })).json() as { requestId: string; requestToken: string };
        expect(await (await request(`/requests/${unknown.requestId}`, "GET", undefined, unknown.requestToken)).json()).toMatchObject({ status: "pending" });
        const empty = { ...report, metrics: [], readings: [], concerns: [] };
        expect((await request("/shares", "POST", { report: empty, consent: true })).status).toBe(400);
        expect((await request("/shares", "POST", { report: { ...empty, concerns: [{ id: "knee", title: "Knee discomfort", status: "active", startDate: report.period.start }] }, consent: true })).status).toBe(201);
        expect((await request("/shares", "POST", { report, consent: false })).status).toBe(400);
        for (let index = 0; index < 30; index++)
        {
            await request("/requests", "POST", { code: "0000" });
        }
        expect((await request("/requests", "POST", { code: "0000" })).status).toBe(429);
    });

    it("denies public database access and cryptographically binds ciphertext to its share", async () =>
    {
        expect(await sql("select has_function_privilege('anon','public.shifa_command(text,jsonb)','execute');")).toBe("f");
        expect(await sql("select has_table_privilege('authenticated','shifa_private.shares','select');")).toBe("f");
        const encrypted = await seal(report, env.SHIFA_ENCRYPTION_KEY, "one");
        expect(await unseal(encrypted, env.SHIFA_ENCRYPTION_KEY, "one")).toEqual(report);
        await expect(unseal(encrypted, env.SHIFA_ENCRYPTION_KEY, "two")).rejects.toThrow();
        const unavailable = await app.request("http://localhost/api/shifa/shares", { method: "POST" }, { ...env, SHIFA_ENCRYPTION_KEY: "" });
        expect(unavailable.status).toBe(503);
    });
});
