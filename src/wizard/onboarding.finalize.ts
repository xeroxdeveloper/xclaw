import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_BOOTSTRAP_FILENAME } from "../agents/workspace.js";
import { formatCliCommand } from "../cli/command-format.js";
import { IS_XCLAW_MODE } from "../xclaw/mode.js";
import {
  buildGatewayInstallPlan,
  gatewayInstallErrorHint,
} from "../commands/daemon-install-helpers.js";
import {
  DEFAULT_GATEWAY_DAEMON_RUNTIME,
  GATEWAY_DAEMON_RUNTIME_OPTIONS,
} from "../commands/daemon-runtime.js";
import { formatHealthCheckFailure } from "../commands/health-format.js";
import { healthCommand } from "../commands/health.js";
import {
  detectBrowserOpenSupport,
  formatControlUiSshHint,
  openUrl,
  probeGatewayReachable,
  waitForGatewayReachable,
  resolveControlUiLinks,
} from "../commands/onboard-helpers.js";
import type { OnboardOptions } from "../commands/onboard-types.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveGatewayService } from "../daemon/service.js";
import { isSystemdUserServiceAvailable } from "../daemon/systemd.js";
import { ensureControlUiAssetsBuilt } from "../infra/control-ui-assets.js";
import type { RuntimeEnv } from "../runtime.js";
import { restoreTerminalState } from "../terminal/restore.js";
import { runTui } from "../tui/tui.js";
import { resolveUserPath } from "../utils.js";
import { setupOnboardingShellCompletion } from "./onboarding.completion.js";
import type { GatewayWizardSettings, WizardFlow } from "./onboarding.types.js";
import type { WizardPrompter } from "./prompts.js";

type FinalizeOnboardingOptions = {
  flow: WizardFlow;
  opts: OnboardOptions;
  baseConfig: OpenClawConfig;
  nextConfig: OpenClawConfig;
  workspaceDir: string;
  settings: GatewayWizardSettings;
  prompter: WizardPrompter;
  runtime: RuntimeEnv;
};

