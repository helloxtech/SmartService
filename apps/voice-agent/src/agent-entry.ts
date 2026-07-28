import { createVoiceAgent } from "./agent";
import {
    loadLocalEnvironment,
    readVoiceAgentConfiguration,
} from "./config";

loadLocalEnvironment();

const configuration = readVoiceAgentConfiguration();

export default createVoiceAgent(configuration);
