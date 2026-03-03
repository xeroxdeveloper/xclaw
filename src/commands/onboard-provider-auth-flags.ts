import type { AuthChoice, OnboardOptions } from "./onboard-types.js";

type OnboardProviderAuthOptionKey = keyof Pick<
  OnboardOptions,
  | "openaiApiKey"
  | "geminiApiKey"
>;

export type OnboardProviderAuthFlag = {
  optionKey: OnboardProviderAuthOptionKey;
  authChoice: AuthChoice;
  cliFlag: `--${string}`;
  cliOption: `--${string} <key>`;
  description: string;
};

// Shared source for provider API-key flags used by CLI registration + non-interactive inference.
// XClaw: Only OpenAI and Gemini are supported.
export const ONBOARD_PROVIDER_AUTH_FLAGS: ReadonlyArray<OnboardProviderAuthFlag> = [
  {
    optionKey: "openaiApiKey",
    authChoice: "openai-api-key",
    cliFlag: "--openai-api-key",
    cliOption: "--openai-api-key <key>",
    description: "API ключ OpenAI",
  },
  {
    optionKey: "geminiApiKey",
    authChoice: "gemini-api-key",
    cliFlag: "--gemini-api-key",
    cliOption: "--gemini-api-key <key>",
    description: "API ключ Gemini",
  },
];
