#!/usr/bin/env node
import { spawn } from "node:child_process";
import { enableCompileCache } from "node:module";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isRootHelpInvocation, isRootVersionInvocation } from "./cli/argv.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./cli/profile.js";
import { shouldSkipRespawnForArgv } from "./cli/respawn-policy.js";
import { normalizeWindowsArgv } from "./cli/windows-argv.js";
import { isTruthyEnvValue, normalizeEnv, registerSecretForMasking } from "./infra/env.js";
import { isMainModule } from "./infra/is-main.js";
import { installProcessWarningFilter } from "./infra/warning-filter.js";
import { attachChildProcessBridge } from "./process/child-process-bridge.js";
import { isXClawMode } from "./xclaw/mode.js";

const ENTRY_WRAPPER_PAIRS = [
  { wrapperBasename: "openclaw.mjs", entryBasename: "entry.js" },
  { wrapperBasename: "openclaw.js", entryBasename: "entry.js" },
  { wrapperBasename: "xclaw.mjs", entryBasename: "entry.js" },
  { wrapperBasename: "xlaw", entryBasename: "entry.js" },
  { wrapperBasename: "xclaw", entryBasename: "entry.js" },
] as const;

function shouldForceReadOnlyAuthStore(argv: string[]): boolean {
  const tokens = argv.slice(2).filter((token) => token.length > 0 && !token.startsWith("-"));
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index] === "secrets" && tokens[index + 1] === "audit") {
      return true;
    }
  }
  return false;
}

if (
  !isMainModule({
    currentFile: fileURLToPath(import.meta.url),
    wrapperEntryPairs: [...ENTRY_WRAPPER_PAIRS],
  })
) {
  // Imported as a dependency
} else {
  const IS_XCLAW = isXClawMode();
  const CLI_TITLE = IS_XCLAW ? "xlaw" : "openclaw";
  process.title = CLI_TITLE;
  
  if (process.env.TELEGRAM_BOT_TOKEN) {
    registerSecretForMasking(process.env.TELEGRAM_BOT_TOKEN);
  }
  if (process.env.OPENAI_API_KEY) {
    registerSecretForMasking(process.env.OPENAI_API_KEY);
  }
  if (process.env.GEMINI_API_KEY) {
    registerSecretForMasking(process.env.GEMINI_API_KEY);
  }
  
  installProcessWarningFilter();
  normalizeEnv();

  if (!isTruthyEnvValue(process.env.NODE_DISABLE_COMPILE_CACHE)) {
    try {
      enableCompileCache();
    } catch {
      // ignore
    }
  }

  if (shouldForceReadOnlyAuthStore(process.argv)) {
    process.env.OPENCLAW_AUTH_STORE_READONLY = "1";
  }

  if (process.argv.includes("--no-color")) {
    process.env.NO_COLOR = "1";
    process.env.FORCE_COLOR = "0";
  }

  const EXPERIMENTAL_WARNING_FLAG = "--disable-warning=ExperimentalWarning";

  function hasExperimentalWarningSuppressed(): boolean {
    const nodeOptions = process.env.NODE_OPTIONS ?? "";
    if (nodeOptions.includes(EXPERIMENTAL_WARNING_FLAG) || nodeOptions.includes("--no-warnings")) {
      return true;
    }
    for (const arg of process.execArgv) {
      if (arg === EXPERIMENTAL_WARNING_FLAG || arg === "--no-warnings") {
        return true;
      }
    }
    return false;
  }

  function ensureExperimentalWarningSuppressed(): boolean {
    if (shouldSkipRespawnForArgv(process.argv)) {
      return false;
    }
    if (isTruthyEnvValue(process.env.OPENCLAW_NO_RESPAWN)) {
      return false;
    }
    if (isTruthyEnvValue(process.env.OPENCLAW_NODE_OPTIONS_READY)) {
      return false;
    }
    if (hasExperimentalWarningSuppressed()) {
      return false;
    }

    process.env.OPENCLAW_NODE_OPTIONS_READY = "1";
    const child = spawn(
      process.execPath,
      [EXPERIMENTAL_WARNING_FLAG, ...process.execArgv, ...process.argv.slice(1)],
      {
        stdio: "inherit",
        env: process.env,
      },
    );

    attachChildProcessBridge(child);

    child.once("exit", (code, signal) => {
      if (signal) {
        process.exitCode = 1;
        return;
      }
      process.exit(code ?? 1);
    });

    child.once("error", (error) => {
      console.error(
        `[${CLI_TITLE}] Failed to respawn CLI:`,
        error instanceof Error ? (error.stack ?? error.message) : error,
      );
      process.exit(1);
    });

    return true;
  }

  function tryHandleRootVersionFastPath(argv: string[]): boolean {
    if (!isRootVersionInvocation(argv)) {
      return false;
    }
    import("./version.js")
      .then(({ VERSION }) => {
        console.log(VERSION);
      })
      .catch((error) => {
        console.error(
          `[${CLI_TITLE}] Failed to resolve version:`,
          error instanceof Error ? (error.stack ?? error.message) : error,
        );
        process.exitCode = 1;
      });
    return true;
  }

  function tryHandleRootHelpFastPath(argv: string[]): boolean {
    if (!isRootHelpInvocation(argv)) {
      return false;
    }
    import("./cli/program.js")
      .then(({ buildProgram }) => {
        buildProgram().outputHelp();
      })
      .catch((error) => {
        console.error(
          `[${CLI_TITLE}] Failed to display help:`,
          error instanceof Error ? (error.stack ?? error.message) : error,
        );
        process.exitCode = 1;
      });
    return true;
  }

  process.argv = normalizeWindowsArgv(process.argv);

  if (!ensureExperimentalWarningSuppressed()) {
    const parsed = parseCliProfileArgs(process.argv);
    if (!parsed.ok) {
      console.error(`[${CLI_TITLE}] ${parsed.error}`);
      process.exit(2);
    }

    if (parsed.profile) {
      applyCliProfileEnv({ profile: parsed.profile });
      process.argv = parsed.argv;
    }

    if (!tryHandleRootVersionFastPath(process.argv) && !tryHandleRootHelpFastPath(process.argv)) {
      import("./cli/run-main.js")
        .then(({ runCli }) => runCli(process.argv))
        .catch((error) => {
          console.error(
            `[${CLI_TITLE}] Failed to start CLI:`,
            error instanceof Error ? (error.stack ?? error.message) : error,
          );
          process.exitCode = 1;
        });
    }
  }
}
