import { defineAgent } from "eve";

export default defineAgent({
  model: "zai/glm-5.2",
  reasoning: "none",
  modelOptions: {
    providerOptions: {
      gateway: {
        only: ["blackbox"],
      },
    },
  },
  limits: {
    maxInputTokensPerSession: 2_000_000,
    maxOutputTokensPerSession: 128_000,
    sessionTimeoutMs: 2 * 60 * 60 * 1000,
  },
});
