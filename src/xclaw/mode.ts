const XCLAW_MODE_ENV = "OPENCLAW_XCLAW_MODE";
const XCLAW_PROFILE = "xclaw";
const ONLY_CHANNELS_ENV = "OPENCLAW_ONLY_CHANNELS";
const ONLY_MODEL_PROVIDERS_ENV = "OPENCLAW_ONLY_MODEL_PROVIDERS";
const TELEGRAM_OWNER_IDS_ENV = "OPENCLAW_TELEGRAM_OWNER_IDS";
const TELEGRAM_NATIVE_COMMANDS_ENV = "OPENCLAW_TELEGRAM_NATIVE_COMMANDS";

function isTruthyValue(value?: string): boolean {
  if (!value) {return false;}
  const normalized = value.trim().toLowerCase();
  return ["true", "1", "yes", "on"].includes(normalized);
}

function parseCsvSet(raw?: string): Set<string> {
  return new Set(
    String(raw ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isXClawMode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isTruthyValue(env[XCLAW_MODE_ENV])) {
    return true;
  }
  return (env.OPENCLAW_PROFILE ?? "").trim().toLowerCase() === XCLAW_PROFILE;
}

export function resolveOnlyChannelsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> | null {
  const only = parseCsvSet(env[ONLY_CHANNELS_ENV]);
  if (only.size > 0) {
    return only;
  }
  if (isXClawMode(env)) {
    return new Set(["telegram"]);
  }
  return null;
}

export function resolveOnlyModelProvidersFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> | null {
  const only = parseCsvSet(env[ONLY_MODEL_PROVIDERS_ENV]);
  if (only.size > 0) {
    return only;
  }
  if (isXClawMode(env)) {
    return new Set(["openai", "gemini"]);
  }
  return null;
}

export function resolveTelegramOwnerIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return parseCsvSet(env[TELEGRAM_OWNER_IDS_ENV]);
}

export function resolveTelegramNativeCommandAllowlist(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> | null {
  const only = parseCsvSet(env[TELEGRAM_NATIVE_COMMANDS_ENV]);
  if (only.size > 0) {
    return only;
  }
  if (!isXClawMode(env)) {
    return null;
  }
  return new Set([
    "help",
    "commands",
    "status",
    "context",
    "whoami",
    "session",
    "usage",
    "activation",
    "send",
    "reset",
    "new",
    "think",
    "reasoning",
    "model",
    "models",
    "queue",
    "lang",
    "xexec",
    "xupdate",
    "ghissue",
  ]);
}
