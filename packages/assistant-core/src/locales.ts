export const supportedLocales = ["zh-CN", "en"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

/**
 * isSupportedLocale
 * ----------------
 * Narrows an untrusted locale string to one of the two languages approved for the demonstration.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
export function isSupportedLocale(value: string): value is SupportedLocale
{
    return supportedLocales.some((locale) => locale === value);
}
