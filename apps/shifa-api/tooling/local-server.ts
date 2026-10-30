import { createServer } from "node:http";
import { createApp, type Bindings } from "../src/index";
import { localCommand } from "../test/postgres";

// Synthetic data only: task-owned PostgreSQL instance, no cloud connection.
const bindings: Bindings = {
    SHIFA_SUPABASE_URL: "http://127.0.0.1:54321",
    SHIFA_SUPABASE_SERVICE_KEY: "synthetic-local-only",
    SHIFA_ENCRYPTION_KEY: btoa("12345678901234567890123456789012"),
    SHIFA_PUBLIC_ORIGIN: "http://127.0.0.1:5180",
};
const app = createApp(localCommand);
createServer(async (incoming, outgoing) =>
{
    const chunks: Buffer[] = [];
    for await (const chunk of incoming)
    {
        chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers))
    {
        if (typeof value === "string") headers.set(name, value);
    }
    const response = await app.fetch(new Request(`http://127.0.0.1:8789${incoming.url}`, {
        method: incoming.method ?? "GET", headers,
        ...(body.length ? { body } : {}),
    }), bindings);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
}).listen(8789, "127.0.0.1", () => process.stdout.write("Shifa synthetic local API on 8789\n"));
