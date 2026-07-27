import type {
    FileUploadIntentRequest,
    FileUploadIntentResponse,
    KnowledgeIngestMessage,
    KnowledgeSource,
    SourceAction,
} from "@smartservice/contracts";
import type {
    DnsResolver,
    EmbeddingProvider,
    ExtractedPayloadProvider,
    IngestionRepository,
} from "@smartservice/ingestion";

export type SmartServiceBindings = Omit<
    Env,
    "ENVIRONMENT" | "INGESTION_PROVIDER_MODE" | "INGEST_QUEUE" | "VERSION"
> & {
    ALLOWED_ORIGINS?: string;
    CLOUDFLARE_ACCOUNT_ID?: string;
    CLOUDFLARE_BROWSER_RUN_API_TOKEN?: string;
    ENVIRONMENT: string;
    INGESTION_PROVIDER_MODE?: "live" | "mock";
    INGEST_QUEUE: Queue<KnowledgeIngestMessage>;
    KNOWLEDGE_FILES: R2Bucket;
    LOCAL_UPLOAD_SIGNING_SECRET?: string;
    OPENAI_API_KEY?: string;
    OPENAI_EMBEDDING_DIMENSIONS?: string;
    OPENAI_EMBEDDING_MODEL?: string;
    R2_ACCESS_KEY_ID?: string;
    R2_BUCKET_NAME?: string;
    R2_S3_ENDPOINT?: string;
    R2_SECRET_ACCESS_KEY?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
    SUPABASE_URL?: string;
    VERSION: string;
};

export interface AdminIdentity
{
    organizationId: string;
    role: "admin";
    userId: string;
}

export interface MemberIdentity
{
    organizationId: string;
    role: "admin" | "agent";
    userId: string;
}

export interface UploadObjectExpectation
{
    contentType: string;
    kind: "extracted" | "original";
    maxSizeBytes?: number;
    organizationId: string;
    sizeBytes?: number;
}

export interface VerifiedUploadObject
{
    body: ArrayBuffer;
    contentSha256: string;
    contentType: string;
    sizeBytes: number;
}

export interface KnowledgeObjectStore
{
    delete(key: string): Promise<void>;
    getJson(key: string, organizationId: string): Promise<unknown>;
    putMockUpload(
        key: string,
        body: ArrayBuffer,
        contentType: string,
        contentSha256: string,
        kind: "extracted" | "original",
    ): Promise<void>;
    verify(key: string, expectation: UploadObjectExpectation): Promise<VerifiedUploadObject>;
}

export interface UploadIntentProvider
{
    create(
        identity: AdminIdentity,
        input: FileUploadIntentRequest,
        requestUrl: string,
    ): Promise<FileUploadIntentResponse>;
    verifyMockRequest?(request: Request): Promise<{
        contentSha256: string;
        contentType: string;
        key: string;
        kind: "extracted" | "original";
        sizeBytes: number;
    }>;
}

export interface IntakeRecord
{
    jobId: string;
    sourceId: string;
    status: "uploaded" | "extracting" | "chunking" | "embedding" | "ready" | "failed";
}

export interface CreateIntakeInput
{
    crawlMaxDepth: number | null;
    crawlMaxPages: number | null;
    createdBy: string;
    extractedObjectKey: string | null;
    idempotencyKey: string;
    name: string;
    organizationId: string;
    originalObjectKey: string | null;
    pageCount: number | null;
    requestId: string;
    sourceType: "pdf" | "docx" | "url";
    sourceUrl: string | null;
    standardPageCount: number | null;
}

export interface KnowledgeRepository extends IngestionRepository
{
    createIntake(input: CreateIntakeInput): Promise<IntakeRecord>;
    getSource(organizationId: string, sourceId: string): Promise<KnowledgeSource | null>;
    listSources(organizationId: string): Promise<KnowledgeSource[]>;
    manageSource(
        identity: AdminIdentity,
        sourceId: string,
        action: Exclude<SourceAction, "retry"> | "delete",
        requestId: string,
    ): Promise<{ extractedObjectKey: string | null; originalObjectKey: string | null }>;
    retry(
        identity: AdminIdentity,
        sourceId: string,
        idempotencyKey: string,
        requestId: string,
    ): Promise<IntakeRecord>;
}

export type CrawlProvider = ExtractedPayloadProvider;

export interface RuntimeServices
{
    authenticateAdmin(request: Request): Promise<AdminIdentity>;
    authenticateMember(request: Request): Promise<MemberIdentity>;
    crawl: CrawlProvider;
    dnsResolver: DnsResolver;
    embeddings: EmbeddingProvider;
    objects: KnowledgeObjectStore;
    queue: Queue<KnowledgeIngestMessage>;
    repository: KnowledgeRepository;
    uploads: UploadIntentProvider;
}

export type RuntimeServiceFactory = (bindings: SmartServiceBindings) => RuntimeServices;

export interface AppVariables
{
    requestId: string;
}

export type AppEnvironment = {
    Bindings: SmartServiceBindings;
    Variables: AppVariables;
};
