import { knowledgeLimits } from "./limits";

const cjkCharacterPattern = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/gu;
const englishWordPattern = /[\p{Script=Latin}\p{N}]+(?:['’-][\p{Script=Latin}\p{N}]+)*/gu;

/**
 * countCjkCharacters
 * ----------------
 * Counts CJK characters for the configured standard-page capacity calculation.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export function countCjkCharacters(text: string): number
{
    return text.match(cjkCharacterPattern)?.length ?? 0;
}

/**
 * countEnglishWords
 * ----------------
 * Counts Latin-script words and numeric terms while excluding CJK characters.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export function countEnglishWords(text: string): number
{
    return text.match(englishWordPattern)?.length ?? 0;
}

/**
 * calculateStandardPages
 * ----------------
 * Calculates mixed-language capacity units using 800 CJK characters or 500 English words per standard page.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export function calculateStandardPages(text: string): number
{
    const cjkPages = countCjkCharacters(text) / knowledgeLimits.standardPageCjkCharacters;
    const englishPages = countEnglishWords(text) / knowledgeLimits.standardPageEnglishWords;
    const calculated = cjkPages + englishPages;

    if (calculated === 0 && text.trim().length > 0)
    {
        return 0.01;
    }

    return Math.round(calculated * 100) / 100;
}

/**
 * estimateTokenCount
 * ----------------
 * Produces a conservative tokenizer-free estimate for bounded chunk construction across Chinese and English text.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export function estimateTokenCount(text: string): number
{
    const cjkCount = countCjkCharacters(text);
    const englishWordCount = countEnglishWords(text);
    const residualCharacters = text
        .replace(cjkCharacterPattern, "")
        .replace(englishWordPattern, "")
        .replace(/\s/gu, "")
        .length;

    return Math.max(1, Math.ceil(cjkCount + englishWordCount * 1.35 + residualCharacters / 3));
}
