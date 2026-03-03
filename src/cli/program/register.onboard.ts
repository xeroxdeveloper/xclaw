import type { Command } from "commander";
import { formatAuthChoiceChoicesForCli } from "../../commands/auth-choice-options.js";
import type { GatewayDaemonRuntime } from "../../commands/daemon-runtime.js";
import { ONBOARD_PROVIDER_AUTH_FLAGS } from "../../commands/onboard-provider-auth-flags.js";
import type {
  AuthChoice,
  GatewayAuthChoice,
  GatewayBind,
  NodeManagerChoice,
  ResetScope,
  SecretInputMode,
  TailscaleMode,
} from "../../commands/onboard-types.js";
import { onboardCommand } from "../../commands/onboard.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { t } from "../../xclaw/i18n.js";
import { isXClawMode } from "../../xclaw/mode.js";

function resolveInstallDaemonFlag(
  command: unknown,
  opts: { installDaemon?: boolean },
): boolean | undefined {
  if (!command || typeof command !== "object") {
    return undefined;
  }
  const getOptionValueSource =
    "getOptionValueSource" in command ? command.getOptionValueSource : undefined;
  if (typeof getOptionValueSource !== "function") {
    return undefined;
  }

  if (getOptionValueSource.call(command, "skipDaemon") === "cli") {
    return false;
  }
  if (getOptionValueSource.call(command, "installDaemon") === "cli") {
    return Boolean(opts.installDaemon);
  }
  return undefined;
}

const AUTH_CHOICE_HELP = formatAuthChoiceChoicesForCli({
  includeLegacyAliases: true,
  includeSkip: true,
});

