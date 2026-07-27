import { z } from "zod";

const voiceJobMetadataSchema = z.object({
    voiceSessionId: z.uuid(),
});

/**
 * readVoiceSessionId
 * ----------------
 * Parses the ID-only Agent dispatch metadata and rejects any untrusted or expanded job payload.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
export function readVoiceSessionId(metadata: string): string
{
    const parsed: unknown = JSON.parse(metadata);
    return voiceJobMetadataSchema.parse(parsed).voiceSessionId;
}
