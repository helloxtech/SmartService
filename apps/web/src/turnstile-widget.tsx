import {
    useEffect,
    useRef,
    type JSX,
} from "react";

import type { UiLanguage } from "./language";

export interface TurnstileWidgetProps
{
    language: UiLanguage;
    onToken: (token: string) => void;
}

const turnstileCopy: Record<UiLanguage, {
    ready: string;
}> = {
    en: {
        ready: "Local demo verification is ready.",
    },
    "zh-CN": {
        ready: "本地演示验证已就绪。",
    },
};

/**
 * loadTurnstileScript
 * ----------------
 * Loads Cloudflare's explicit-render Turnstile script once when a live site key is configured.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Chat Security
 */
function loadTurnstileScript(): Promise<void>
{
    if (window.turnstile !== undefined)
    {
        return Promise.resolve();
    }

    const existing = document.querySelector<HTMLScriptElement>(
        "script[data-smartservice-turnstile]",
    );

    if (existing !== null)
    {
        return new Promise((resolve, reject) =>
        {
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error("Turnstile could not load.")), {
                once: true,
            });
        });
    }

    return new Promise((resolve, reject) =>
    {
        const script = document.createElement("script");
        script.async = true;
        script.defer = true;
        script.dataset.smartserviceTurnstile = "true";
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.addEventListener("load", () => resolve(), { once: true });
        script.addEventListener("error", () => reject(new Error("Turnstile could not load.")), {
            once: true,
        });
        document.head.append(script);
    });
}

/**
 * TurnstileWidget
 * ----------------
 * Renders live Turnstile verification or supplies the explicit local-only fixture token when no site key is configured.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Customer Chat Security
 */
export function TurnstileWidget({
    language,
    onToken,
}: TurnstileWidgetProps): JSX.Element
{
    const container = useRef<HTMLDivElement>(null);
    const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
    const copy = turnstileCopy[language];

    useEffect(() =>
    {
        if (siteKey === undefined || siteKey.length === 0)
        {
            onToken("local-demo-turnstile");
            return;
        }

        let active = true;
        let widgetId: string | undefined;

        loadTurnstileScript()
            .then(() =>
            {
                if (!active || container.current === null || window.turnstile === undefined)
                {
                    return;
                }

                widgetId = window.turnstile.render(container.current, {
                    action: "smartservice_chat",
                    callback: onToken,
                    "error-callback": () => onToken(""),
                    sitekey: siteKey,
                    size: "flexible",
                    theme: "light",
                });
            })
            .catch(() =>
            {
                if (active)
                {
                    onToken("");
                }
            });

        return () =>
        {
            active = false;

            if (widgetId !== undefined)
            {
                window.turnstile?.remove(widgetId);
            }
        };
    }, [onToken, siteKey]);

    if (siteKey === undefined || siteKey.length === 0)
    {
        return (
            <p className="text-xs text-slate-500">
                {copy.ready}
            </p>
        );
    }

    return <div className="min-h-16" ref={container} />;
}