export function registerOnboardCommand(program: Command) {
  const command = program
    .command("onboard")
    .description(t("onboard.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(isXClawMode() ? "Документация:" : "Docs:")} ${formatDocsLink("/cli/onboard", "docs.openclaw.ai/cli/onboard")}\n`,
    )
    .option("--workspace <dir>", isXClawMode() ? "Рабочая директория агента (по умолчанию: ~/.xclaw/workspace)" : "Agent workspace directory (default: ~/.openclaw/workspace)")
    .option(
      "--reset",
      isXClawMode() ? "Сбросить конфиг + ключи + сессии перед запуском" : "Reset config + credentials + sessions before running wizard (workspace only with --reset-scope full)",
    )
    .option("--reset-scope <scope>", isXClawMode() ? "Область сброса: config|config+creds+sessions|full" : "Reset scope: config|config+creds+sessions|full")
    .option("--non-interactive", isXClawMode() ? "Запуск без подсказок" : "Run without prompts", false)
    .option(
      "--accept-risk",
      isXClawMode() ? "Подтверждение рисков доступа к системе" : "Acknowledge that agents are powerful and full system access is risky (required for --non-interactive)",
      false,
    )
    .option("--flow <flow>", isXClawMode() ? "Поток настройки: quickstart|advanced|manual" : "Wizard flow: quickstart|advanced|manual")
    .option("--mode <mode>", isXClawMode() ? "Режим настройки: local|remote" : "Wizard mode: local|remote")
    .option("--auth-choice <choice>", isXClawMode() ? `Аутентификация: ${AUTH_CHOICE_HELP}` : `Auth: ${AUTH_CHOICE_HELP}`)
    .option(
      "--token-provider <id>",
      "Token provider id (non-interactive; used with --auth-choice token)",
    )
    .option("--token <token>", "Token value (non-interactive; used with --auth-choice token)")
    .option(
      "--token-profile-id <id>",
      "Auth profile id (non-interactive; default: <provider>:manual)",
    )
    .option("--token-expires-in <duration>", "Optional token expiry duration (e.g. 365d, 12h)")
    .option(
      "--secret-input-mode <mode>",
      "API key persistence mode: plaintext|ref (default: plaintext)",
    )
    .option("--cloudflare-ai-gateway-account-id <id>", "Cloudflare Account ID")
    .option("--cloudflare-ai-gateway-gateway-id <id>", "Cloudflare AI Gateway ID");

  for (const providerFlag of ONBOARD_PROVIDER_AUTH_FLAGS) {
    command.option(providerFlag.cliOption, providerFlag.description);
  }

  command
    .option("--custom-api-key <key>", isXClawMode() ? "Пользовательский API ключ (опционально)" : "Custom provider API key (optional)")
    .option("--custom-base-url <url>", isXClawMode() ? "Пользовательский базовый URL провайдера" : "Custom provider base URL")
    .option("--custom-compatibility <mode>", isXClawMode() ? "Совместимость API: openai|anthropic (по умолчанию: openai)" : "Custom provider API compatibility: openai|anthropic (default: openai)")
    .option("--custom-model-id <id>", isXClawMode() ? "Пользовательский ID модели" : "Custom provider model ID")
    .option("--custom-provider-id <id>", isXClawMode() ? "Пользовательский ID провайдера" : "Custom provider ID (optional; auto-derived by default)")
    .option("--gateway-port <port>", isXClawMode() ? "Порт шлюза" : "Gateway port")
    .option("--gateway-bind <mode>", isXClawMode() ? "Привязка шлюза: loopback|tailnet|lan|auto|custom" : "Gateway bind: loopback|tailnet|lan|auto|custom")
    .option("--gateway-auth <mode>", isXClawMode() ? "Аутентификация шлюза: token|password" : "Gateway auth: token|password")
    .option("--gateway-token <token>", isXClawMode() ? "Токен шлюза (token auth)" : "Gateway token (token auth)")
    .option("--gateway-password <password>", isXClawMode() ? "Пароль шлюза (password auth)" : "Gateway password (password auth)")
    .option("--remote-url <url>", isXClawMode() ? "URL удаленного шлюза (WebSocket)" : "Remote Gateway WebSocket URL")
    .option("--remote-token <token>", isXClawMode() ? "Токен удаленного шлюза" : "Remote Gateway token (optional)")
    .option("--tailscale <mode>", isXClawMode() ? "Tailscale: off|serve|funnel" : "Tailscale: off|serve|funnel")
    .option("--tailscale-reset-on-exit", isXClawMode() ? "Сброс Tailscale при выходе" : "Reset tailscale serve/funnel on exit")
    .option("--install-daemon", isXClawMode() ? "Установить службу шлюза" : "Install gateway service")
    .option("--no-install-daemon", isXClawMode() ? "Пропустить установку службы" : "Skip gateway service install")
    .option("--skip-daemon", isXClawMode() ? "Пропустить установку службы" : "Skip gateway service install")
    .option("--daemon-runtime <runtime>", isXClawMode() ? "Среда службы: node|bun" : "Daemon runtime: node|bun")
    .option("--skip-channels", isXClawMode() ? "Пропустить настройку каналов" : "Skip channel setup")
    .option("--skip-skills", isXClawMode() ? "Пропустить настройку навыков" : "Skip skills setup")
    .option("--skip-health", isXClawMode() ? "Пропустить проверку здоровья" : "Skip health check")
    .option("--skip-ui", isXClawMode() ? "Пропустить настройку UI" : "Skip Control UI/TUI prompts")
    .option("--node-manager <name>", isXClawMode() ? "Менеджер пакетов: npm|pnpm|bun" : "Node manager for skills: npm|pnpm|bun")
    .option("--json", isXClawMode() ? "Вывод в формате JSON" : "Output JSON summary", false);

  command.action(async (opts, commandRuntime) => {
    await runCommandWithRuntime(defaultRuntime, async () => {
      const installDaemon = resolveInstallDaemonFlag(commandRuntime, {
        installDaemon: Boolean(opts.installDaemon),
      });
      const gatewayPort =
        typeof opts.gatewayPort === "string" ? Number.parseInt(opts.gatewayPort, 10) : undefined;
      await onboardCommand(
        {
          workspace: opts.workspace as string | undefined,
          nonInteractive: Boolean(opts.nonInteractive),
          acceptRisk: Boolean(opts.acceptRisk),
          flow: opts.flow as "quickstart" | "advanced" | "manual" | undefined,
          mode: opts.mode as "local" | "remote" | undefined,
          authChoice: opts.authChoice as AuthChoice | undefined,
          tokenProvider: opts.tokenProvider as string | undefined,
          token: opts.token as string | undefined,
          tokenProfileId: opts.tokenProfileId as string | undefined,
          tokenExpiresIn: opts.tokenExpiresIn as string | undefined,
          secretInputMode: opts.secretInputMode as SecretInputMode | undefined,
          openaiApiKey: opts.openaiApiKey as string | undefined,
          geminiApiKey: opts.geminiApiKey as string | undefined,
          customBaseUrl: opts.customBaseUrl as string | undefined,
          customApiKey: opts.customApiKey as string | undefined,
          customModelId: opts.customModelId as string | undefined,
          customProviderId: opts.customProviderId as string | undefined,
          customCompatibility: opts.customCompatibility as "openai" | "anthropic" | undefined,
          gatewayPort:
            typeof gatewayPort === "number" && Number.isFinite(gatewayPort)
              ? gatewayPort
              : undefined,
          gatewayBind: opts.gatewayBind as GatewayBind | undefined,
          gatewayAuth: opts.gatewayAuth as GatewayAuthChoice | undefined,
          gatewayToken: opts.gatewayToken as string | undefined,
          gatewayPassword: opts.gatewayPassword as string | undefined,
          remoteUrl: opts.remoteUrl as string | undefined,
          remoteToken: opts.remoteToken as string | undefined,
          tailscale: opts.tailscale as TailscaleMode | undefined,
          tailscaleResetOnExit: Boolean(opts.tailscaleResetOnExit),
          reset: Boolean(opts.reset),
          resetScope: opts.resetScope as ResetScope | undefined,
          installDaemon,
          daemonRuntime: opts.daemonRuntime as GatewayDaemonRuntime | undefined,
          skipChannels: Boolean(opts.skipChannels),
          skipSkills: Boolean(opts.skipSkills),
          skipHealth: Boolean(opts.skipHealth),
          skipUi: Boolean(opts.skipUi),
          nodeManager: opts.nodeManager as NodeManagerChoice | undefined,
          json: Boolean(opts.json),
        },
        defaultRuntime,
      );
    });
  });
}
