import { ResponsesArtBrokerProvider } from "./openai-compatible.mjs";

export class OpenAIArtBrokerProvider extends ResponsesArtBrokerProvider {
  constructor(options) {
    super({ provider: "OPENAI", secretName: "OPENAI_API_KEY",
      endpoint: "https://api.openai.com/v1/responses", expectedOrigin: "https://api.openai.com",
      ...options });
  }
}
