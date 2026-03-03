import fs from "node:fs";
import { IS_XCLAW_MODE } from "../xclaw/mode.js";
import { intro as clackIntro, outro as clackOutro } from "@clack/prompts";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../agents/defaults.js";
import { loadModelCatalog } from "../agents/model-catalog.js";
import {
  getModelRefStatus,
  resolveConfiguredModelRef,
  resolveHooksGmailModel,
} from "../agents/model-selection.js";
import { formatCliCommand } from "../cli/command-format.js";
import type { OpenClawConfig } from "../config/config.js";
import { CONFIG_PATH, readConfigFileSnapshot, writeConfigFile } from "../config/config.js";
import { logConfigUpdated } from "../config/logging.js";
import { resolveGatewayService } from "../daemon/service.js";
import { resolveGatewayAuth } from "../gateway/auth.js";
import { buildGatewayConnectionDetails } from "../gateway/call.js";
import { resolveOpenClawPackageRoot } from "../infra/openclaw-root.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { note } from "../terminal/note.js";
import { stylePromptTitle } from "../terminal/prompt-style.js";
import { shortenHomePath } from "../utils.js";
import {
  maybeRemoveDeprecatedCliAuthProfiles,
  maybeRepairAnthropicOAuthProfileId,
  noteAuthProfileHealth,
} from "./doctor-auth.js";
import { doctorShellCompletion } from "./doctor-completion.js";
import { loadAndMaybeMigrateDoctorConfig } from "./doctor-config-flow.js";
import { maybeRepairGatewayDaemon } from "./doctor-gateway-daemon-flow.js";
import { checkGatewayHealth, probeGatewayMemoryStatus } from "./doctor-gateway-health.js";
import {
  maybeRepairGatewayServiceConfig,
  maybeScanExtraGatewayServices,
} from "./doctor-gateway-services.js";
import { noteSourceInstallIssues } from "./doctor-install.js";
import { noteMemorySearchHealth } from "./doctor-memory-search.js";
import {
  noteMacLaunchAgentOverrides,
  noteMacLaunchctlGatewayEnvOverrides,
  noteDeprecatedLegacyEnvVars,
  noteStartupOptimizationHints,
} from "./doctor-platform-notes.js";
import { createDoctorPrompter, type DoctorOptions } from "./doctor-prompter.js";
import { maybeRepairSandboxImages, noteSandboxScopeWarnings } from "./doctor-sandbox.js";
import { noteSecurityWarnings } from "./doctor-security.js";
import { noteSessionLockHealth } from "./doctor-session-locks.js";
import { noteStateIntegrity, noteWorkspaceBackupTip } from "./doctor-state-integrity.js";
import {
  detectLegacyStateMigrations,
  runLegacyStateMigrations,
} from "./doctor-state-migrations.js";
import { maybeRepairUiProtocolFreshness } from "./doctor-ui.js";
import { maybeOfferUpdateBeforeDoctor } from "./doctor-update.js";
import { noteWorkspaceStatus } from "./doctor-workspace-status.js";
import { MEMORY_SYSTEM_PROMPT, shouldSuggestMemorySystem } from "./doctor-workspace.js";
import { applyWizardMetadata, printWizardHeader, randomToken } from "./onboard-helpers.js";
import { ensureSystemdUserLingerInteractive } from "./systemd-linger.js";

const intro = (message: string) => clackIntro(stylePromptTitle(message) ?? message);
const outro = (message: string) => clackOutro(stylePromptTitle(message) ?? message);

function resolveMode(cfg: OpenClawConfig): "local" | "remote" {
  return cfg.gateway?.mode === "remote" ? "remote" : "local";
}

