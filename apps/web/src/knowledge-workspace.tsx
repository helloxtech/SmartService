import type {
    KnowledgeSource,
    OrganizationMembership,
    SourceAction,
} from "@smartservice/contracts";
import { Button } from "@smartservice/ui";
import type { Session } from "@supabase/supabase-js";
import {
    AlertCircle,
    Check,
    FileText,
    Globe2,
    LoaderCircle,
    RefreshCw,
    Trash2,
    UploadCloud,
} from "lucide-react";
import {
    useEffect,
    useRef,
    useState,
    type FormEvent,
    type JSX,
} from "react";

import {
    DocumentExtractionError,
    prepareKnowledgeFile,
} from "./lib/document-extraction";
import {
    applySourceAction,
    deleteKnowledgeSource,
    KnowledgeApiError,
    listKnowledgeSources,
    submitKnowledgeFile,
    submitWebsite,
} from "./lib/knowledge-api";

interface KnowledgeWorkspaceProps
{
    membership: OrganizationMembership;
    session: Session;
}

const processingStatuses = new Set([
    "uploaded",
    "extracting",
    "chunking",
    "embedding",
]);

const progressByStatus: Record<KnowledgeSource["status"], number> = {
    chunking: 45,
    disabled: 100,
    embedding: 70,
    extracting: 15,
    failed: 100,
    ready: 100,
    uploaded: 5,
};

