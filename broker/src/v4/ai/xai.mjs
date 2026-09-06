import { ResponsesArtBrokerProvider } from "./openai-compatible.mjs";

export class XAIArtBrokerProvider extends ResponsesArtBrokerProvider {
  constructor(options) {
    super({ provider: "XAI", secretName: "XAI_API_KEY",
      endpoint: "https://api.x.ai/v1/responses", expectedOrigin: "https://api.x.ai",
      ...options });
  }
}