export async function finalizeOnboardingWizard(
  options: FinalizeOnboardingOptions,
): Promise<{ launchedTui: boolean }> {
  const { flow, opts, baseConfig, nextConfig, settings, prompter, runtime } = options;

  const withWizardProgress = async <T>(

    label: string,
    options: { doneMessage?: string },
    work: (progress: { update: (message: string) => void }) => Promise<T>,
  ): Promise<T> => {
    const progress = prompter.progress(label);
    try {
      return await work(progress);
    } finally {
      progress.stop(options.doneMessage);
    }
  };

  const systemdAvailable =
    process.platform === "linux" ? await isSystemdUserServiceAvailable() : true;
  if (process.platform === "linux" && !systemdAvailable) {
    await prompter.note(
      IS_XCLAW_MODE
        ? "Пользовательские службы Systemd недоступны. Пропуск установки службы."
        : "Systemd user services are unavailable. Skipping lingering checks and service install.",
      "Systemd",
    );
  }

  if (process.platform === "linux" && systemdAvailable) {
    const { ensureSystemdUserLingerInteractive } = await import("../commands/systemd-linger.js");
    await ensureSystemdUserLingerInteractive({
      runtime,
      prompter: {
        confirm: prompter.confirm,
        note: prompter.note,
      },
      reason:
        "Linux installs use a systemd user service by default. Without lingering, systemd stops the user session on logout/idle and kills the Gateway.",
      requireConfirm: false,
    });
  }

  const explicitInstallDaemon =
    typeof opts.installDaemon === "boolean" ? opts.installDaemon : undefined;
  let installDaemon: boolean;
  if (explicitInstallDaemon !== undefined) {
    installDaemon = explicitInstallDaemon;
  } else if (process.platform === "linux" && !systemdAvailable) {
    installDaemon = false;
  } else if (flow === "quickstart") {
    installDaemon = true;
  } else {
    installDaemon = await prompter.confirm({
      message: IS_XCLAW_MODE ? "Установить службу шлюза (рекомендуется)" : "Install Gateway service (recommended)",
      initialValue: true,
    });
  }

  if (process.platform === "linux" && !systemdAvailable && installDaemon) {
    await prompter.note(
      "Systemd user services are unavailable; skipping service install. Use your container supervisor or `docker compose up -d`.",
      "Gateway service",
    );
    installDaemon = false;
  }

  if (installDaemon) {
    const daemonRuntime =
      flow === "quickstart"
        ? DEFAULT_GATEWAY_DAEMON_RUNTIME
        : await prompter.select({
            message: "Gateway service runtime",
            options: GATEWAY_DAEMON_RUNTIME_OPTIONS,
            initialValue: opts.daemonRuntime ?? DEFAULT_GATEWAY_DAEMON_RUNTIME,
          });
    if (flow === "quickstart") {
      await prompter.note(
        "QuickStart uses Node for the Gateway service (stable + supported).",
        "Gateway service runtime",
      );
    }
    const service = resolveGatewayService();
    const loaded = await service.isLoaded({ env: process.env });
    if (loaded) {
      const action = await prompter.select({
        message: "Gateway service already installed",
        options: [
          { value: "restart", label: "Restart" },
          { value: "reinstall", label: "Reinstall" },
          { value: "skip", label: "Skip" },
        ],
      });
      if (action === "restart") {
        await withWizardProgress(
          "Gateway service",
          { doneMessage: "Gateway service restarted." },
          async (progress) => {
            progress.update("Restarting Gateway service…");
            await service.restart({
              env: process.env,
              stdout: process.stdout,
            });
          },
        );
      } else if (action === "reinstall") {
        await withWizardProgress(
          "Gateway service",
          { doneMessage: "Gateway service uninstalled." },
          async (progress) => {
            progress.update("Uninstalling Gateway service…");
            await service.uninstall({ env: process.env, stdout: process.stdout });
          },
        );
      }
    }

    if (!loaded || (loaded && !(await service.isLoaded({ env: process.env })))) {
      const progress = prompter.progress("Gateway service");
      let installError: string | null = null;
      try {
        progress.update("Preparing Gateway service…");
        const { programArguments, workingDirectory, environment } = await buildGatewayInstallPlan({
          env: process.env,
          port: settings.port,
          token: settings.gatewayToken,
          runtime: daemonRuntime,
          warn: (message, title) => prompter.note(message, title),
          config: nextConfig,
        });

        progress.update("Installing Gateway service…");
        await service.install({
          env: process.env,
          stdout: process.stdout,
          programArguments,
          workingDirectory,
          environment,
        });
      } catch (err) {
        installError = err instanceof Error ? err.message : String(err);
      } finally {
        progress.stop(
          installError ? "Gateway service install failed." : "Gateway service installed.",
        );
      }
      if (installError) {
        await prompter.note(`Gateway service install failed: ${installError}`, "Gateway");
        await prompter.note(gatewayInstallErrorHint(), "Gateway");
      }
    }
  }

  if (!opts.skipHealth) {
    const probeLinks = resolveControlUiLinks({
      bind: nextConfig.gateway?.bind ?? "loopback",
      port: settings.port,
      customBindHost: nextConfig.gateway?.customBindHost,
      basePath: undefined,
    });
    // Daemon install/restart can briefly flap the WS; wait a bit so health check doesn't false-fail.
    await waitForGatewayReachable({
      url: probeLinks.wsUrl,
      token: settings.gatewayToken,
      deadlineMs: 15_000,
    });
    try {
      await healthCommand({ json: false, timeoutMs: 10_000 }, runtime);
    } catch (err) {
      runtime.error(formatHealthCheckFailure(err));
      await prompter.note(
        [
          "Docs:",
          "https://docs.openclaw.ai/gateway/health",
          "https://docs.openclaw.ai/gateway/troubleshooting",
        ].join("\n"),
        "Health check help",
      );
    }
  }

  const controlUiEnabled =
    nextConfig.gateway?.controlUi?.enabled ?? baseConfig.gateway?.controlUi?.enabled ?? true;
  if (!opts.skipUi && controlUiEnabled) {
    const controlUiAssets = await ensureControlUiAssetsBuilt(runtime);
    if (!controlUiAssets.ok && controlUiAssets.message) {
      const buildCmd = "pnpm ui:build";
      runtime.error(
        IS_XCLAW_MODE
          ? `Отсутствуют файлы веб-интерфейса. Соберите их командой \`${buildCmd}\`.`
          : controlUiAssets.message,
      );
    }
  }

    await prompter.note(
      [
        IS_XCLAW_MODE ? "Добавьте узлы для дополнительных функций:" : "Add nodes for extra features:",
        IS_XCLAW_MODE ? "- Приложение macOS (система + уведомления)" : "- macOS app (system + notifications)",
        IS_XCLAW_MODE ? "- Приложение iOS (камера/холст)" : "- iOS app (camera/canvas)",
        IS_XCLAW_MODE ? "- Приложение Android (камера/холст)" : "- Android app (camera/canvas)",
      ].join("\n"),
      IS_XCLAW_MODE ? "Дополнительные приложения" : "Optional apps",
    );


  const controlUiBasePath =
    nextConfig.gateway?.controlUi?.basePath ?? baseConfig.gateway?.controlUi?.basePath;
  const links = resolveControlUiLinks({
    bind: settings.bind,
    port: settings.port,
    customBindHost: settings.customBindHost,
    basePath: controlUiBasePath,
  });
  const authedUrl =
    settings.authMode === "token" && settings.gatewayToken
      ? `${links.httpUrl}#token=${encodeURIComponent(settings.gatewayToken)}`
      : links.httpUrl;
  const gatewayProbe = await probeGatewayReachable({
    url: links.wsUrl,
    token: settings.authMode === "token" ? settings.gatewayToken : undefined,
    password: settings.authMode === "password" ? nextConfig.gateway?.auth?.password : "",
  });
  const gatewayStatusLine = gatewayProbe.ok
    ? (IS_XCLAW_MODE ? "Шлюз: доступен" : "Gateway: reachable")
    : (IS_XCLAW_MODE ? `Шлюз: не обнаружен${gatewayProbe.detail ? ` (${gatewayProbe.detail})` : ""}` : `Gateway: not detected${gatewayProbe.detail ? ` (${gatewayProbe.detail})` : ""}`);
  const bootstrapPath = path.join(
    resolveUserPath(options.workspaceDir),
    DEFAULT_BOOTSTRAP_FILENAME,
  );
  const hasBootstrap = await fs
    .access(bootstrapPath)
    .then(() => true)
    .catch(() => false);

    await prompter.note(
      [
        IS_XCLAW_MODE ? `Web UI: ${links.httpUrl}` : `Web UI: ${links.httpUrl}`,
        settings.authMode === "token" && settings.gatewayToken
          ? (IS_XCLAW_MODE ? `Web UI (с токеном): ${authedUrl}` : `Web UI (with token): ${authedUrl}`)
          : undefined,
        `Gateway WS: ${links.wsUrl}`,
        gatewayStatusLine,
        IS_XCLAW_MODE ? "" : "Docs: https://docs.openclaw.ai/web/control-ui",
      ]
        .filter((l) => l !== "" && l !== undefined)
        .join("\n"),
      IS_XCLAW_MODE ? "Интерфейс управления" : "Control UI",
    );


  let controlUiOpened = false;
  let controlUiOpenHint: string | undefined;
  let seededInBackground = false;
  let hatchChoice: "tui" | "web" | "later" | null = null;
  let launchedTui = false;

  if (!opts.skipUi && gatewayProbe.ok) {
    const cmd = IS_XCLAW_MODE ? "xclaw" : "openclaw";

    await prompter.note(
      [
        IS_XCLAW_MODE ? "Это определяющее действие, которое делает вашего агента личностью." : "This is the defining action that makes your agent you.",
        IS_XCLAW_MODE ? "Пожалуйста, не торопитесь." : "Please take your time.",
        IS_XCLAW_MODE ? "Чем больше вы ему расскажете, тем лучше будет опыт общения." : "The more you tell it, the better the experience will be.",
        IS_XCLAW_MODE ? 'Мы отправим: "Проснись, мой друг!"' : 'We will send: "Wake up, my friend!"',
      ].join("\n"),
      IS_XCLAW_MODE ? "Запуск TUI (лучший вариант!)" : "Start TUI (best option!)",
    );

    const dirname = IS_XCLAW_MODE ? ".xclaw" : ".openclaw";
    const filename = IS_XCLAW_MODE ? "xclaw.json" : "openclaw.json";
    const envVar = IS_XCLAW_MODE ? "XCLAW_GATEWAY_TOKEN" : "OPENCLAW_GATEWAY_TOKEN";

    await prompter.note(
      [
        "Gateway token: shared auth for the Gateway + Control UI.",
        `Stored in: ~/${dirname}/${filename} (gateway.auth.token) or ${envVar}.`,
        `View token: ${formatCliCommand(`${IS_XCLAW_MODE ? "xlaw" : "openclaw"} config get gateway.auth.token`)}`,
        `Generate token: ${formatCliCommand(`${IS_XCLAW_MODE ? "xlaw" : "openclaw"} doctor --generate-gateway-token`)}`,
        "Web UI stores a copy in this browser's localStorage (openclaw.control.settings.v1).",
        `Open the dashboard anytime: ${formatCliCommand(`${IS_XCLAW_MODE ? "xlaw" : "openclaw"} dashboard --no-open`)}`,
        "If prompted: paste the token into Control UI settings (or use the tokenized dashboard URL).",
      ].join("\n"),
      "Token",
    );

    hatchChoice = await prompter.select({
      message: IS_XCLAW_MODE ? "Как вы хотите активировать вашего бота?" : "How do you want to hatch your bot?",
      options: [
        { value: "tui", label: IS_XCLAW_MODE ? "Активировать в TUI (рекомендуется)" : "Hatch in TUI (recommended)" },
        { value: "web", label: IS_XCLAW_MODE ? "Открыть Web UI" : "Open the Web UI" },
        { value: "later", label: IS_XCLAW_MODE ? "Сделать это позже" : "Do this later" },
      ],
      initialValue: "tui",
    });

    if (hatchChoice === "tui") {
      restoreTerminalState("pre-onboarding tui", { resumeStdinIfPaused: true });
      await runTui({
        url: links.wsUrl,
        token: settings.authMode === "token" ? settings.gatewayToken : undefined,
        password: settings.authMode === "password" ? nextConfig.gateway?.auth?.password : "",
        // Safety: onboarding TUI should not auto-deliver to lastProvider/lastTo.
        deliver: false,
        message: hasBootstrap ? (IS_XCLAW_MODE ? "Проснись, мой друг!" : "Wake up, my friend!") : undefined,
      });
      launchedTui = true;
    } else if (hatchChoice === "web") {
      const browserSupport = await detectBrowserOpenSupport();
      if (browserSupport.ok) {
        controlUiOpened = await openUrl(authedUrl);
        if (!controlUiOpened) {
          controlUiOpenHint = formatControlUiSshHint({
            port: settings.port,
            basePath: controlUiBasePath,
            token: settings.authMode === "token" ? settings.gatewayToken : undefined,
          });
        }
      } else {
        controlUiOpenHint = formatControlUiSshHint({
          port: settings.port,
          basePath: controlUiBasePath,
          token: settings.authMode === "token" ? settings.gatewayToken : undefined,
        });
      }
      await prompter.note(
        [
          IS_XCLAW_MODE ? `Ссылка на панель (с токеном): ${authedUrl}` : `Dashboard link (with token): ${authedUrl}`,
          controlUiOpened
            ? (IS_XCLAW_MODE ? "Открыто в вашем браузере. Используйте эту вкладку для управления XClaw." : "Opened in your browser. Keep that tab to control OpenClaw.")
            : (IS_XCLAW_MODE ? "Скопируйте/вставьте этот URL в браузер для управления XClaw." : "Copy/paste this URL in a browser on this machine to control OpenClaw."),
          controlUiOpenHint,
        ]
          .filter(Boolean)
          .join("\n"),
        IS_XCLAW_MODE ? "Панель готова" : "Dashboard ready",
      );
    } else {
      await prompter.note(
        IS_XCLAW_MODE
          ? `Когда будете готовы: ${formatCliCommand("xclaw dashboard --no-open")}`
          : `When you're ready: ${formatCliCommand("openclaw dashboard --no-open")}`,
        IS_XCLAW_MODE ? "Позже" : "Later",
      );
    }
  } else if (opts.skipUi) {
    await prompter.note(
      IS_XCLAW_MODE ? "Пропуск настройки UI." : "Skipping Control UI/TUI prompts.",
      "Control UI",
    );
  }

  await prompter.note(
    [
      IS_XCLAW_MODE ? "Сделайте бэкап рабочей области агента." : "Back up your agent workspace.",
      IS_XCLAW_MODE ? "" : "Docs: https://docs.openclaw.ai/concepts/agent-workspace",
    ]
      .filter((l) => l !== "")
      .join("\n"),
    IS_XCLAW_MODE ? "Бэкап" : "Workspace backup",
  );

  await prompter.note(
    IS_XCLAW_MODE
      ? "Запуск агентов на вашем компьютере связан с рисками — защитите вашу систему: https://docs.openclaw.ai/security"
      : "Running agents on your computer is risky — harden your setup: https://docs.openclaw.ai/security",
    IS_XCLAW_MODE ? "Безопасность" : "Security",
  );

  await setupOnboardingShellCompletion({ flow, prompter });

  const shouldOpenControlUi =
    !opts.skipUi &&
    settings.authMode === "token" &&
    Boolean(settings.gatewayToken) &&
    hatchChoice === null;
  if (shouldOpenControlUi) {
    const browserSupport = await detectBrowserOpenSupport();
    if (browserSupport.ok) {
      controlUiOpened = await openUrl(authedUrl);
      if (!controlUiOpened) {
        controlUiOpenHint = formatControlUiSshHint({
          port: settings.port,
          basePath: controlUiBasePath,
          token: settings.gatewayToken,
        });
      }
    } else {
      controlUiOpenHint = formatControlUiSshHint({
        port: settings.port,
        basePath: controlUiBasePath,
        token: settings.gatewayToken,
      });
    }

    await prompter.note(
      [
        IS_XCLAW_MODE ? `Ссылка на панель (с токеном): ${authedUrl}` : `Dashboard link (with token): ${authedUrl}`,
        controlUiOpened
          ? (IS_XCLAW_MODE ? "Открыто в вашем браузере. Используйте эту вкладку для управления XClaw." : "Opened in your browser. Keep that tab to control OpenClaw.")
          : (IS_XCLAW_MODE ? "Скопируйте/вставьте этот URL в браузер для управления XClaw." : "Copy/paste this URL in a browser on this machine to control OpenClaw."),
        controlUiOpenHint,
      ]
        .filter(Boolean)
        .join("\n"),
      IS_XCLAW_MODE ? "Панель готова" : "Dashboard ready",
    );
  }

  const webSearchKey = (nextConfig.tools?.web?.search?.apiKey ?? "").trim();
  const webSearchEnv = (process.env.BRAVE_API_KEY ?? "").trim();
  const hasWebSearchKey = Boolean(webSearchKey || webSearchEnv);
  await prompter.note(
    hasWebSearchKey
      ? [
          IS_XCLAW_MODE ? "Поиск в сети включен, ваш агент может искать информацию онлайн." : "Web search is enabled, so your agent can look things up online when needed.",
          "",
          webSearchKey
            ? (IS_XCLAW_MODE ? "API ключ: сохранен в конфиге (tools.web.search.apiKey)." : "API key: stored in config (tools.web.search.apiKey).")
            : (IS_XCLAW_MODE ? "API ключ: используется переменная BRAVE_API_KEY." : "API key: provided via BRAVE_API_KEY env var (Gateway environment)."),
          IS_XCLAW_MODE ? "" : "Docs: https://docs.openclaw.ai/tools/web",
        ]
          .filter((l) => l !== "")
          .join("\n")
      : [
          IS_XCLAW_MODE ? "Если вы хотите, чтобы агент искал в сети, нужен API ключ." : "If you want your agent to be able to search the web, you’ll need an API key.",
          "",
          IS_XCLAW_MODE ? "XClaw использует Brave Search. Без ключа поиск работать не будет." : "OpenClaw uses Brave Search for the `web_search` tool. Without a Brave Search API key, web search won’t work.",
          "",
          IS_XCLAW_MODE ? "Настройте интерактивно:" : "Set it up interactively:",
          `- Запустите: ${formatCliCommand(`${IS_XCLAW_MODE ? "xclaw" : "openclaw"} configure --section web`)}`,
          IS_XCLAW_MODE ? "- Включите web_search и вставьте ваш Brave Search API ключ" : "- Enable web_search and paste your Brave Search API key",
          "",
          IS_XCLAW_MODE ? "Альтернатива: установите BRAVE_API_KEY в переменные окружения." : "Alternative: set BRAVE_API_KEY in the Gateway environment (no config changes).",
          IS_XCLAW_MODE ? "" : "Docs: https://docs.openclaw.ai/tools/web",
        ]
          .filter((l) => l !== "")
          .join("\n"),
    IS_XCLAW_MODE ? "Поиск в сети (опционально)" : "Web search (optional)",
  );

  await prompter.note(
    IS_XCLAW_MODE ? "Что дальше: https://openclaw.ai/showcase" : 'What now: https://openclaw.ai/showcase ("What People Are Building").',
    IS_XCLAW_MODE ? "Что дальше" : "What now",
  );

  await prompter.outro(
    controlUiOpened
      ? (IS_XCLAW_MODE ? "Настройка завершена. Панель управления открыта." : "Onboarding complete. Dashboard opened; keep that tab to control OpenClaw.")
      : seededInBackground
        ? (IS_XCLAW_MODE ? "Настройка завершена. Web UI готов к работе." : "Onboarding complete. Web UI seeded in the background; open it anytime with the dashboard link above.")
        : (IS_XCLAW_MODE ? "Настройка завершена. Используйте ссылку выше для управления XClaw." : "Onboarding complete. Use the dashboard link above to control OpenClaw."),
  );

  return { launchedTui };
}
