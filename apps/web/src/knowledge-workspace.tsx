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

import { normalizeVisibleDemoBrand } from "./branding";
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
import type { UiLanguage } from "./language";

interface KnowledgeWorkspaceProps
{
    language?: UiLanguage;
    membership: OrganizationMembership;
    session: Session;
}

const knowledgeCopy: Record<UiLanguage, {
    addWebsite: string;
    addWebsiteBody: string;
    agentReadOnly: string;
    approvedContent: string;
    documentBody: string;
    documentQueued: string;
    docsLabel: string;
    chunksLabel: string;
    cancelDelete: string;
    confirmDelete: string;
    crawlerPolicyBlocked: string;
    deleteConfirm(name: string): string;
    deleteLabel(name: string): string;
    disable: string;
    enable: string;
    extractUpload: string;
    extractingStage: string;
    fileRequired: string;
    knowledge: string;
    loadingSources: string;
    noSources: string;
    noSourcesBody: string;
    refresh: string;
    reprocess: string;
    sources: string;
    sourceCount(count: number): string;
    sourceAlreadyExists: string;
    subtitle: string;
    updated: string;
    uploadDocument: string;
    uploadingStage: string;
    validating: string;
    validateCrawl: string;
    websiteQueued: string;
    websiteUrl: string;
}> = {
    en: {
        addWebsite: "Add a website",
        addWebsiteBody: "Public HTTP(S), same origin, up to 10 demo pages and depth 2.",
        agentReadOnly: "Agent access is read-only. An organization Admin can add or update approved knowledge.",
        approvedContent: "Approved company content",
        documentBody: "PDF or DOCX, up to 20 MB. Scanned PDF OCR is not included.",
        documentQueued: "Document queued for chunking and embedding.",
        docsLabel: "docs",
        chunksLabel: "chunks",
        cancelDelete: "Cancel",
        confirmDelete: "Confirm delete",
        crawlerPolicyBlocked: "This website blocks the Cloudflare crawler in robots.txt. If you manage the site, allow CloudflareBrowserRenderingCrawler and permit ai-input, then reprocess. Otherwise, upload approved PDF or DOCX content.",
        deleteConfirm: (name) => `Delete "${name}" and remove it from retrieval?`,
        deleteLabel: (name) => `Delete ${name}`,
        disable: "Disable",
        enable: "Enable",
        extractUpload: "Extract and upload",
        extractingStage: "Extracting text in your browser…",
        fileRequired: "Choose a PDF or DOCX file first.",
        knowledge: "Knowledge",
        loadingSources: "Loading sources…",
        noSources: "No knowledge sources yet",
        noSourcesBody: "Add a document or website to start the ingestion pipeline.",
        refresh: "Refresh",
        reprocess: "Reprocess",
        sources: "Sources",
        sourceCount: (count) => `${count} active record${count === 1 ? "" : "s"} in this organization`,
        sourceAlreadyExists: "This website is already in Sources. Use Enable or Reprocess on its existing row.",
        subtitle: "Upload text-based PDF or DOCX files, or crawl a bounded public website. Ready content becomes eligible for grounded answers.",
        updated: "Updated",
        uploadDocument: "Upload a document",
        uploadingStage: "Uploading original and extracted content…",
        validating: "Validating…",
        validateCrawl: "Validate and crawl",
        websiteQueued: "Website crawl queued. Status will refresh automatically.",
        websiteUrl: "Website URL",
    },
    "zh-CN": {
        addWebsite: "添加网站",
        addWebsiteBody: "公开 HTTP(S) 网站，同一域名，演示限制为最多 10 页、深度 2。",
        agentReadOnly: "客服账号只能查看。组织管理员可以添加或更新已批准知识。",
        approvedContent: "已批准企业内容",
        documentBody: "支持 PDF 或 DOCX，最大 20 MB；暂不包含扫描 PDF OCR。",
        documentQueued: "文档已加入分块和嵌入队列。",
        docsLabel: "个文档",
        chunksLabel: "个片段",
        cancelDelete: "取消",
        confirmDelete: "确认删除",
        crawlerPolicyBlocked: "该网站的 robots.txt 已阻止 Cloudflare 抓取器。如果您管理该网站，请允许 CloudflareBrowserRenderingCrawler 并开放 ai-input，然后重新处理；否则请上传已批准的 PDF 或 DOCX 内容。",
        deleteConfirm: (name) => `删除“${name}”并从检索中移除？`,
        deleteLabel: (name) => `删除 ${name}`,
        disable: "停用",
        enable: "启用",
        extractUpload: "提取并上传",
        extractingStage: "正在浏览器中提取文本…",
        fileRequired: "请先选择 PDF 或 DOCX 文件。",
        knowledge: "知识库",
        loadingSources: "正在加载来源…",
        noSources: "暂无知识来源",
        noSourcesBody: "添加文档或网站后即可启动知识处理流程。",
        refresh: "刷新",
        reprocess: "重新处理",
        sources: "来源",
        sourceCount: (count) => `本组织有 ${count} 条可用记录`,
        sourceAlreadyExists: "该网站已在下方来源列表中。请在现有记录上使用“启用”或“重新处理”。",
        subtitle: "上传文字型 PDF/DOCX，或抓取受限公开网站。就绪内容可用于有依据回答。",
        updated: "更新于",
        uploadDocument: "上传文档",
        uploadingStage: "正在上传原文件和提取内容…",
        validating: "验证中…",
        validateCrawl: "验证并抓取",
        websiteQueued: "网站抓取已加入队列，状态会自动刷新。",
        websiteUrl: "网站地址",
    },
};

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
 * formatKnowledgeSourceError
 * ----------------
 * Localizes known actionable ingestion failures while retaining the server's bounded fallback for unknown errors.
 *
 * August 08, 2026: Created by Forrest Zhang for SmartService Knowledge Crawl Policy Diagnosis
 */