/**
 * describeError
 * ----------------
 * Converts known extraction and API failures into concise workspace messages without exposing response bodies.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function describeError(error: unknown): string
{
    if (error instanceof DocumentExtractionError || error instanceof KnowledgeApiError)
    {
        return error.message;
    }

    if (error instanceof Error)
    {
        return error.message;
    }

    return "The knowledge operation could not be completed.";
}

/**
 * formatSourceType
 * ----------------
 * Formats a source type for compact operator-facing display.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function formatSourceType(type: KnowledgeSource["type"]): string
{
    if (type === "url")
    {
        return "Website";
    }

    return type.toUpperCase();
}

/**
 * formatUpdatedAt
 * ----------------
 * Formats an ISO timestamp in the operator's local browser time.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function formatUpdatedAt(value: string): string
{
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(value));
}

/**
 * statusClassName
 * ----------------
 * Maps processing state to an accessible badge treatment without relying on color alone.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function statusClassName(status: KnowledgeSource["status"]): string
{
    if (status === "ready")
    {
        return "border-emerald-200 bg-emerald-50 text-emerald-800";
    }

    if (status === "failed")
    {
        return "border-rose-200 bg-rose-50 text-rose-800";
    }

    if (status === "disabled")
    {
        return "border-slate-200 bg-slate-100 text-slate-700";
    }

    return "border-sky-200 bg-sky-50 text-sky-800";
}

/**
 * KnowledgeWorkspace
 * ----------------
 * Renders Day 2 Admin intake controls, progress/error visibility, and tenant-scoped source management.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export function KnowledgeWorkspace({
    membership,
    session,
}: KnowledgeWorkspaceProps): JSX.Element
{
    const isAdmin = membership.role === "admin";
    const [sources, setSources] = useState<KnowledgeSource[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState<string | null>(null);
    const [file, setFile] = useState<File | null>(null);
    const [fileStage, setFileStage] = useState<string | null>(null);
    const [url, setUrl] = useState("https://example.com");
    const [urlSubmitting, setUrlSubmitting] = useState(false);
    const [busySourceId, setBusySourceId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    /**
     * refreshSources
     * ----------------
     * Reloads the current tenant source list and preserves a clear error when the API is unavailable.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    async function refreshSources(showLoading = false): Promise<void>
    {
        if (showLoading)
        {
            setLoading(true);
        }

        try
        {
            setSources(await listKnowledgeSources(session));
        }
        catch (error: unknown)
        {
            setMessage(describeError(error));
        }
        finally
        {
            if (showLoading)
            {
                setLoading(false);
            }
        }
    }

    useEffect(() =>
    {
        let active = true;

        /**
         * loadCurrentSources
         * ----------------
         * Loads tenant sources after the effect subscribes and ignores results after unmount.
         *
         * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
         */
        async function loadCurrentSources(): Promise<void>
        {
            try
            {
                const currentSources = await listKnowledgeSources(session);

                if (active)
                {
                    setSources(currentSources);
                    setLoading(false);
                }
            }
            catch (error: unknown)
            {
                if (active)
                {
                    setMessage(describeError(error));
                    setLoading(false);
                }
            }
        }

        void loadCurrentSources();
        const interval = globalThis.setInterval(() =>
        {
            void loadCurrentSources();
        }, 3_000);

        return () =>
        {
            active = false;
            globalThis.clearInterval(interval);
        };
    }, [session]);

    /**
     * handleFileSubmit
     * ----------------
     * Extracts a selected PDF/DOCX in-browser, uploads both objects, and queues the validated intake.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    async function handleFileSubmit(event: FormEvent<HTMLFormElement>): Promise<void>
    {
        event.preventDefault();
        setMessage(null);

        if (file === null)
        {
            setMessage("Choose a PDF or DOCX file first.");
            return;
        }

        try
        {
            setFileStage("Extracting text in your browser…");
            const prepared = await prepareKnowledgeFile(file);
            setFileStage("Uploading original and extracted content…");
            await submitKnowledgeFile(session, prepared);
            setFile(null);

            if (fileInputRef.current !== null)
            {
                fileInputRef.current.value = "";
            }

            await refreshSources(false);
            setFileStage(null);
            setMessage("Document queued for chunking and embedding.");
        }
        catch (error: unknown)
        {
            setFileStage(null);
            setMessage(describeError(error));
        }
    }

    /**
     * handleUrlSubmit
     * ----------------
     * Submits a bounded same-origin crawl for server-side SSRF validation and asynchronous processing.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    async function handleUrlSubmit(event: FormEvent<HTMLFormElement>): Promise<void>
    {
        event.preventDefault();
        setMessage(null);
        setUrlSubmitting(true);

        try
        {
            await submitWebsite(session, {
                maxDepth: 2,
                maxPages: 10,
                url,
            });
            setMessage("Website crawl queued. Status will refresh automatically.");
            await refreshSources(false);
        }
        catch (error: unknown)
        {
            setMessage(describeError(error));
        }
        finally
        {
            setUrlSubmitting(false);
        }
    }

    /**
     * handleSourceAction
     * ----------------
     * Applies a retry, disable, or enable action and refreshes the tenant source list.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    async function handleSourceAction(sourceId: string, action: SourceAction): Promise<void>
    {
        setBusySourceId(sourceId);
        setMessage(null);

        try
        {
            await applySourceAction(session, sourceId, action);
            await refreshSources(false);
        }
        catch (error: unknown)
        {
            setMessage(describeError(error));
        }
        finally
        {
            setBusySourceId(null);
        }
    }

    /**
     * handleDelete
     * ----------------
     * Confirms and soft-deletes one source before requesting best-effort R2 object cleanup.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    async function handleDelete(source: KnowledgeSource): Promise<void>
    {
        if (!globalThis.confirm(`Delete "${source.name}" and remove it from retrieval?`))
        {
            return;
        }

        setBusySourceId(source.id);
        setMessage(null);

        try
        {
            await deleteKnowledgeSource(session, source.id);
            await refreshSources(false);
        }
        catch (error: unknown)
        {
            setMessage(describeError(error));
        }
        finally
        {
            setBusySourceId(null);
        }
    }

    return (
        <section className="mx-auto max-w-6xl px-6 pb-16" aria-labelledby="knowledge-heading">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <p className="text-sm font-semibold text-sky-700">Approved company content</p>
                    <h2 className="mt-1 text-3xl font-bold tracking-tight" id="knowledge-heading">
                        Knowledge
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                        Upload text-based PDF or DOCX files, or crawl a bounded public website. Ready content becomes eligible for grounded answers.
                    </p>
                </div>
                <Button
                    disabled={loading}
                    onClick={() => void refreshSources(true)}
                    size="sm"
                    variant="outline"
                >
                    <RefreshCw aria-hidden="true" className={loading ? "size-4 animate-spin" : "size-4"} />
                    Refresh
                </Button>
            </div>

            {message === null
                ? null
                : (
                    <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
                        {message}
                    </div>
                )}

            {isAdmin
                ? (
                    <div className="mb-8 grid gap-5 lg:grid-cols-2">
                        <form className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" onSubmit={handleFileSubmit}>
                            <div className="flex items-start gap-3">
                                <div className="rounded-xl bg-sky-50 p-2.5 text-sky-700">
                                    <UploadCloud aria-hidden="true" className="size-5" />
                                </div>
                                <div>
                                    <h3 className="font-bold">Upload a document</h3>
                                    <p className="mt-1 text-sm text-slate-500">
                                        PDF or DOCX, up to 20 MB. Scanned PDF OCR is not included.
                                    </p>
                                </div>
                            </div>
                            <input
                                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                className="mt-5 block w-full rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:font-semibold file:text-white"
                                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                                ref={fileInputRef}
                                type="file"
                            />
                            {fileStage === null
                                ? null
                                : (
                                    <p className="mt-3 flex items-center gap-2 text-sm text-sky-800" role="status">
                                        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                                        {fileStage}
                                    </p>
                                )}
                            <Button className="mt-5" disabled={file === null || fileStage !== null} type="submit">
                                Extract and upload
                            </Button>
                        </form>

                        <form className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" onSubmit={handleUrlSubmit}>
                            <div className="flex items-start gap-3">
                                <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-700">
                                    <Globe2 aria-hidden="true" className="size-5" />
                                </div>
                                <div>
                                    <h3 className="font-bold">Add a website</h3>
                                    <p className="mt-1 text-sm text-slate-500">
                                        Public HTTP(S), same origin, up to 10 demo pages and depth 2.
                                    </p>
                                </div>
                            </div>
                            <label className="mt-5 block text-sm font-medium" htmlFor="knowledge-url">
                                Website URL
                            </label>
                            <input
                                className="mt-2 h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
                                id="knowledge-url"
                                onChange={(event) => setUrl(event.target.value)}
                                required
                                type="url"
                                value={url}
                            />
                            <Button className="mt-5" disabled={urlSubmitting} type="submit" variant="outline">
                                {urlSubmitting ? "Validating…" : "Validate and crawl"}
                            </Button>
                        </form>
                    </div>
                )
                : (
                    <div className="mb-8 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                        Agent access is read-only. An organization Admin manages knowledge sources.
                    </div>
                )}

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-5 py-4">
                    <h3 className="font-bold">Sources</h3>
                    <p className="mt-1 text-sm text-slate-500">
                        {sources.length} active record{sources.length === 1 ? "" : "s"} in this organization
                    </p>
                </div>

                {loading
                    ? (
                        <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
                            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                            Loading sources…
                        </div>
                    )
                    : sources.length === 0
                        ? (
                            <div className="p-10 text-center">
                                <FileText aria-hidden="true" className="mx-auto size-7 text-slate-400" />
                                <p className="mt-3 font-semibold">No knowledge sources yet</p>
                                <p className="mt-1 text-sm text-slate-500">
                                    Add a document or website to start the ingestion pipeline.
                                </p>
                            </div>
                        )
                        : (
                            <ul className="divide-y divide-slate-200">
                                {sources.map((source) =>
                                {
                                    const processing = processingStatuses.has(source.status);
                                    const busy = busySourceId === source.id;

                                    return (
                                        <li className="p-5" key={source.id}>
                                            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                                                <div className="w-full min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        {source.type === "url"
                                                            ? <Globe2 aria-hidden="true" className="size-4 text-indigo-600" />
                                                            : <FileText aria-hidden="true" className="size-4 text-sky-700" />}
                                                        <p className="max-w-xl truncate font-semibold">{source.name}</p>
                                                        <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                                                            {formatSourceType(source.type)}
                                                        </span>
                                                        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${statusClassName(source.status)}`}>
                                                            {source.status}
                                                        </span>
                                                    </div>
                                                    <p className="mt-2 text-xs text-slate-500">
                                                        Updated {formatUpdatedAt(source.updatedAt)}
                                                        {" · "}
                                                        v{source.activeVersion}
                                                        {" · "}
                                                        {source.documentCount} docs
                                                        {" · "}
                                                        {source.chunkCount} chunks
                                                    </p>
                                                    {source.sourceUrl === null
                                                        ? null
                                                        : (
                                                            <p className="mt-1 truncate text-xs text-slate-500">
                                                                {source.sourceUrl}
                                                            </p>
                                                        )}
                                                    {processing
                                                        ? (
                                                            <div className="mt-4 max-w-xl">
                                                                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                                                                    <div
                                                                        className="h-full rounded-full bg-sky-600 transition-[width]"
                                                                        style={{ width: `${progressByStatus[source.status]}%` }}
                                                                    />
                                                                </div>
                                                                <p className="mt-1 text-xs capitalize text-sky-700">
                                                                    {source.status}…
                                                                </p>
                                                            </div>
                                                        )
                                                        : null}
                                                    {source.errorMessage === null
                                                        ? null
                                                        : (
                                                            <p className="mt-3 flex max-w-2xl items-start gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
                                                                <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                                                                {source.errorMessage}
                                                            </p>
                                                        )}
                                                </div>

                                                {isAdmin
                                                    ? (
                                                        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
                                                            {source.status === "failed" || source.status === "ready"
                                                                ? (
                                                                    <Button
                                                                        disabled={busy}
                                                                        onClick={() => void handleSourceAction(source.id, "retry")}
                                                                        size="sm"
                                                                        variant="outline"
                                                                    >
                                                                        <RefreshCw aria-hidden="true" className="size-4" />
                                                                        Reprocess
                                                                    </Button>
                                                                )
                                                                : null}
                                                            {source.status === "disabled"
                                                                ? (
                                                                    <Button
                                                                        disabled={busy}
                                                                        onClick={() => void handleSourceAction(source.id, "enable")}
                                                                        size="sm"
                                                                        variant="outline"
                                                                    >
                                                                        <Check aria-hidden="true" className="size-4" />
                                                                        Enable
                                                                    </Button>
                                                                )
                                                                : source.status === "ready" || source.status === "failed"
                                                                    ? (
                                                                        <Button
                                                                            disabled={busy}
                                                                            onClick={() => void handleSourceAction(source.id, "disable")}
                                                                            size="sm"
                                                                            variant="ghost"
                                                                        >
                                                                            Disable
                                                                        </Button>
                                                                    )
                                                                    : null}
                                                            <Button
                                                                aria-label={`Delete ${source.name}`}
                                                                disabled={busy || processing}
                                                                onClick={() => void handleDelete(source)}
                                                                size="icon"
                                                                variant="ghost"
                                                            >
                                                                <Trash2 aria-hidden="true" className="size-4 text-rose-700" />
                                                            </Button>
                                                        </div>
                                                    )
                                                    : null}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
            </div>
        </section>
    );
}
