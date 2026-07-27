import {
    cli,
    ServerOptions,
} from "@livekit/agents";
import { fileURLToPath } from "node:url";

import { createVoiceAgent } from "./agent";
import {
    loadLocalEnvironment,
    readVoiceAgentConfiguration,
} from "./config";

/**
 * main
 * ----------------
 * Loads ignored local settings when present and starts the named LiveKit Agent worker with validated configuration.
 *
 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Voice Foundation
 */
function main(): void
{
    loadLocalEnvironment();
    const configuration = readVoiceAgentConfiguration();

    cli.runApp(new ServerOptions({
        agent: fileURLToPath(import.meta.url),
        agentName: configuration.LIVEKIT_AGENT_NAME,
    }));
}

main();

export default createVoiceAgent;