export async function doctorCommand(
  runtime: RuntimeEnv = defaultRuntime,
  options: DoctorOptions = {},
) {
  const prompter = createDoctorPrompter({ runtime, options });
  printWizardHeader(runtime);
  intro(IS_XCLAW_MODE ? "Доктор XClaw" : "OpenClaw doctor");

  const root = await resolveOpenClawPackageRoot({
    moduleUrl: import.meta.url,
    argv1: process.argv[1],
    cwd: process.cwd(),
  });

  const updateResult = await maybeOfferUpdateBeforeDoctor({
    runtime,
    options,
    root,
    confirm: (p) => prompter.confirm(p),
    outro,
  });
  if (updateResult.handled) {
    return;
  }

  await maybeRepairUiProtocolFreshness(runtime, prompter);
  noteSourceInstallIssues(root);
  noteDeprecatedLegacyEnvVars();
  noteStartupOptimizationHints();

  const configResult = await loadAndMaybeMigrateDoctorConfig({
    options,
    confirm: (p) => prompter.confirm(p),
  });
  let cfg: OpenClawConfig = configResult.cfg;
  const cfgForPersistence = structuredClone(cfg);
  const sourceConfigValid = configResult.sourceConfigValid ?? true;

  const configPath = configResult.path ?? CONFIG_PATH;
  if (!cfg.gateway?.mode) {
    const lines = IS_XCLAW_MODE
      ? [
          "gateway.mode не установлен; запуск шлюза будет заблокирован.",
          `Исправьте: запустите ${formatCliCommand("xclaw configure")} и установите режим Gateway (local/remote).`,
          `Или установите напрямую: ${formatCliCommand("xclaw config set gateway.mode local")}`,
        ]
      : [
          "gateway.mode is unset; gateway start will be blocked.",
          `Fix: run ${formatCliCommand("openclaw configure")} and set Gateway mode (local/remote).`,
          `Or set directly: ${formatCliCommand("openclaw config set gateway.mode local")}`,
        ];
    if (!fs.existsSync(configPath)) {
      lines.push(
        IS_XCLAW_MODE
          ? `Отсутствует конфиг: сначала запустите ${formatCliCommand("xclaw setup")}.`
          : `Missing config: run ${formatCliCommand("openclaw setup")} first.`,
      );
    }
    note(lines.join("\n"), IS_XCLAW_MODE ? "Шлюз" : "Gateway");
  }

  cfg = await maybeRepairAnthropicOAuthProfileId(cfg, prompter);
  cfg = await maybeRemoveDeprecatedCliAuthProfiles(cfg, prompter);
  await noteAuthProfileHealth({
    cfg,
    prompter,
    allowKeychainPrompt: options.nonInteractive !== true && Boolean(process.stdin.isTTY),
  });
  const gatewayDetails = buildGatewayConnectionDetails({ config: cfg });
  if (gatewayDetails.remoteFallbackNote) {
    note(gatewayDetails.remoteFallbackNote, "Gateway");
  }
  if (resolveMode(cfg) === "local" && sourceConfigValid) {
    const auth = resolveGatewayAuth({
      authConfig: cfg.gateway?.auth,
      tailscaleMode: cfg.gateway?.tailscale?.mode ?? "off",
    });
    const needsToken = auth.mode !== "password" && (auth.mode !== "token" || !auth.token);
    if (needsToken) {
      note(
        IS_XCLAW_MODE
          ? "Аутентификация шлюза отключена или отсутствует токен. Токен теперь является рекомендуемым стандартом."
          : "Gateway auth is off or missing a token. Token auth is now the recommended default (including loopback).",
        IS_XCLAW_MODE ? "Доступ к шлюзу" : "Gateway auth",
      );
      const shouldSetToken =
        options.generateGatewayToken === true
          ? true
          : options.nonInteractive === true
            ? false
            : await prompter.confirmRepair({
                message: IS_XCLAW_MODE ? "Сгенерировать и настроить токен шлюза прямо сейчас?" : "Generate and configure a gateway token now?",
                initialValue: true,
              });
      if (shouldSetToken) {
        const nextToken = randomToken();
        cfg = {
          ...cfg,
          gateway: {
            ...cfg.gateway,
            auth: {
              ...cfg.gateway?.auth,
              mode: "token",
              token: nextToken,
            },
          },
        };
        note(IS_XCLAW_MODE ? "Токен шлюза настроен." : "Gateway token configured.", IS_XCLAW_MODE ? "Доступ к шлюзу" : "Gateway auth");
      }
    }
  }

  const legacyState = await detectLegacyStateMigrations({ cfg });
  if (legacyState.preview.length > 0) {
    note(legacyState.preview.join("\n"), IS_XCLAW_MODE ? "Обнаружено устаревшее состояние" : "Legacy state detected");
    const migrate =
      options.nonInteractive === true
        ? true
        : await prompter.confirm({
            message: IS_XCLAW_MODE ? "Перенести устаревшее состояние (сессии/агенты) прямо сейчас?" : "Migrate legacy state (sessions/agent/WhatsApp auth) now?",
            initialValue: true,
          });
    if (migrate) {
      const migrated = await runLegacyStateMigrations({
        detected: legacyState,
      });
      if (migrated.changes.length > 0) {
        note(migrated.changes.join("\n"), IS_XCLAW_MODE ? "Изменения доктора" : "Doctor changes");
      }
      if (migrated.warnings.length > 0) {
        note(migrated.warnings.join("\n"), IS_XCLAW_MODE ? "Предупреждения доктора" : "Doctor warnings");
      }
    }
  }

  await noteStateIntegrity(cfg, prompter, configResult.path ?? CONFIG_PATH);
  await noteSessionLockHealth({ shouldRepair: prompter.shouldRepair });

  cfg = await maybeRepairSandboxImages(cfg, runtime, prompter);
  noteSandboxScopeWarnings(cfg);

  await maybeScanExtraGatewayServices(options, runtime, prompter);
  await maybeRepairGatewayServiceConfig(cfg, resolveMode(cfg), runtime, prompter);
  await noteMacLaunchAgentOverrides();
  await noteMacLaunchctlGatewayEnvOverrides(cfg);

  await noteSecurityWarnings(cfg);

  if (cfg.hooks?.gmail?.model?.trim()) {
    const hooksModelRef = resolveHooksGmailModel({
      cfg,
      defaultProvider: DEFAULT_PROVIDER,
    });
    if (!hooksModelRef) {
      note(`- hooks.gmail.model "${cfg.hooks.gmail.model}" could not be resolved`, "Hooks");
    } else {
      const { provider: defaultProvider, model: defaultModel } = resolveConfiguredModelRef({
        cfg,
        defaultProvider: DEFAULT_PROVIDER,
        defaultModel: DEFAULT_MODEL,
      });
      const catalog = await loadModelCatalog({ config: cfg });
      const status = getModelRefStatus({
        cfg,
        catalog,
        ref: hooksModelRef,
        defaultProvider,
        defaultModel,
      });
      const warnings: string[] = [];
      if (!status.allowed) {
        warnings.push(
          `- hooks.gmail.model "${status.key}" not in agents.defaults.models allowlist (will use primary instead)`,
        );
      }
      if (!status.inCatalog) {
        warnings.push(
          `- hooks.gmail.model "${status.key}" not in the model catalog (may fail at runtime)`,
        );
      }
      if (warnings.length > 0) {
        note(warnings.join("\n"), "Hooks");
      }
    }
  }

  if (
    options.nonInteractive !== true &&
    process.platform === "linux" &&
    resolveMode(cfg) === "local"
  ) {
    const service = resolveGatewayService();
    let loaded = false;
    try {
      loaded = await service.isLoaded({ env: process.env });
    } catch {
      loaded = false;
    }
    if (loaded) {
      await ensureSystemdUserLingerInteractive({
        runtime,
        prompter: {
          confirm: async (p) => prompter.confirm(p),
          note,
        },
        reason:
          "Gateway runs as a systemd user service. Without lingering, systemd stops the user session on logout/idle and kills the Gateway.",
        requireConfirm: true,
      });
    }
  }

  noteWorkspaceStatus(cfg);

  // Check and fix shell completion
  await doctorShellCompletion(runtime, prompter, {
    nonInteractive: options.nonInteractive,
  });

  const { healthOk } = await checkGatewayHealth({
    runtime,
    cfg,
    timeoutMs: options.nonInteractive === true ? 3000 : 10_000,
  });
  const gatewayMemoryProbe = healthOk
    ? await probeGatewayMemoryStatus({
        cfg,
        timeoutMs: options.nonInteractive === true ? 3000 : 10_000,
      })
    : { checked: false, ready: false };
  await noteMemorySearchHealth(cfg, { gatewayMemoryProbe });
  await maybeRepairGatewayDaemon({
    cfg,
    runtime,
    prompter,
    options,
    gatewayDetailsMessage: gatewayDetails.message,
    healthOk,
  });

  const shouldWriteConfig =
    configResult.shouldWriteConfig || JSON.stringify(cfg) !== JSON.stringify(cfgForPersistence);
  if (shouldWriteConfig) {
    cfg = applyWizardMetadata(cfg, { command: "doctor", mode: resolveMode(cfg) });
    await writeConfigFile(cfg);
    logConfigUpdated(runtime);
    const backupPath = `${CONFIG_PATH}.bak`;
    if (fs.existsSync(backupPath)) {
      runtime.log(`${IS_XCLAW_MODE ? "Бэкап" : "Backup"}: ${shortenHomePath(backupPath)}`);
    }
  } else if (!prompter.shouldRepair) {
    runtime.log(
      IS_XCLAW_MODE
        ? `Запустите "${formatCliCommand("xclaw doctor --fix")}" для применения изменений.`
        : `Run "${formatCliCommand("openclaw doctor --fix")}" to apply changes.`,
    );
  }

  if (options.workspaceSuggestions !== false) {
    const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
    noteWorkspaceBackupTip(workspaceDir);
    if (await shouldSuggestMemorySystem(workspaceDir)) {
      note(MEMORY_SYSTEM_PROMPT, IS_XCLAW_MODE ? "Рабочая область" : "Workspace");
    }
  }

  const finalSnapshot = await readConfigFileSnapshot();
  if (finalSnapshot.exists && !finalSnapshot.valid) {
    runtime.error(IS_XCLAW_MODE ? "Невалидный конфиг:" : "Invalid config:");
    for (const issue of finalSnapshot.issues) {
      const path = issue.path || "<root>";
      runtime.error(`- ${path}: ${issue.message}`);
    }
  }

  outro(IS_XCLAW_MODE ? "Доктор завершил проверку." : "Doctor complete.");
}
