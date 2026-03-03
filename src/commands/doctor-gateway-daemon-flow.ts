import { IS_XCLAW_MODE, isXClawMode, resolveOnlyChannelsFromEnv, resolveOnlyModelProvidersFromEnv, resolveTelegramNativeCommandAllowlist, resolveTelegramOwnerIds } from "../xclaw/mode.js";
import { formatCliCommand } from "../cli/command-format.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveGatewayPort } from "../config/config.js";
import {
  resolveGatewayLaunchAgentLabel,
  resolveNodeLaunchAgentLabel,
} from "../daemon/constants.js";
import { readLastGatewayErrorLine } from "../daemon/diagnostics.js";
import {
  isLaunchAgentListed,
  isLaunchAgentLoaded,
  launchAgentPlistExists,
  repairLaunchAgentBootstrap,
} from "../daemon/launchd.js";
import { resolveGatewayService } from "../daemon/service.js";
import { renderSystemdUnavailableHints } from "../daemon/systemd-hints.js";
import { isSystemdUserServiceAvailable } from "../daemon/systemd.js";
import { formatPortDiagnostics, inspectPortUsage } from "../infra/ports.js";
import { isWSL } from "../infra/wsl.js";
import type { RuntimeEnv } from "../runtime.js";
import { note } from "../terminal/note.js";
import { sleep } from "../utils.js";
import { buildGatewayInstallPlan, gatewayInstallErrorHint } from "./daemon-install-helpers.js";
import {
  DEFAULT_GATEWAY_DAEMON_RUNTIME,
  GATEWAY_DAEMON_RUNTIME_OPTIONS,
  type GatewayDaemonRuntime,
} from "./daemon-runtime.js";
import { buildGatewayRuntimeHints, formatGatewayRuntimeSummary } from "./doctor-format.js";
import type { DoctorOptions, DoctorPrompter } from "./doctor-prompter.js";
import { formatHealthCheckFailure } from "./health-format.js";
import { healthCommand } from "./health.js";

async function maybeRepairLaunchAgentBootstrap(params: {
  env: Record<string, string | undefined>;
  title: string;
  runtime: RuntimeEnv;
  prompter: DoctorPrompter;
}): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }

  const listed = await isLaunchAgentListed({ env: params.env });
  if (!listed) {
    return false;
  }

  const loaded = await isLaunchAgentLoaded({ env: params.env });
  if (loaded) {
    return false;
  }

  const plistExists = await launchAgentPlistExists(params.env);
  if (!plistExists) {
    return false;
  }

  note(IS_XCLAW_MODE ? "LaunchAgent указан в списке, но не загружен в launchd." : "LaunchAgent is listed but not loaded in launchd.", `${params.title} LaunchAgent`);

  const shouldFix = await params.prompter.confirmSkipInNonInteractive({
    message: IS_XCLAW_MODE ? `Исправить запуск ${params.title} LaunchAgent сейчас?` : `Repair ${params.title} LaunchAgent bootstrap now?`,
    initialValue: true,
  });
  if (!shouldFix) {
    return false;
  }

  params.runtime.log(IS_XCLAW_MODE ? `Настройка ${params.title} LaunchAgent...` : `Bootstrapping ${params.title} LaunchAgent...`);
  const repair = await repairLaunchAgentBootstrap({ env: params.env });
  if (!repair.ok) {
    params.runtime.error(
      IS_XCLAW_MODE
        ? `Не удалось настроить ${params.title} LaunchAgent: ${repair.detail ?? "неизвестная ошибка"}`
        : `${params.title} LaunchAgent bootstrap failed: ${repair.detail ?? "unknown error"}`,
    );
    return false;
  }

  const verified = await isLaunchAgentLoaded({ env: params.env });
  if (!verified) {
    params.runtime.error(IS_XCLAW_MODE ? `${params.title} LaunchAgent все еще не загружен после исправления.` : `${params.title} LaunchAgent still not loaded after repair.`);
    return false;
  }

  note(IS_XCLAW_MODE ? `${params.title} LaunchAgent исправлен.` : `${params.title} LaunchAgent repaired.`, `${params.title} LaunchAgent`);
  return true;
}

