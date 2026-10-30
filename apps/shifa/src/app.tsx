import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { reportSchema, type HealthReport } from "@shifa/contracts";
const ReportDashboard = lazy(() => import("./report-dashboard").then((module) => ({ default: module.ReportDashboard })));

type Access = { kind: "entry" | "unavailable" } | { kind: "waiting"; phrase: string } | { kind: "report"; report: HealthReport; demo: boolean; expiresAt?: string };
const createdSchema = z.object({ requestId: z.uuid(), requestToken: z.string().regex(/^[a-f0-9]{64}$/), phrase: z.string(), expiresAt: z.iso.datetime({ offset: true }) });
const statusSchema = z.discriminatedUnion("status", [
    z.object({ status: z.literal("approved"), expiresAt: z.iso.datetime({ offset: true }), report: reportSchema }),
    z.object({ status: z.enum(["pending", "expired", "denied"]) }),
]);

/**
 * App
 * ----------------
 * Keeps browser capabilities and reports in memory and rechecks access until closure.
 *
 * October 28, 2026: Created by Forrest Zhang for Shifa health reports
 */
export function App()
{
    const language = "en";
    const demoOnly = import.meta.env.VITE_SHIFA_DEMO_ONLY === "true";
    const [access, setAccess] = useState<Access>({ kind: "entry" });
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(false);
    const active = useRef<AbortController | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const expiry = useRef<ReturnType<typeof setTimeout> | null>(null);
    const zh = false;
    /**
     * close
     * ----------------
     * Clears all credentials, pending requests and visible health data.
     *
     * October 28, 2026: Created by Forrest Zhang for Shifa health reports
     */
    function close(unavailable = false)
    {
        active.current?.abort(); active.current = null;
        if (timer.current) clearTimeout(timer.current);
        if (expiry.current) clearTimeout(expiry.current);
        setAccess({ kind: unavailable ? "unavailable" : "entry" }); setBusy(false);
    }
    useEffect(() =>
    {
        const hide = () => close();
        addEventListener("pagehide", hide);
        return () => 
        {
            removeEventListener("pagehide", hide); active.current?.abort(); if (timer.current) clearTimeout(timer.current); if (expiry.current) clearTimeout(expiry.current); 
        };
    }, []);
    /**
     * request
     * ----------------
     * Starts a single browser approval and continues polling after approval for revocation.
     *
     * October 28, 2026: Created by Forrest Zhang for Shifa health reports
     */
    async function request(value: string)
    {
        close();
        if (value === "1234") 
        {
            const { demoReport } = await import("./demo");
            setAccess({ kind: "report", report: demoReport, demo: true }); return; 
        }
        if (demoOnly || !/^\d{4}$/.test(value)) return;
        const controller = new AbortController(); active.current = controller; setBusy(true);
        try
        {
            const response = await fetch("/api/shifa/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: value }), cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
            if (!response.ok) throw new Error();
            const created = createdSchema.parse(await response.json());
            if (controller.signal.aborted) return;
            setBusy(false); setAccess({ kind: "waiting", phrase: created.phrase });
            expiry.current = setTimeout(() => close(true), Math.max(0, Date.parse(created.expiresAt) - Date.now()));
            let approved = false;
            const poll = async () =>
            {
                if (controller.signal.aborted) return;
                try
                {
                    const reply = await fetch(`/api/shifa/requests/${created.requestId}`, { headers: { authorization: `Bearer ${created.requestToken}` }, cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
                    if (!reply.ok) throw new Error();
                    const result = statusSchema.parse(await reply.json());
                    if (controller.signal.aborted) return;
                    if (result.status === "expired" || result.status === "denied") 
                    {
                        close(true); return; 
                    }
                    if (result.status === "approved" && !approved)
                    {
                        approved = true;
                        if (expiry.current) clearTimeout(expiry.current);
                        expiry.current = setTimeout(() => close(true), Math.max(0, Date.parse(result.expiresAt) - Date.now()));
                        setAccess({ kind: "report", report: result.report, demo: false, expiresAt: result.expiresAt });
                    }
                    timer.current = setTimeout(() => 
                    {
                        void poll(); 
                    }, 3000);
                }
                catch 
                {
                    if (!controller.signal.aborted) close(true); 
                }
            };
            void poll();
        }
        catch 
        {
            if (!controller.signal.aborted) close(true); 
        }
    }
    return <><div className="app-top"><div className="brand">Shifa<span> / {zh ? "患者报告" : "Patient reports"}</span></div></div>
        {access.kind === "report" ? <Suspense fallback={<p className="loading">{zh ? "正在打开报告…" : "Opening report…"}</p>}><ReportDashboard report={access.report} demo={access.demo} language={language} close={() => close()} expiresAt={access.expiresAt} /></Suspense> : <main className="entry"><section className="entry-card">
            <div className="entry-symbol" aria-hidden="true">✚</div>
            <h1>{access.kind === "waiting" ? (zh ? "核对后即可查看" : "Ready for patient approval") : (zh ? "查看患者的就诊报告" : "A clearer picture of your patient's health")}</h1>
            {access.kind === "waiting" ? <><p>{zh ? "请让患者核对下面的短语，并在 Carmen 中点击“允许”。" : "Ask the patient to match this phrase and tap Allow in Carmen."}</p><div className="phrase">{access.phrase}</div><p className="muted">{zh ? "此请求约两分钟后过期。请确认患者手机收到相同短语；否则重新核对代码。" : "This request expires in about two minutes. If the phone does not show this phrase, check the code again."}</p><button className="text-button" onClick={() => close()}>{zh ? "重新输入" : "Enter another code"}</button></> : <>
                <p>{demoOnly ? "Demo only. Enter 1234 to explore a fictional report. Patient report sharing is not available yet." : "Enter the patient's four-digit code. No account or sign-in required."}</p>
                {access.kind === "unavailable" && <p role="alert" className="error">{zh ? "访问已结束或暂时无法连接，请重新核对代码。" : "Access has ended or the connection is unavailable. Check the code and try again."}</p>}
                <form onSubmit={(event) => 
                {
                    event.preventDefault(); void request(code); 
                }}><label htmlFor="patient-code">{zh ? "报告代码" : "Report code"}</label><input id="patient-code" value={code} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="0000" autoComplete="off" onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 4))} /><button disabled={busy || code.length !== 4 || (demoOnly && code !== "1234")}>{busy ? (zh ? "正在连接…" : "Connecting…") : (demoOnly ? "Open demo report" : "Request report access")}</button></form>
                <div className="entry-demo"><strong>{zh ? "先体验一份完整报告" : "Explore a complete sample report"}</strong><p>{zh ? "180 天的虚构指标、症状与用药。" : "180 days of synthetic measurements, symptoms and medication events."}</p><button className="text-button" onClick={() => 
                {
                    void request("1234"); 
                }}>{zh ? "打开演示 1234 →" : "Open demo 1234 →"}</button></div>
                <p className="privacy-note">{demoOnly ? "All demo records are fictional. This site currently does not accept patient reports." : "Everyday records stay on the patient's phone. Only a selected snapshot is uploaded, with access ending and server deletion following expiry."}</p>
            </>}
        </section></main>}
    </>;
}
