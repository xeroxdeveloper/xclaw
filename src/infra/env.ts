import { createSubsystemLogger } from "../logging/subsystem.js";
import { parseBooleanValue } from "../utils/boolean.js";

const log = createSubsystemLogger("env");
const loggedEnv = new Set<string>();
const knownSecrets = new Set<string>();

export function registerSecretForMasking(secret: string | undefined): void {
  if (!secret) {return;}
  const trimmed = secret.trim();
  if (trimmed.length < 4) {return;}
  knownSecrets.add(trimmed);
}

export function maskSecrets(text: string): string {
  let masked = text;
  for (const secret of knownSecrets) {
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "g");
    masked = masked.replace(re, "***MASKED***");
  }
  return masked;
}

function formatEnvValue(value: string, redact?: boolean): string {
  if (redact) {
    return "<redacted>";
  }
  const masked = maskSecrets(value);
  const singleLine = masked.replace(/\s+/g, " ").trim();
  if (singleLine.length <= 160) {
    return singleLine;
  }
  return `${singleLine.slice(0, 160)}…`;
}

type AcceptedEnvOption = {
  key: string;
  description: string;
  value?: string;
  redact?: boolean;
};

export function logAcceptedEnvOption(option: AcceptedEnvOption): void {
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return;
  }
  if (loggedEnv.has(option.key)) {
    return;
  }
  const rawValue = option.value ?? process.env[option.key];
  if (!rawValue || !rawValue.trim()) {
    return;
  }
  loggedEnv.add(option.key);
  log.info(`env: ${option.key}=${formatEnvValue(rawValue, option.redact)} (${option.description})`);
}

export function normalizeZaiEnv(): void {
  if (!process.env.ZAI_API_KEY?.trim() && process.env.Z_AI_API_KEY?.trim()) {
    process.env.ZAI_API_KEY = process.env.Z_AI_API_KEY;
  }
}

export function isTruthyEnvValue(value?: string): boolean {
  return parseBooleanValue(value) === true;
}

export function normalizeEnv(): void {
  normalizeZaiEnv();
}
