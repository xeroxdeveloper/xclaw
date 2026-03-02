import { afterEach, describe, expect, it } from "vitest";
import { validateConfigObjectRaw } from "./validation.js";

const previousMode = process.env.OPENCLAW_XCLAW_MODE;
const previousChannels = process.env.OPENCLAW_ONLY_CHANNELS;
const previousProviders = process.env.OPENCLAW_ONLY_MODEL_PROVIDERS;

describe("xclaw config validation restrictions", () => {
  afterEach(() => {
    if (typeof previousMode === "string") {
      process.env.OPENCLAW_XCLAW_MODE = previousMode;
    } else {
      delete process.env.OPENCLAW_XCLAW_MODE;
    }
    if (typeof previousChannels === "string") {
      process.env.OPENCLAW_ONLY_CHANNELS = previousChannels;
    } else {
      delete process.env.OPENCLAW_ONLY_CHANNELS;
    }
    if (typeof previousProviders === "string") {
      process.env.OPENCLAW_ONLY_MODEL_PROVIDERS = previousProviders;
    } else {
      delete process.env.OPENCLAW_ONLY_MODEL_PROVIDERS;
    }
  });

  it("rejects non-telegram channels in xclaw mode", () => {
    process.env.OPENCLAW_XCLAW_MODE = "1";
    process.env.OPENCLAW_ONLY_CHANNELS = "telegram";

    const result = validateConfigObjectRaw({
      channels: {
        telegram: { enabled: true },
        discord: { enabled: true },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.path === "channels.discord")).toBe(true);
  });

  it("rejects non-openai/gemini model providers in xclaw mode", () => {
    process.env.OPENCLAW_XCLAW_MODE = "1";
    process.env.OPENCLAW_ONLY_MODEL_PROVIDERS = "openai,gemini";

    const result = validateConfigObjectRaw({
      models: {
        providers: {
          anthropic: {
            baseUrl: "https://api.anthropic.com/v1",
            api: "anthropic-messages",
            apiKey: "test",
            models: [
              {
                id: "claude-test",
                name: "Claude Test",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 1000,
                maxTokens: 1000,
              },
            ],
          },
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some((issue) => issue.path === "models.providers.anthropic")).toBe(true);
  });
});