function formatKnowledgeSourceError(
    source: Pick<KnowledgeSource, "errorCode" | "errorMessage">,
    language: UiLanguage,
): string | null
{
    if (source.errorCode === "CRAWLER_POLICY_BLOCKED")
    {
        return knowledgeCopy[language].crawlerPolicyBlocked;
    }

    return source.errorMessage;
}

/**
 * formatSourceType
 * ----------------
 * Formats a source type for compact operator-facing display.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function formatSourceType(type: KnowledgeSource["type"], language: UiLanguage): string
{
    if (type === "url")
    {
        return language === "zh-CN" ? "网站" : "Website";
    }

    return type.toUpperCase();
}

/**
 * formatSourceStatus
 * ----------------
 * Converts stored ingestion status values into compact operator-facing labels.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService Workspace UX
 */
function formatSourceStatus(status: KnowledgeSource["status"], language: UiLanguage): string
{
    if (language === "zh-CN")
    {
        const labels: Record<KnowledgeSource["status"], string> = {
            chunking: "分块中",
            disabled: "已停用",
            embedding: "嵌入中",
            extracting: "提取中",
            failed: "失败",
            ready: "就绪",
            uploaded: "已上传",
        };

        return labels[status];
    }

    return status;
}

/**
 * formatUpdatedAt
 * ----------------
 * Formats an ISO timestamp in the operator's local browser time.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function formatUpdatedAt(value: string, language: UiLanguage): string
{
    return new Intl.DateTimeFormat(language === "zh-CN" ? "zh-CN" : undefined, {
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
    language = "en",
    membership,
    session,
}: KnowledgeWorkspaceProps): JSX.Element
{
    const copy = knowledgeCopy[language];
    const isAdmin = membership.role === "admin";
    const [sources, setSources] = useState<KnowledgeSource[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState<string | null>(null);
    const [file, setFile] = useState<File | null>(null);
    const [fileStage, setFileStage] = useState<string | null>(null);
    const [url, setUrl] = useState("https://example.com");
    const [urlSubmitting, setUrlSubmitting] = useState(false);
    const [busySourceId, setBusySourceId] = useState<string | null>(null);
    const [pendingDeleteSourceId, setPendingDeleteSourceId] = useState<string | null>(null);
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
            setMessage(copy.fileRequired);
            return;
        }

        try
        {
            setFileStage(copy.extractingStage);
            const prepared = await prepareKnowledgeFile(file);
            setFileStage(copy.uploadingStage);
            await submitKnowledgeFile(session, prepared);
            setFile(null);

            if (fileInputRef.current !== null)
            {
                fileInputRef.current.value = "";
            }

            await refreshSources(false);
            setFileStage(null);
            setMessage(copy.documentQueued);
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
            const requestedUrl = new URL(url).toString();
            const existingSource = sources.find((source) =>
            {
                return source.sourceUrl !== null
                    && new URL(source.sourceUrl).toString() === requestedUrl;
            });

            if (existingSource !== undefined)
            {
                setMessage(copy.sourceAlreadyExists);
                return;
            }

            await submitWebsite(session, {
                maxDepth: 2,
                maxPages: 10,
                url: requestedUrl,
            });
            setMessage(copy.websiteQueued);
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
        setBusySourceId(source.id);
        setMessage(null);

        try
        {
            await deleteKnowledgeSource(session, source.id);
            setSources((currentSources) => currentSources.filter((currentSource) =>
            {
                return currentSource.id !== source.id;
            }));
            setPendingDeleteSourceId(null);
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
        <section className="mx-auto max-w-[118rem] px-6 pb-16 lg:px-8" aria-labelledby="knowledge-heading">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <p className="text-sm font-semibold text-sky-700">{copy.approvedContent}</p>
                    <h2 className="mt-1 text-3xl font-bold tracking-tight" id="knowledge-heading">
                        {copy.knowledge}
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                        {copy.subtitle}
                    </p>
                </div>
                <Button
                    disabled={loading}
                    onClick={() => void refreshSources(true)}
                    size="sm"
                    variant="outline"
                >
                    <RefreshCw aria-hidden="true" className={loading ? "size-4 animate-spin" : "size-4"} />
                    {copy.refresh}
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
                                    <h3 className="font-bold">{copy.uploadDocument}</h3>
                                    <p className="mt-1 text-sm text-slate-500">
                                        {copy.documentBody}
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
                                {copy.extractUpload}
                            </Button>
                        </form>

                        <form className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" onSubmit={handleUrlSubmit}>
                            <div className="flex items-start gap-3">
                                <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-700">
                                    <Globe2 aria-hidden="true" className="size-5" />
                                </div>
                                <div>
                                    <h3 className="font-bold">{copy.addWebsite}</h3>
                                    <p className="mt-1 text-sm text-slate-500">
                                        {copy.addWebsiteBody}
                                    </p>
                                </div>
                            </div>
                            <label className="mt-5 block text-sm font-medium" htmlFor="knowledge-url">
                                {copy.websiteUrl}
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
                                {urlSubmitting ? copy.validating : copy.validateCrawl}
                            </Button>
                        </form>
                    </div>
                )
                : (
                    <div className="mb-8 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                        {copy.agentReadOnly}
                    </div>
                )}

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-5 py-4">
                    <h3 className="font-bold">{copy.sources}</h3>
                    <p className="mt-1 text-sm text-slate-500">
                        {copy.sourceCount(sources.length)}
                    </p>
                </div>

                {loading
                    ? (
                        <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
                            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                            {copy.loadingSources}
                        </div>
                    )
                    : sources.length === 0
                        ? (
                            <div className="p-10 text-center">
                                <FileText aria-hidden="true" className="mx-auto size-7 text-slate-400" />
                                <p className="mt-3 font-semibold">{copy.noSources}</p>
                                <p className="mt-1 text-sm text-slate-500">
                                    {copy.noSourcesBody}
                                </p>
                            </div>
                        )
                        : (
                            <ul className="divide-y divide-slate-200">
                                {sources.map((source) =>
                                {
                                    const processing = processingStatuses.has(source.status);
                                    const busy = busySourceId === source.id;
                                    const confirmingDelete = pendingDeleteSourceId === source.id;
                                    const visibleSourceName = normalizeVisibleDemoBrand(source.name);
                                    const visibleError = formatKnowledgeSourceError(source, language);

                                    return (
                                        <li className="p-5" key={source.id}>
                                            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                                                <div className="w-full min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        {source.type === "url"
                                                            ? <Globe2 aria-hidden="true" className="size-4 text-indigo-600" />
                                                            : <FileText aria-hidden="true" className="size-4 text-sky-700" />}
                                                        <p className="max-w-xl truncate font-semibold">{visibleSourceName}</p>
                                                        <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                                                            {formatSourceType(source.type, language)}
                                                        </span>
                                                        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClassName(source.status)}`}>
                                                            {formatSourceStatus(source.status, language)}
                                                        </span>
                                                    </div>
                                                    <p className="mt-2 text-xs text-slate-500">
                                                        {copy.updated} {formatUpdatedAt(source.updatedAt, language)}
                                                        {" · "}
                                                        v{source.activeVersion}
                                                        {" · "}
                                                        {source.documentCount} {copy.docsLabel}
                                                        {" · "}
                                                        {source.chunkCount} {copy.chunksLabel}
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
                                                                <p className="mt-1 text-xs text-sky-700">
                                                                    {formatSourceStatus(source.status, language)}…
                                                                </p>
                                                            </div>
                                                        )
                                                        : null}
                                                    {visibleError === null
                                                        ? null
                                                        : (
                                                            <p className="mt-3 flex max-w-2xl items-start gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
                                                                <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                                                                {visibleError}
                                                            </p>
                                                        )}
                                                </div>

                                                {isAdmin
                                                    ? (
                                                        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
                                                            {confirmingDelete
                                                                ? (
                                                                    <div
                                                                        aria-label={copy.deleteLabel(visibleSourceName)}
                                                                        className="max-w-md rounded-xl border border-rose-200 bg-rose-50 p-3"
                                                                        role="alertdialog"
                                                                    >
                                                                        <p className="text-sm font-medium text-rose-900">
                                                                            {copy.deleteConfirm(visibleSourceName)}
                                                                        </p>
                                                                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                                                                            <Button
                                                                                disabled={busy}
                                                                                onClick={() => setPendingDeleteSourceId(null)}
                                                                                size="sm"
                                                                                variant="outline"
                                                                            >
                                                                                {copy.cancelDelete}
                                                                            </Button>
                                                                            <Button
                                                                                className="bg-rose-700 text-white hover:bg-rose-800"
                                                                                disabled={busy}
                                                                                onClick={() => void handleDelete(source)}
                                                                                size="sm"
                                                                            >
                                                                                {copy.confirmDelete}
                                                                            </Button>
                                                                        </div>
                                                                    </div>
                                                                )
                                                                : (
                                                                    <>
                                                                        {source.status === "failed" || source.status === "ready"
                                                                            ? (
                                                                                <Button
                                                                                    disabled={busy}
                                                                                    onClick={() => void handleSourceAction(source.id, "retry")}
                                                                                    size="sm"
                                                                                    variant="outline"
                                                                                >
                                                                                    <RefreshCw aria-hidden="true" className="size-4" />
                                                                                    {copy.reprocess}
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
                                                                                    {copy.enable}
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
                                                                                        {copy.disable}
                                                                                    </Button>
                                                                                )
                                                                                : null}
                                                                        <Button
                                                                            aria-label={copy.deleteLabel(visibleSourceName)}
                                                                            disabled={busy || processing}
                                                                            onClick={() =>
                                                                            {
                                                                                setMessage(null);
                                                                                setPendingDeleteSourceId(source.id);
                                                                            }}
                                                                            size="icon"
                                                                            variant="ghost"
                                                                        >
                                                                            <Trash2 aria-hidden="true" className="size-4 text-rose-700" />
                                                                        </Button>
                                                                    </>
                                                                )}
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
