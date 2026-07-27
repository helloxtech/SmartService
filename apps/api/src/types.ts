import type {
    CreatePublicConversationRequest,
    CreatePublicConversationResponse,
    ClaimConversationResponse,
    ConversationFinalizeMessage,
    ConversationFinalization,
    CreateGuardrailRuleRequest,
    FileUploadIntentRequest,
    FileUploadIntentResponse,
    GuardrailEvent,
    GuardrailRule,
    KnowledgeIngestMessage,
    KnowledgeSource,
    PublicMessageListResponse,
    RequestPublicHandoffResponse,
    SendHumanMessageResponse,
    SendPublicMessageRequest,
    SendPublicMessageResponse,
    SourceAction,
    TeamConversationDetail,
    TeamInboxItem,
    UpdateGuardrailRuleRequest,
} from "@smartservice/contracts";
import type {
    ConversationFinalizer,
    GuardrailSupervisor,
} from "@smartservice/assistant-core";
import type {
    DnsResolver,
    EmbeddingProvider,
    ExtractedPayloadProvider,
    IngestionRepository,
} from "@smartservice/ingestion";

export type SmartServiceBindings = Omit<
    Env,
    | "CHAT_PROVIDER_MODE"
    | "AUXILIARY_PROVIDER_MODE"
    | "ENVIRONMENT"
    | "FINALIZE_QUEUE"
    | "INGESTION_PROVIDER_MODE"
    | "INGEST_QUEUE"
    | "TURNSTILE_PROVIDER_MODE"
    | "VERSION"
> & {
    ALLOWED_ORIGINS?: string;
    AUXILIARY_PROVIDER_MODE?: "live" | "mock";
    CLOUDFLARE_ACCOUNT_ID?: string;
    CLOUDFLARE_BROWSER_RUN_API_TOKEN?: string;
    CHAT_PROVIDER_MODE?: "live" | "mock";
    CONVERSATION_TOKEN_SECRET?: string;
    CONVERSATION_TOKEN_TTL_MINUTES?: string;
    ENVIRONMENT: string;
    FINALIZE_QUEUE: Queue<ConversationFinalizeMessage>;
    INGESTION_PROVIDER_MODE?: "live" | "mock";
    INGEST_QUEUE: Queue<KnowledgeIngestMessage>;
    KNOWLEDGE_FILES: R2Bucket;
    LOCAL_UPLOAD_SIGNING_SECRET?: string;
    OPENAI_API_KEY?: string;
    OPENAI_CHAT_MODEL?: string;
    OPENAI_EMBEDDING_DIMENSIONS?: string;
    OPENAI_EMBEDDING_MODEL?: string;
    OPENAI_SUPERVISOR_MODEL?: string;
    R2_ACCESS_KEY_ID?: string;
    R2_BUCKET_NAME?: string;
    R2_S3_ENDPOINT?: string;
    R2_SECRET_ACCESS_KEY?: string;
    RAG_MATCH_THRESHOLD?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
    SUPABASE_URL?: string;
    TURNSTILE_EXPECTED_HOSTNAME?: string;
    TURNSTILE_PROVIDER_MODE?: "live" | "mock";
    TURNSTILE_SECRET_KEY?: string;
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
    finalizer: ConversationFinalizer;
    finalizeQueue: Queue<ConversationFinalizeMessage>;
    guardrails: GuardrailSupervisor;
    objects: KnowledgeObjectStore;
    publicConversations: PublicConversationService;
    queue: Queue<KnowledgeIngestMessage>;
    repository: KnowledgeRepository;
    team: TeamService;
    uploads: UploadIntentProvider;
}

export interface TeamService
{
    claim(
        identity: MemberIdentity,
        conversationId: string,
        requestId: string,
    ): Promise<ClaimConversationResponse>;
    close(
        identity: MemberIdentity,
        conversationId: string,
        requestId: string,
    ): Promise<{ created: boolean; language: "zh-CN" | "en" }>;
    completeFinalization(
        aggregate: {
            alreadyFinalized: boolean;
            conversationId: string;
            language: "zh-CN" | "en";
            messages: Array<{
                id: string;
                senderType: "customer" | "ai" | "human" | "system";
                text: string;
            }>;
            organizationId: string;
        },
        finalization: ConversationFinalization,
        provider: string,
        model: string,
        inputTokens: number | null,
        outputTokens: number | null,
        latencyMs: number,
        requestId: string,
    ): Promise<void>;
    getConversation(
        organizationId: string,
        conversationId: string,
    ): Promise<TeamConversationDetail | null>;
    getGuardrailCandidate(
        identity: AdminIdentity,
        eventId: string,
    ): Promise<{ blockedCandidate: string | null; eventId: string }>;
    listGuardrailEvents(
        organizationId: string,
        conversationId?: string,
    ): Promise<GuardrailEvent[]>;
    listInbox(
        organizationId: string,
        includeClosed?: boolean,
    ): Promise<TeamInboxItem[]>;
    listRules(organizationId: string): Promise<GuardrailRule[]>;
    loadFinalizationAggregate(
        organizationId: string,
        conversationId: string,
    ): Promise<{
        alreadyFinalized: boolean;
        conversationId: string;
        language: "zh-CN" | "en";
        messages: Array<{
            id: string;
            senderType: "customer" | "ai" | "human" | "system";
            text: string;
        }>;
        organizationId: string;
    }>;
    manageRule(
        identity: AdminIdentity,
        ruleId: string | null,
        input: CreateGuardrailRuleRequest | UpdateGuardrailRuleRequest,
        requestId: string,
    ): Promise<GuardrailRule>;
    markFinalizationQueued(
        organizationId: string,
        conversationId: string,
    ): Promise<void>;
    sendHumanMessage(
        identity: MemberIdentity,
        conversationId: string,
        clientMessageId: string,
        text: string,
        requestId: string,
    ): Promise<SendHumanMessageResponse>;
}

export interface PublicConversationService
{
    create(
        input: CreatePublicConversationRequest,
        idempotencyKey: string,
        remoteIp: string | null,
        requestId: string,
    ): Promise<CreatePublicConversationResponse>;
    list(
        request: Request,
        conversationId: string,
        after: string | null,
        limit: number,
    ): Promise<PublicMessageListResponse>;
    requestHandoff(
        request: Request,
        conversationId: string,
        idempotencyKey: string,
        requestId: string,
        remoteIp: string | null,
    ): Promise<RequestPublicHandoffResponse>;
    send(
        request: Request,
        conversationId: string,
        input: SendPublicMessageRequest,
        requestId: string,
        remoteIp: string | null,
    ): Promise<SendPublicMessageResponse>;
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
