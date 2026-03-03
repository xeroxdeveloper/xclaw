import { IS_XCLAW_MODE, isXClawMode, resolveTelegramNativeCommandAllowlist, resolveTelegramOwnerIds } from "../xclaw/mode.js";
import path from "node:path";

export const DEFAULT_CLI_NAME = IS_XCLAW_MODE ? "xclaw" : "openclaw";

const KNOWN_CLI_NAMES = new Set(["openclaw", "xclaw", "xclaw.mjs", "openclaw.mjs"]);
const CLI_PREFIX_RE = /^(?:((?:pnpm|npm|bunx|npx)\s+))?(openclaw|xclaw)\b/;

export function resolveCliName(argv: string[] = process.argv): string {
  const argv1 = argv[1];
  if (!argv1) {
    return DEFAULT_CLI_NAME;
  }
  const base = path.basename(argv1).trim();
  if (KNOWN_CLI_NAMES.has(base)) {
    return base;
  }
  return DEFAULT_CLI_NAME;
}

export function replaceCliName(command: string, cliName = resolveCliName()): string {
  if (!command.trim()) {
    return command;
  }
  if (!CLI_PREFIX_RE.test(command)) {
    return command;
  }
  return command.replace(CLI_PREFIX_RE, (_match, runner: string | undefined) => {
    return `${runner ?? ""}${cliName}`;
  });
}
