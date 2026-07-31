/**
 * normalizeVisibleDemoBrand
 * ----------------
 * Rewrites retired demo brand names before rendering user-visible UI, including lowercase fixture filenames from older hosted seeds.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService branding cleanup
 */
export function normalizeVisibleDemoBrand(value: string): string
{
    return value.replace(/novaflow|xflow/giu, (match) =>
    {
        return match === match.toLowerCase() ? "smart-service" : "Smart Service";
    });
}
