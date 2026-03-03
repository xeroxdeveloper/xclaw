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
import { IS_XCLAW_MODE } from "../../xclaw/mode.js";

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
        `\n${theme.muted(IS_XCLAW_MODE ? "Документация:" : "Docs:")} ${formatDocsLink("/cli/onboard", "docs.openclaw.ai/cli/onboard")}\n`,
    )
    .option("--workspace <dir>", IS_XCLAW_MODE ? "Рабочая директория агента (по умолчанию: ~/.xclaw/workspace)" : "Agent workspace directory (default: ~/.openclaw/workspace)")
    .option(
      "--reset",
      IS_XCLAW_MODE ? "Сбросить конфиг + ключи + сессии перед запуском" : "Reset config + credentials + sessions before running wizard (workspace only with --reset-scope full)",
    )
    .option("--reset-scope <scope>", IS_XCLAW_MODE ? "Область сброса: config|config+creds+sessions|full" : "Reset scope: config|config+creds+sessions|full")
    .option("--non-interactive", IS_XCLAW_MODE ? "Запуск без подсказок" : "Run without prompts", false)
    .option(
      "--accept-risk",
      IS_XCLAW_MODE ? "Подтверждение рисков доступа к системе" : "Acknowledge that agents are powerful and full system access is risky (required for --non-interactive)",
      false,
    )
    .option("--flow <flow>", IS_XCLAW_MODE ? "Поток настройки: quickstart|advanced|manual" : "Wizard flow: quickstart|advanced|manual")
    .option("--mode <mode>", IS_XCLAW_MODE ? "Режим настройки: local|remote" : "Wizard mode: local|remote")
    .option("--auth-choice <choice>", IS_XCLAW_MODE ? `Аутентификация: ${AUTH_CHOICE_HELP}` : `Auth: ${AUTH_CHOICE_HELP}`)
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
    .option("--custom-api-key <key>", IS_XCLAW_MODE ? "Пользовательский API ключ (опционально)" : "Custom provider API key (optional)")
    .option("--custom-base-url <url>", IS_XCLAW_MODE ? "Пользовательский базовый URL провайдера" : "Custom provider base URL")
    .option("--custom-compatibility <mode>", IS_XCLAW_MODE ? "Совместимость API: openai|anthropic (по умолчанию: openai)" : "Custom provider API compatibility: openai|anthropic (default: openai)")
    .option("--custom-model-id <id>", IS_XCLAW_MODE ? "Пользовательский ID модели" : "Custom provider model ID")
    .option("--custom-provider-id <id>", IS_XCLAW_MODE ? "Пользовательский ID провайдера" : "Custom provider ID (optional; auto-derived by default)")
    .option("--gateway-port <port>", IS_XCLAW_MODE ? "Порт шлюза" : "Gateway port")
    .option("--gateway-bind <mode>", IS_XCLAW_MODE ? "Привязка шлюза: loopback|tailnet|lan|auto|custom" : "Gateway bind: loopback|tailnet|lan|auto|custom")
    .option("--gateway-auth <mode>", IS_XCLAW_MODE ? "Аутентификация шлюза: token|password" : "Gateway auth: token|password")
    .option("--gateway-token <token>", IS_XCLAW_MODE ? "Токен шлюза (token auth)" : "Gateway token (token auth)")
    .option("--gateway-password <password>", IS_XCLAW_MODE ? "Пароль шлюза (password auth)" : "Gateway password (password auth)")
    .option("--remote-url <url>", IS_XCLAW_MODE ? "URL удаленного шлюза (WebSocket)" : "Remote Gateway WebSocket URL")
    .option("--remote-token <token>", IS_XCLAW_MODE ? "Токен удаленного шлюза" : "Remote Gateway token (optional)")
    .option("--tailscale <mode>", IS_XCLAW_MODE ? "Tailscale: off|serve|funnel" : "Tailscale: off|serve|funnel")
    .option("--tailscale-reset-on-exit", IS_XCLAW_MODE ? "Сброс Tailscale при выходе" : "Reset tailscale serve/funnel on exit")
    .option("--install-daemon", IS_XCLAW_MODE ? "Установить службу шлюза" : "Install gateway service")
    .option("--no-install-daemon", IS_XCLAW_MODE ? "Пропустить установку службы" : "Skip gateway service install")
    .option("--skip-daemon", IS_XCLAW_MODE ? "Пропустить установку службы" : "Skip gateway service install")
    .option("--daemon-runtime <runtime>", IS_XCLAW_MODE ? "Среда службы: node|bun" : "Daemon runtime: node|bun")
    .option("--skip-channels", IS_XCLAW_MODE ? "Пропустить настройку каналов" : "Skip channel setup")
    .option("--skip-skills", IS_XCLAW_MODE ? "Пропустить настройку навыков" : "Skip skills setup")
    .option("--skip-health", IS_XCLAW_MODE ? "Пропустить проверку здоровья" : "Skip health check")
    .option("--skip-ui", IS_XCLAW_MODE ? "Пропустить настройку UI" : "Skip Control UI/TUI prompts")
    .option("--node-manager <name>", IS_XCLAW_MODE ? "Менеджер пакетов: npm|pnpm|bun" : "Node manager for skills: npm|pnpm|bun")
    .option("--json", IS_XCLAW_MODE ? "Вывод в формате JSON" : "Output JSON summary", false);

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
