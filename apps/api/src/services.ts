import type { ExtractedKnowledgePayload } from "@smartservice/contracts";
import {
    cloudflareDnsResolver,
    type ExtractedPayloadProvider,
    type IngestionAggregate,
} from "@smartservice/ingestion";

import { authenticateAdmin, authenticateMember } from "./auth";
import { createRagAnswerProvider } from "./answers";
import { SupabaseConversationRepository } from "./conversation-repository";
import { DefaultPublicConversationService } from "./conversation-service";
import {
    CloudflareBrowserRunCrawlProvider,
    MockWebsiteCrawlProvider,
} from "./crawl";
import { createEmbeddingProvider } from "./embeddings";
import { ApiError } from "./errors";
import { SupabaseKnowledgeRepository } from "./repository";
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
 * Fails closed when a production Worker is configured to use any deterministic ingestion, chat, or Turnstile provider.
 *
 * July 26, 2026: Updated by Forrest Zhang for SmartService Day 3 Grounded Text Chat
 */
function assertSafeProviderMode(bindings: SmartServiceBindings): void
{
    if (
        bindings.ENVIRONMENT === "production"
        && (
            bindings.INGESTION_PROVIDER_MODE !== "live"
            || bindings.CHAT_PROVIDER_MODE !== "live"
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
 * Builds one request/queue-scoped modular-monolith service graph, including the public grounded-chat path, from explicit Worker bindings.
 *
 * July 26, 2026: Updated by Forrest Zhang for SmartService Day 3 Grounded Text Chat
 */
export function createRuntimeServices(bindings: SmartServiceBindings): RuntimeServices
{
    assertSafeProviderMode(bindings);
    const repository = new SupabaseKnowledgeRepository(bindings);
    const conversationRepository = new SupabaseConversationRepository(bindings);
    const objects = new R2KnowledgeObjectStore(bindings.KNOWLEDGE_FILES);
    const crawl = bindings.INGESTION_PROVIDER_MODE === "live"
        ? new CloudflareBrowserRunCrawlProvider(bindings, cloudflareDnsResolver)
        : new MockWebsiteCrawlProvider();

    const embeddings = createEmbeddingProvider(bindings);

    return {
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
        objects,
        publicConversations: new DefaultPublicConversationService(
            bindings,
            conversationRepository,
            embeddings,
            createRagAnswerProvider(bindings),
            createTurnstileVerifier(bindings),
        ),
        queue: bindings.INGEST_QUEUE,
        repository,
        uploads: createUploadIntentProvider(bindings),
    };
}
