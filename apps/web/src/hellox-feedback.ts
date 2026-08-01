import { z } from "zod";

import { getSupabaseClient } from "./lib/supabase";

type FeedbackLocale = "en" | "zh-Hans";

interface HelloXFeedbackWidgetConfig
{
    allowAnonymous: boolean;
    allowAttachments: boolean;
    anonymousAttachmentMaxBytes: number;
    applicationName: string;
    applicationVersion: string;
    authenticatedAttachmentMaxBytes: number;
    defaultAnonymous: boolean;
    endpoint: string;
    getIdentitySession(): Promise<string | undefined>;
    installationKey: string;
    locale: FeedbackLocale;
    redactSelectors: string[];
    showPanelDescription: boolean;
    showPrivacyNotice: boolean;
    turnstileSiteKey: string;
}

interface HelloXFeedbackModule
{
    configureHelloXFeedback(
        element: HTMLElement,
        configuration: HelloXFeedbackWidgetConfig,
    ): HTMLElement;
    defineHelloXFeedback(): CustomElementConstructor | undefined;
}

const runtimeFeedbackConfigurationSchema = z.object({
    feedbackInstallationKey: z.string().regex(/^hxf_live_[0-9a-f]{48}$/).nullable(),
    feedbackTurnstileSiteKey: z.string().min(10).nullable(),
});

const feedbackIdentitySessionSchema = z.object({
    expiresAt: z.iso.datetime(),
    token: z.string().regex(/^hxf_session_[0-9a-f]{64}$/),
});

/**
 * fetchFeedbackConfiguration
 * ----------------
 * Loads and validates only the browser-safe HelloX installation and Turnstile keys from the same-origin Worker.
 *
 * August 01, 2026: Created by Forrest Zhang for HelloX Feedback
 */
async function fetchFeedbackConfiguration(): Promise<z.infer<typeof runtimeFeedbackConfigurationSchema> | null>
{
    try
    {
        const response = await fetch("/api/public-config", {
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok)
        {
            return null;
        }

        return runtimeFeedbackConfigurationSchema.parse(await response.json());
    }
    catch
    {
        return null;
    }
}

/**
 * getFeedbackIdentitySession
 * ----------------
 * Uses the current Supabase bearer session to request one short-lived HelloX identity token from SmartService's same-origin backend.
 *
 * August 01, 2026: Created by Forrest Zhang for HelloX Feedback
 */
async function getFeedbackIdentitySession(): Promise<string | undefined>
{
    const client = await getSupabaseClient();

    if (client === null)
    {
        throw new Error("Verified feedback identity is unavailable.");
    }

    const { data, error } = await client.auth.getSession();
    const accessToken = data.session?.access_token;

    if (error !== null || accessToken === undefined || accessToken.length === 0)
    {
        throw new Error("Sign in before sending identified feedback.");
    }

    const response = await fetch("/api/hellox-feedback/session", {
        body: "{}",
        credentials: "same-origin",
        headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
        },
        method: "POST",
        signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok)
    {
        throw new Error("Verified feedback identity could not be issued.");
    }

    return feedbackIdentitySessionSchema.parse(await response.json()).token;
}

/**
 * resolveFeedbackLocale
 * ----------------
 * Maps the host document language to one of the widget's supported presentation locales.
 *
 * August 01, 2026: Created by Forrest Zhang for HelloX Feedback
 */
function resolveFeedbackLocale(): FeedbackLocale
{
    return document.documentElement.lang.toLowerCase().startsWith("zh")
        ? "zh-Hans"
        : "en";
}

/**
 * shouldDefaultToAnonymousFeedback
 * ----------------
 * Defaults the intentionally public customer chat and voice routes to anonymous reporting while leaving the team workspace identified.
 *
 * August 01, 2026: Created by Forrest Zhang for HelloX Feedback
 */
function shouldDefaultToAnonymousFeedback(): boolean
{
    return window.location.pathname.startsWith("/chat")
        || window.location.pathname.startsWith("/voice");
}

/**
 * installHelloXFeedback
 * ----------------
 * Loads the pinned vendored widget, configures both anonymous and authenticated intake, and mounts one global Feedback element.
 *
 * August 01, 2026: Created by Forrest Zhang for HelloX Feedback
 */
export async function installHelloXFeedback(): Promise<void>
{
    try
    {
        if (document.querySelector("hellox-feedback") !== null)
        {
            return;
        }

        const configuration = await fetchFeedbackConfiguration();

        if (
            configuration?.feedbackInstallationKey === null
            || configuration?.feedbackInstallationKey === undefined
            || configuration.feedbackTurnstileSiteKey === null
        )
        {
            return;
        }

        const widgetModuleUrl = "/vendor/hellox-feedback/widget.js";
        const widgetModule = await import(
            /* @vite-ignore */ widgetModuleUrl
        ) as unknown as HelloXFeedbackModule;

        if (
            typeof widgetModule.defineHelloXFeedback !== "function"
            || typeof widgetModule.configureHelloXFeedback !== "function"
        )
        {
            throw new Error("HelloX Feedback widget exports are unavailable.");
        }

        widgetModule.defineHelloXFeedback();

        if (document.querySelector("hellox-feedback") !== null)
        {
            return;
        }

        const element = document.createElement("hellox-feedback");
        widgetModule.configureHelloXFeedback(element, {
            allowAnonymous: true,
            allowAttachments: true,
            anonymousAttachmentMaxBytes: 0,
            applicationName: "SmartService",
            applicationVersion: "0.10.0",
            authenticatedAttachmentMaxBytes: 10 * 1024 * 1024,
            defaultAnonymous: shouldDefaultToAnonymousFeedback(),
            endpoint: "https://delivery.hellox.ca/api/feedback/v1/submissions",
            getIdentitySession: getFeedbackIdentitySession,
            installationKey: configuration.feedbackInstallationKey,
            locale: resolveFeedbackLocale(),
            redactSelectors: [
                "[data-feedback-private]",
                "[data-feedback-sensitive]",
                "input[type='email']",
                "input[type='password']",
                "input[autocomplete='cc-number']",
                "input[autocomplete='current-password']",
            ],
            showPanelDescription: true,
            showPrivacyNotice: true,
            turnstileSiteKey: configuration.feedbackTurnstileSiteKey,
        });
        document.body.appendChild(element);
    }
    catch
    {
        console.error(JSON.stringify({
            event: "hellox.feedback.startup_failed",
        }));
    }
}
