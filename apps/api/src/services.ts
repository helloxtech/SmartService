import type { ExtractedKnowledgePayload } from "@smartservice/contracts";
import {
    cloudflareDnsResolver,
    type ExtractedPayloadProvider,
    type IngestionAggregate,
} from "@smartservice/ingestion";

import { authenticateAdmin, authenticateMember } from "./auth";
import { SupabaseAnalyticsService } from "./analytics-service";
import { createRagAnswerProvider } from "./answers";
import {
    createConversationFinalizer,
    createGuardrailSupervisor,
} from "./auxiliary-ai";
import { SupabaseConversationRepository } from "./conversation-repository";
import { DefaultPublicConversationService } from "./conversation-service";
import {
    CloudflareBrowserRunCrawlProvider,
    MockWebsiteCrawlProvider,
} from "./crawl";
import { createEmbeddingProvider } from "./embeddings";
import { ApiError } from "./errors";
import { SupabaseKnowledgeRepository } from "./repository";
import { SupabaseTeamRepository } from "./team-repository";
import {
    createUploadIntentProvider,
    R2KnowledgeObjectStore,
} from "./storage";
import type {
    CrawlProvider,
    RuntimeServices,
    SmartServiceBindings,
} from "./types";
import { createTurnstileVerifier } from "./turnstile";

class CompositeExtractedPayloadProvider implements ExtractedPayloadProvider
{
    /**
     * CompositeExtractedPayloadProvider
     * ----------------
     * Creates a source-aware loader that reads file payloads from R2 and URL payloads from the crawler.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public constructor(
        private readonly objects: R2KnowledgeObjectStore,
        private readonly crawl: CrawlProvider,
    )
    {
    }

    /**
     * load
     * ----------------
     * Loads validated extracted JSON for files or delegates URL sources to the configured crawl provider.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async load(aggregate: IngestionAggregate): Promise<ExtractedKnowledgePayload>
    {
        if (aggregate.sourceType === "url")
        {
            return this.crawl.load(aggregate);
        }

        if (aggregate.extractedObjectKey === null)
        {
            throw new ApiError(500, "EXTRACTED_OBJECT_MISSING", "The stored extracted object key is missing.");
        }

        return this.objects.getJson(
            aggregate.extractedObjectKey,
            aggregate.organizationId,
        ) as Promise<ExtractedKnowledgePayload>;
    }
}

/**
 * assertSafeProviderMode
 * ----------------
 * Fails closed when a production Worker is configured to use any deterministic ingestion, chat, auxiliary-AI, or Turnstile provider.
 *
 * July 26, 2026: Updated by Forrest Zhang for SmartService Day 4 Guardrails and Handoff
 */
function assertSafeProviderMode(bindings: SmartServiceBindings): void
{
    if (
        bindings.ENVIRONMENT === "production"
        && (
            bindings.INGESTION_PROVIDER_MODE !== "live"
            || bindings.CHAT_PROVIDER_MODE !== "live"
            || bindings.AUXILIARY_PROVIDER_MODE !== "live"
            || bindings.TURNSTILE_PROVIDER_MODE !== "live"
        )
    )
    {
        throw new ApiError(
            503,
            "MOCK_MODE_FORBIDDEN",
            "Deterministic providers are disabled in production.",
        );
    }
}

/**
 * createRuntimeServices
 * ----------------
 * Builds one request/queue-scoped modular-monolith graph including guarded chat, team handoff, analytics, gap resolution, and finalization.
 *
 * July 26, 2026: Updated by Forrest Zhang for SmartService Day 5 Dashboard and Knowledge Gaps
 */
export function createRuntimeServices(bindings: SmartServiceBindings): RuntimeServices
{
    assertSafeProviderMode(bindings);
    const repository = new SupabaseKnowledgeRepository(bindings);
    const conversationRepository = new SupabaseConversationRepository(bindings);
    const guardrails = createGuardrailSupervisor(bindings);
    const finalizer = createConversationFinalizer(bindings);
    const team = new SupabaseTeamRepository(bindings, conversationRepository);
    const objects = new R2KnowledgeObjectStore(bindings.KNOWLEDGE_FILES);
    const crawl = bindings.INGESTION_PROVIDER_MODE === "live"
        ? new CloudflareBrowserRunCrawlProvider(bindings, cloudflareDnsResolver)
        : new MockWebsiteCrawlProvider();

    const embeddings = createEmbeddingProvider(bindings);
    const answers = createRagAnswerProvider(bindings);

    return {
        analytics: new SupabaseAnalyticsService(bindings, {
            answers,
            conversationRepository,
            embeddings,
            guardrails,
            knowledgeRepository: repository,
            objects,
            queue: bindings.INGEST_QUEUE,
        }),
        /**
         * authenticateAdmin
         * ----------------
         * Resolves an active Admin membership using the current Worker bindings.
         *
         * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
         */
        authenticateAdmin(request: Request)
        {
            return authenticateAdmin(request, bindings);
        },

        /**
         * authenticateMember
         * ----------------
         * Resolves an active Admin or Agent membership using the current Worker bindings.
         *
         * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
         */
        authenticateMember(request: Request)
        {
            return authenticateMember(request, bindings);
        },
        crawl: new CompositeExtractedPayloadProvider(objects, crawl),
        dnsResolver: cloudflareDnsResolver,
        embeddings,
        finalizer,
        finalizeQueue: bindings.FINALIZE_QUEUE,
        guardrails,
        objects,
        publicConversations: new DefaultPublicConversationService(
            bindings,
            conversationRepository,
            embeddings,
            answers,
            guardrails,
            createTurnstileVerifier(bindings),
        ),
        queue: bindings.INGEST_QUEUE,
        repository,
        team,
        uploads: createUploadIntentProvider(bindings),
    };
}
