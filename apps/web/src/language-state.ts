export type UiLanguage = "en" | "zh-CN";

const languageStorageKey = "smartservice.uiLanguage.v1";

/**
 * isUiLanguage
 * ----------------
 * Checks whether an untrusted stored value is one of the supported SmartService UI languages.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService Language Switch
 */
function isUiLanguage(value: unknown): value is UiLanguage
{
    return value === "en" || value === "zh-CN";
}

/**
 * readInitialUiLanguage
 * ----------------
 * Selects the initial UI language from local preference, then browser language, while defaulting safely to English.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService Language Switch
 */
export function readInitialUiLanguage(): UiLanguage
{
    try
    {
        const stored = globalThis.localStorage?.getItem(languageStorageKey);

        if (isUiLanguage(stored))
        {
            return stored;
        }
    }
    catch
    {
        // Storage may be unavailable in privacy or test contexts; browser language remains a safe fallback.
    }

    return globalThis.navigator?.language?.toLowerCase().startsWith("zh") === true
        ? "zh-CN"
        : "en";
}

/**
 * writeUiLanguage
 * ----------------
 * Persists the selected UI language locally without sending it to the server.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService Language Switch
 */
export function writeUiLanguage(language: UiLanguage): void
{
    try
    {
        globalThis.localStorage?.setItem(languageStorageKey, language);
    }
    catch
    {
        // Losing this preference is non-fatal; the UI still updates for the current render.
    }
}
