import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

const voiceAgentConfigurationSchema = z.object({
    DEEPGRAM_API_KEY: z.string().min(1),
    DEEPGRAM_STT_LANGUAGE: z.enum(["zh-CN", "en"]).default("zh-CN"),
    DEEPGRAM_STT_MODEL: z.literal("nova-3").default("nova-3"),
    ELEVENLABS_API_KEY: z.string().min(1),
    ELEVENLABS_MODEL_ID: z.literal("eleven_flash_v2_5").default("eleven_flash_v2_5"),
    ELEVENLABS_VOICE_ID: z.string().min(1),
    LIVEKIT_AGENT_NAME: z.string().min(1).max(120).default("smartservice-voice-agent"),
    LIVEKIT_API_KEY: z.string().min(1),
    LIVEKIT_API_SECRET: z.string().min(1),
    LIVEKIT_URL: z.string().url(),
    VOICE_INTERNAL_API_BASE_URL: z.string().url(),
    VOICE_INTERNAL_SERVICE_TOKEN: z.string().min(32),
});

export type VoiceAgentConfiguration = z.infer<typeof voiceAgentConfigurationSchema>;

/**
 * loadLocalEnvironment
 * ----------------
 * Loads the ignored repository-root environment file for local Agent commands while leaving deployed environment injection authoritative.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
export function loadLocalEnvironment(): void
{
    const environmentPath = resolve(import.meta.dirname, "../../../.env.local");

    if (existsSync(environmentPath))
    {
        process.loadEnvFile(environmentPath);
    }
}

/**
 * readVoiceAgentConfiguration
 * ----------------
 * Validates required server-only Agent, Deepgram, LiveKit, and internal API settings without printing their values.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
export function readVoiceAgentConfiguration(
    environment: NodeJS.ProcessEnv = process.env,
): VoiceAgentConfiguration
{
    return voiceAgentConfigurationSchema.parse(environment);
}