export async function maybeRepairGatewayDaemon(params: {
  cfg: OpenClawConfig;
  runtime: RuntimeEnv;
  prompter: DoctorPrompter;
  options: DoctorOptions;
  gatewayDetailsMessage: string;
  healthOk: boolean;
}) {
  if (params.healthOk) {
    return;
  }

  const service = resolveGatewayService();
  // systemd can throw in containers/WSL; treat as "not loaded" and fall back to hints.
  let loaded = false;
  try {
    loaded = await service.isLoaded({ env: process.env });
  } catch {
    loaded = false;
  }
  let serviceRuntime: Awaited<ReturnType<typeof service.readRuntime>> | undefined;
  if (loaded) {
    serviceRuntime = await service.readRuntime(process.env).catch(() => undefined);
  }

  if (process.platform === "darwin" && params.cfg.gateway?.mode !== "remote") {
    const gatewayRepaired = await maybeRepairLaunchAgentBootstrap({
      env: process.env,
      title: "Gateway",
      runtime: params.runtime,
      prompter: params.prompter,
    });
    await maybeRepairLaunchAgentBootstrap({
      env: {
        ...process.env,
        OPENCLAW_LAUNCHD_LABEL: resolveNodeLaunchAgentLabel(),
      },
      title: "Node",
      runtime: params.runtime,
      prompter: params.prompter,
    });
    if (gatewayRepaired) {
      loaded = await service.isLoaded({ env: process.env });
      if (loaded) {
        serviceRuntime = await service.readRuntime(process.env).catch(() => undefined);
      }
    }
  }

  if (params.cfg.gateway?.mode !== "remote") {
    const port = resolveGatewayPort(params.cfg, process.env);
    const diagnostics = await inspectPortUsage(port);
    if (diagnostics.status === "busy") {
      note(formatPortDiagnostics(diagnostics).join("\n"), IS_XCLAW_MODE ? "Порт шлюза" : "Gateway port");
    } else if (loaded && serviceRuntime?.status === "running") {
      const lastError = await readLastGatewayErrorLine(process.env);
      if (lastError) {
        note(IS_XCLAW_MODE ? `Последняя ошибка шлюза: ${lastError}` : `Last gateway error: ${lastError}`, IS_XCLAW_MODE ? "Шлюз" : "Gateway");
      }
    }
  }

  if (!loaded) {
    if (process.platform === "linux") {
      const systemdAvailable = await isSystemdUserServiceAvailable().catch(() => false);
      if (!systemdAvailable) {
        const wsl = await isWSL();
        note(renderSystemdUnavailableHints({ wsl }).join("\n"), IS_XCLAW_MODE ? "Шлюз" : "Gateway");
        return;
      }
    }
    note(IS_XCLAW_MODE ? "Служба шлюза не установлена." : "Gateway service not installed.", IS_XCLAW_MODE ? "Шлюз" : "Gateway");
    if (params.cfg.gateway?.mode !== "remote") {
      const install = await params.prompter.confirmSkipInNonInteractive({
        message: IS_XCLAW_MODE ? "Установить службу шлюза сейчас?" : "Install gateway service now?",
        initialValue: true,
      });
      if (install) {
        const daemonRuntime = await params.prompter.select<GatewayDaemonRuntime>(
          {
            message: IS_XCLAW_MODE ? "Среда выполнения службы шлюза" : "Gateway service runtime",
            options: GATEWAY_DAEMON_RUNTIME_OPTIONS,
            initialValue: DEFAULT_GATEWAY_DAEMON_RUNTIME,
          },
          DEFAULT_GATEWAY_DAEMON_RUNTIME,
        );
        const port = resolveGatewayPort(params.cfg, process.env);
        const { programArguments, workingDirectory, environment } = await buildGatewayInstallPlan({
          env: process.env,
          port,
          token: params.cfg.gateway?.auth?.token ?? process.env.OPENCLAW_GATEWAY_TOKEN,
          runtime: daemonRuntime,
          warn: (message, title) => note(message, title),
          config: params.cfg,
        });
        try {
          await service.install({
            env: process.env,
            stdout: process.stdout,
            programArguments,
            workingDirectory,
            environment,
          });
        } catch (err) {
          note(IS_XCLAW_MODE ? `Не удалось установить службу шлюза: ${String(err)}` : `Gateway service install failed: ${String(err)}`, IS_XCLAW_MODE ? "Шлюз" : "Gateway");
          note(gatewayInstallErrorHint(), IS_XCLAW_MODE ? "Шлюз" : "Gateway");
        }
      }
    }
    return;
  }

  const summary = formatGatewayRuntimeSummary(serviceRuntime);
  const hints = buildGatewayRuntimeHints(serviceRuntime, {
    platform: process.platform,
    env: process.env,
  });
  if (summary || hints.length > 0) {
    const lines: string[] = [];
    if (summary) {
      lines.push(`${IS_XCLAW_MODE ? "Среда" : "Runtime"}: ${summary}`);
    }
    lines.push(...hints);
    note(lines.join("\n"), IS_XCLAW_MODE ? "Шлюз" : "Gateway");
  }

  if (serviceRuntime?.status !== "running") {
    const start = await params.prompter.confirmSkipInNonInteractive({
      message: IS_XCLAW_MODE ? "Запустить службу шлюза сейчас?" : "Start gateway service now?",
      initialValue: true,
    });
    if (start) {
      await service.restart({
        env: process.env,
        stdout: process.stdout,
      });
      await sleep(1500);
    }
  }

  if (process.platform === "darwin") {
    const label = resolveGatewayLaunchAgentLabel(process.env.OPENCLAW_PROFILE);
    const cmd = IS_XCLAW_MODE ? "xclaw" : "openclaw";
    note(
      IS_XCLAW_MODE 
        ? `LaunchAgent загружен; остановка требует команды "${formatCliCommand(`${cmd} gateway stop`)}" или launchctl bootout gui/$UID/${label}.`
        : `LaunchAgent loaded; stopping requires "${formatCliCommand("openclaw gateway stop")}" or launchctl bootout gui/$UID/${label}.`,
      IS_XCLAW_MODE ? "Шлюз" : "Gateway",
    );
  }

  if (serviceRuntime?.status === "running") {
    const restart = await params.prompter.confirmSkipInNonInteractive({
      message: IS_XCLAW_MODE ? "Перезапустить службу шлюза сейчас?" : "Restart gateway service now?",
      initialValue: true,
    });
    if (restart) {
      await service.restart({
        env: process.env,
        stdout: process.stdout,
      });
      await sleep(1500);
      try {
        await healthCommand({ json: false, timeoutMs: 10_000 }, params.runtime);
      } catch (err) {
        const message = String(err);
        if (message.includes("gateway closed")) {
          note(IS_XCLAW_MODE ? "Шлюз не запущен." : "Gateway not running.", IS_XCLAW_MODE ? "Шлюз" : "Gateway");
          note(params.gatewayDetailsMessage, IS_XCLAW_MODE ? "Подключение к шлюзу" : "Gateway connection");
        } else {
          params.runtime.error(formatHealthCheckFailure(err));
        }
      }
    }
  }
}
