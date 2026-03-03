/**
 * XClaw Mode Detection.
 * 
 * This module is designed to be the single source of truth for XClaw mode.
 * We use function calls to resolve values at runtime to avoid circular dependency / TDZ issues.
 */

function getIsXClaw(env: NodeJS.ProcessEnv): boolean {
  const profile = (env.OPENCLAW_PROFILE ?? "").trim().toLowerCase();
  const xclawMode = (env.OPENCLAW_XCLAW_MODE ?? "").trim().toLowerCase();
  const isTruthy = (v: string) => ["true", "1", "yes", "on"].includes(v);
  return profile === "xclaw" || isTruthy(xclawMode);
}

/** Check XClaw mode for a specific environment. */
export function isXClawMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return getIsXClaw(env);
}

/** Global flag for XClaw mode (shortcut for the current process). */
export const IS_XCLAW_MODE = getIsXClaw(process.env);

function parseCsvSet(raw?: string): Set<string> {
  return new Set(
    String(raw ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function resolveOnlyChannelsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> | null {
  const only = parseCsvSet(env.OPENCLAW_ONLY_CHANNELS);
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
  const only = parseCsvSet(env.OPENCLAW_ONLY_MODEL_PROVIDERS);
  if (only.size > 0) {
    return only;
  }
  if (isXClawMode(env)) {
    return new Set(["openai", "gemini"]);
  }
  return null;
}

export function resolveTelegramOwnerIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return parseCsvSet(env.OPENCLAW_TELEGRAM_OWNER_IDS);
}

export function resolveTelegramNativeCommandAllowlist(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> | null {
  const only = parseCsvSet(env.OPENCLAW_TELEGRAM_NATIVE_COMMANDS);
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
    "whois",
  ]);
}
