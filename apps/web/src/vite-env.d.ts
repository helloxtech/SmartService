/// <reference types="vite/client" />

interface ImportMetaEnv
{
    readonly VITE_API_BASE_URL?: string;
    readonly VITE_DEMO_PUBLIC_KEY?: string;
    readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta
{
    readonly env: ImportMetaEnv;
}

interface TurnstileRenderOptions
{
    action: string;
    callback: (token: string) => void;
    "error-callback": () => void;
    sitekey: string;
    size: "flexible";
    theme: "light";
}

interface Window
{
    turnstile?: {
        remove(widgetId: string): void;
        render(container: HTMLElement, options: TurnstileRenderOptions): string;
    };
}
