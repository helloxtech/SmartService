import { type JSX } from "react";

import type { UiLanguage } from "./language-state";

export type { UiLanguage } from "./language-state";

const languageLabels: Record<UiLanguage, {
    english: string;
    language: string;
    zh: string;
}> = {
    en: {
        english: "English",
        language: "Language",
        zh: "Chinese",
    },
    "zh-CN": {
        english: "英文",
        language: "语言",
        zh: "中文",
    },
};

/**
 * LanguageSwitch
 * ----------------
 * Renders a compact language toggle that changes visible UI copy without mixing English and Chinese content.
 *
 * July 30, 2026: Created by Forrest Zhang for SmartService Language Switch
 */
export function LanguageSwitch({
    language,
    onLanguageChange,
}: {
    language: UiLanguage;
    onLanguageChange: (language: UiLanguage) => void;
}): JSX.Element
{
    const labels = languageLabels[language];

    return (
        <div
            aria-label={labels.language}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 text-xs font-semibold text-slate-600 shadow-sm"
            role="group"
        >
            <span className="px-2 text-slate-500">{labels.language}</span>
            <button
                aria-pressed={language === "en"}
                className={language === "en"
                    ? "rounded-full bg-slate-900 px-3 py-1.5 text-white"
                    : "rounded-full px-3 py-1.5 hover:bg-slate-100"}
                onClick={() => onLanguageChange("en")}
                type="button"
            >
                {labels.english}
            </button>
            <button
                aria-pressed={language === "zh-CN"}
                className={language === "zh-CN"
                    ? "rounded-full bg-slate-900 px-3 py-1.5 text-white"
                    : "rounded-full px-3 py-1.5 hover:bg-slate-100"}
                onClick={() => onLanguageChange("zh-CN")}
                type="button"
            >
                {labels.zh}
            </button>
        </div>
    );
}
