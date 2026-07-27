import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * cn
 * ----------------
 * Combines conditional class names and resolves conflicting Tailwind utility classes.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
export function cn(...inputs: readonly ClassValue[]): string
{
    return twMerge(clsx(inputs));
}
