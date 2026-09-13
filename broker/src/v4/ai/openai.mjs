import { ResponsesArtBrokerProvider } from "./openai-compatible.mjs";
import { managedProviderEndpoint } from "./gateway.mjs";

export class OpenAIArtBrokerProvider extends ResponsesArtBrokerProvider {
  constructor(options = {}) {
    const environment = options.environment ?? process.env;
    const endpoint = managedProviderEndpoint({ environment, baseVariable: "OPENAI_BASE_URL",
      directOrigin: "https://api.openai.com", path: "/v1/responses" });
    const url = new URL(endpoint);
    super({ ...options, environment, provider: "OPENAI", secretName: "OPENAI_API_KEY",
      endpoint: options.endpoint ?? endpoint, expectedOrigin: url.origin, expectedPath: url.pathname });
  }
}
