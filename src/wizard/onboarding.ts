import { formatCliCommand } from "../cli/command-format.js";
import { isXClawMode } from "../xclaw/mode.js";
import type {
  GatewayAuthChoice,
  OnboardMode,
  OnboardOptions,
  ResetScope,
} from "../commands/onboard-types.js";
import type { OpenClawConfig } from "../config/config.js";
import {
  DEFAULT_GATEWAY_PORT,
  readConfigFileSnapshot,
  resolveGatewayPort,
  writeConfigFile,
} from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { resolveUserPath } from "../utils.js";
import { t } from "../xclaw/i18n.js";
import type { QuickstartGatewayDefaults, WizardFlow } from "./onboarding.types.js";
import { WizardCancelledError, type WizardPrompter } from "./prompts.js";

async function requireRiskAcknowledgement(params: {
  opts: OnboardOptions;
  prompter: WizardPrompter;
}) {
  if (params.opts.acceptRisk === true) {
    return;
  }

  await params.prompter.note(
    isXClawMode()
      ? [
          "Предупреждение о безопасности — пожалуйста, прочтите.",
          "",
          "XClaw — это форк OpenClaw, находится в стадии беты. Ожидайте острых углов.",
          "По умолчанию XClaw — это персональный агент: одна граница доверенного оператора.",
          "Этот бот может читать файлы и выполнять действия, если включены инструменты.",
          "Плохой промпт может обманом заставить его делать небезопасные вещи.",
          "",
          "XClaw не является враждебной многопользовательской границей по умолчанию.",
          "Если несколько пользователей могут писать одному агенту с включенными инструментами, они разделяют эти полномочия.",
          "",
          "Если вам неуютно с настройкой безопасности и контролем доступа, не запускайте XClaw.",
          "Попросите кого-нибудь опытного помочь перед включением инструментов или открытием доступа в интернет.",
          "",
          "Рекомендуемая база:",
          "- Привязка/белые списки + фильтрация упоминаний.",
          "- Многопользовательский/общий ящик: разделение границ доверия.",
          "- Песочница + инструменты с минимальными привилегиями.",
          "- Храните секреты вне досягаемости файловой системы агента.",
          "- Используйте самую сильную доступную модель для любого бота с инструментами.",
          "",
          "Запускайте регулярно:",
          "xclaw security audit --deep",
          "xclaw security audit --fix",
        ].join("\n")
      : [
          "Security warning — please read.",
          "",
          "OpenClaw is a hobby project and still in beta. Expect sharp edges.",
          "By default, OpenClaw is a personal agent: one trusted operator boundary.",
          "This bot can read files and run actions if tools are enabled.",
          "A bad prompt can trick it into doing unsafe things.",
          "",
          "OpenClaw is not a hostile multi-tenant boundary by default.",
          "If multiple users can message one tool-enabled agent, they share that delegated tool authority.",
          "",
          "If you’re not comfortable with security hardening and access control, don’t run OpenClaw.",
          "Ask someone experienced to help before enabling tools or exposing it to the internet.",
          "",
          "Recommended baseline:",
          "- Pairing/allowlists + mention gating.",
          "- Multi-user/shared inbox: split trust boundaries (separate gateway/credentials, ideally separate OS users/hosts).",
          "- Sandbox + least-privilege tools.",
          "- Shared inboxes: isolate DM sessions (`session.dmScope: per-channel-peer`) and keep tool access minimal.",
          "- Keep secrets out of the agent’s reachable filesystem.",
          "- Use the strongest available model for any bot with tools or untrusted inboxes.",
          "",
          "Run regularly:",
          "openclaw security audit --deep",
          "openclaw security audit --fix",
          "",
          "Must read: https://docs.openclaw.ai/gateway/security",
        ].join("\n"),
    isXClawMode() ? "Безопасность" : "Security",
  );


  const ok = await params.prompter.confirm({
    message: t("onboard.risk.message"),
    initialValue: false,
  });
  if (!ok) {
    throw new WizardCancelledError("risk not accepted");
  }
}

export async function runOnboardingWizard(
  opts: OnboardOptions,
  runtime: RuntimeEnv = defaultRuntime,
  prompter: WizardPrompter,
) {
  const onboardHelpers = await import("../commands/onboard-helpers.js");
  onboardHelpers.printWizardHeader(runtime);
  await prompter.intro(isXClawMode() ? "Настройка XClaw" : "OpenClaw onboarding");
  await requireRiskAcknowledgement({ opts, prompter });

  const snapshot = await readConfigFileSnapshot();
  let baseConfig: OpenClawConfig = snapshot.valid ? snapshot.config : {};

  if (snapshot.exists && !snapshot.valid) {
    await prompter.note(
      onboardHelpers.summarizeExistingConfig(baseConfig),
      t("onboard.invalid.config"),
    );
    if (snapshot.issues.length > 0) {
      await prompter.note(
        [
          ...snapshot.issues.map((iss) => `- ${iss.path}: ${iss.message}`),
          "",
          isXClawMode() ? "" : "Docs: https://docs.openclaw.ai/gateway/configuration",
        ]
          .filter((l) => l !== "")
          .join("\n"),
        t("onboard.config.issues"),
      );
    }
    await prompter.outro(
      t("onboard.config.invalid_outro", { cmd: formatCliCommand(isXClawMode() ? "xclaw doctor" : "openclaw doctor") }),
    );
    runtime.exit(1);
    return;
  }

  const quickstartHint = isXClawMode()
    ? `Настройте детали позже через ${formatCliCommand("xclaw configure")}.`
    : `Configure details later via ${formatCliCommand("openclaw configure")}.`;
  const manualHint = isXClawMode()
    ? "Настройка порта, сети, Tailscale и параметров аутентификации."
    : "Configure port, network, Tailscale, and auth options.";
  const explicitFlowRaw = opts.flow?.trim();
  const normalizedExplicitFlow = explicitFlowRaw === "manual" ? "advanced" : explicitFlowRaw;
  if (
    normalizedExplicitFlow &&
    normalizedExplicitFlow !== "quickstart" &&
    normalizedExplicitFlow !== "advanced"
  ) {
    runtime.error("Invalid --flow (use quickstart, manual, or advanced).");
    runtime.exit(1);
    return;
  }
  const explicitFlow: WizardFlow | undefined =
    normalizedExplicitFlow === "quickstart" || normalizedExplicitFlow === "advanced"
      ? normalizedExplicitFlow
      : undefined;
  let flow: WizardFlow =
    explicitFlow ??
    (await prompter.select({
      message: t("onboard.mode.message"),
      options: [
        { value: "quickstart", label: t("onboard.mode.quick"), hint: quickstartHint },
        { value: "advanced", label: t("onboard.mode.manual"), hint: manualHint },
      ],
      initialValue: "quickstart",
    }));

  if (opts.mode === "remote" && flow === "quickstart") {
    await prompter.note(
      isXClawMode()
        ? "Быстрый старт поддерживает только локальные шлюзы. Переключение в ручной режим."
        : "QuickStart only supports local gateways. Switching to Manual mode.",
      isXClawMode() ? "Быстрый старт" : "QuickStart",
    );
    flow = "advanced";
  }

  if (snapshot.exists) {
    await prompter.note(
      onboardHelpers.summarizeExistingConfig(baseConfig),
      isXClawMode() ? "Обнаружен существующий конфиг" : "Existing config detected",
    );

    const action = await prompter.select({
      message: t("onboard.config.handling"),
      options: [
        { value: "keep", label: t("onboard.config.keep") },
        { value: "modify", label: t("onboard.config.modify") },
        { value: "reset", label: t("onboard.config.reset") },
      ],
    });

    if (action === "reset") {
      const workspaceDefault =
        baseConfig.agents?.defaults?.workspace ?? onboardHelpers.DEFAULT_WORKSPACE;
      const resetScope = (await prompter.select({
        message: t("onboard.reset.scope"),
        options: [
          { value: "config", label: t("onboard.reset.config") },
          {
            value: "config+creds+sessions",
            label: t("onboard.reset.creds"),
          },
          {
            value: "full",
            label: t("onboard.reset.full"),
          },
        ],
      })) as ResetScope;
      await onboardHelpers.handleReset(resetScope, resolveUserPath(workspaceDefault), runtime);
      baseConfig = {};
    }
  }

  const quickstartGateway: QuickstartGatewayDefaults = (() => {
    const hasExisting =
      typeof baseConfig.gateway?.port === "number" ||
      baseConfig.gateway?.bind !== undefined ||
      baseConfig.gateway?.auth?.mode !== undefined ||
      baseConfig.gateway?.auth?.token !== undefined ||
      baseConfig.gateway?.auth?.password !== undefined ||
      baseConfig.gateway?.customBindHost !== undefined ||
      baseConfig.gateway?.tailscale?.mode !== undefined;

    const bindRaw = baseConfig.gateway?.bind;
    const bind =
      bindRaw === "loopback" ||
      bindRaw === "lan" ||
      bindRaw === "auto" ||
      bindRaw === "custom" ||
      bindRaw === "tailnet"
        ? bindRaw
        : "loopback";

    let authMode: GatewayAuthChoice = "token";
    if (
      baseConfig.gateway?.auth?.mode === "token" ||
      baseConfig.gateway?.auth?.mode === "password"
    ) {
      authMode = baseConfig.gateway.auth.mode;
    } else if (baseConfig.gateway?.auth?.token) {
      authMode = "token";
    } else if (baseConfig.gateway?.auth?.password) {
      authMode = "password";
    }

    const tailscaleRaw = baseConfig.gateway?.tailscale?.mode;
    const tailscaleMode =
      tailscaleRaw === "off" || tailscaleRaw === "serve" || tailscaleRaw === "funnel"
        ? tailscaleRaw
        : "off";

    return {
      hasExisting,
      port: resolveGatewayPort(baseConfig),
      bind,
      authMode,
      tailscaleMode,
      token: baseConfig.gateway?.auth?.token,
      password: baseConfig.gateway?.auth?.password,
      customBindHost: baseConfig.gateway?.customBindHost,
      tailscaleResetOnExit: baseConfig.gateway?.tailscale?.resetOnExit ?? false,
    };
  })();

  if (flow === "quickstart") {
    const formatBind = (value: "loopback" | "lan" | "auto" | "custom" | "tailnet") => {
      if (value === "loopback") {
        return isXClawMode() ? "Локально (127.0.0.1)" : "Loopback (127.0.0.1)";
      }
      if (value === "lan") {
        return "LAN";
      }
      if (value === "custom") {
        return isXClawMode() ? "Свой IP" : "Custom IP";
      }
      if (value === "tailnet") {
        return "Tailnet (Tailscale IP)";
      }
      return isXClawMode() ? "Авто" : "Auto";
    };
    const formatAuth = (value: GatewayAuthChoice) => {
      if (value === "token") {
        return isXClawMode() ? "Токен (по умолчанию)" : "Token (default)";
      }
      return isXClawMode() ? "Пароль" : "Password";
    };
    const formatTailscale = (value: "off" | "serve" | "funnel") => {
      if (value === "off") {
        return isXClawMode() ? "Выкл" : "Off";
      }
      if (value === "serve") {
        return "Serve";
      }
      return "Funnel";
    };
    const quickstartLines = quickstartGateway.hasExisting
      ? [
          isXClawMode()
            ? "Сохранение текущих настроек шлюза:"
            : "Keeping your current gateway settings:",
          `${isXClawMode() ? "Порт" : "Gateway port"}: ${quickstartGateway.port}`,
          `${isXClawMode() ? "Привязка" : "Gateway bind"}: ${formatBind(quickstartGateway.bind)}`,
          ...(quickstartGateway.bind === "custom" && quickstartGateway.customBindHost
            ? [
                `${isXClawMode() ? "Свой IP шлюза" : "Gateway custom IP"}: ${quickstartGateway.customBindHost}`,
              ]
            : []),
          `${isXClawMode() ? "Аутентификация" : "Gateway auth"}: ${formatAuth(quickstartGateway.authMode)}`,
          `${isXClawMode() ? "Tailscale" : "Tailscale exposure"}: ${formatTailscale(quickstartGateway.tailscaleMode)}`,
          isXClawMode() ? "Переход к настройке каналов." : "Direct to chat channels.",
        ]
      : [
          `${isXClawMode() ? "Порт шлюза" : "Gateway port"}: ${DEFAULT_GATEWAY_PORT}`,
          isXClawMode() ? "Привязка: Локально (127.0.0.1)" : "Gateway bind: Loopback (127.0.0.1)",
          isXClawMode() ? "Аутентификация: Токен (по умолчанию)" : "Gateway auth: Token (default)",
          isXClawMode() ? "Tailscale: Выкл" : "Tailscale exposure: Off",
          isXClawMode() ? "Переход к настройке каналов." : "Direct to chat channels.",
        ];
    await prompter.note(quickstartLines.join("\n"), isXClawMode() ? "Быстрый старт" : "QuickStart");
  }

  const localPort = resolveGatewayPort(baseConfig);
  const localUrl = `ws://127.0.0.1:${localPort}`;
  const localProbe = await onboardHelpers.probeGatewayReachable({
    url: localUrl,
    token: baseConfig.gateway?.auth?.token ?? process.env.OPENCLAW_GATEWAY_TOKEN,
    password: baseConfig.gateway?.auth?.password ?? process.env.OPENCLAW_GATEWAY_PASSWORD,
  });
  const remoteUrl = baseConfig.gateway?.remote?.url?.trim() ?? "";
  const remoteProbe = remoteUrl
    ? await onboardHelpers.probeGatewayReachable({
        url: remoteUrl,
        token: baseConfig.gateway?.remote?.token,
      })
    : null;

  const mode =
    opts.mode ??
    (flow === "quickstart"
      ? "local"
      : ((await prompter.select({
          message: isXClawMode() ? "Что вы хотите настроить?" : "What do you want to set up?",
          options: [
            {
              value: "local",
              label: isXClawMode() ? "Локальный шлюз (на этой машине)" : "Local gateway (this machine)",
              hint: localProbe.ok
                ? isXClawMode()
                  ? `Шлюз доступен (${localUrl})`
                  : `Gateway reachable (${localUrl})`
                : isXClawMode()
                  ? `Шлюз не обнаружен (${localUrl})`
                  : `No gateway detected (${localUrl})`,
            },
            {
              value: "remote",
              label: isXClawMode() ? "Удаленный шлюз (только информация)" : "Remote gateway (info-only)",
              hint: !remoteUrl
                ? isXClawMode()
                  ? "Удаленный URL еще не настроен"
                  : "No remote URL configured yet"
                : remoteProbe?.ok
                  ? isXClawMode()
                    ? `Шлюз доступен (${remoteUrl})`
                    : `Gateway reachable (${remoteUrl})`
                  : isXClawMode()
                    ? `Настроен, но недоступен (${remoteUrl})`
                    : `Configured but unreachable (${remoteUrl})`,
            },
          ],
        })) as OnboardMode));

  if (mode === "remote") {
    const { promptRemoteGatewayConfig } = await import("../commands/onboard-remote.js");
    const { logConfigUpdated } = await import("../config/logging.js");
    let nextConfig = await promptRemoteGatewayConfig(baseConfig, prompter);
    nextConfig = onboardHelpers.applyWizardMetadata(nextConfig, { command: "onboard", mode });
    await writeConfigFile(nextConfig);
    logConfigUpdated(runtime);
    await prompter.outro(isXClawMode() ? "Удаленный шлюз настроен." : "Remote gateway configured.");
    return;
  }

  const workspaceInput =
    opts.workspace ??
    (flow === "quickstart"
      ? (baseConfig.agents?.defaults?.workspace ?? onboardHelpers.DEFAULT_WORKSPACE)
      : await prompter.text({
          message: t("onboard.workspace.message"),
          initialValue: baseConfig.agents?.defaults?.workspace ?? onboardHelpers.DEFAULT_WORKSPACE,
        }));

  const workspaceDir = resolveUserPath(workspaceInput.trim() || onboardHelpers.DEFAULT_WORKSPACE);

  const { applyOnboardingLocalWorkspaceConfig } = await import("../commands/onboard-config.js");
  let nextConfig: OpenClawConfig = applyOnboardingLocalWorkspaceConfig(baseConfig, workspaceDir);

  const { ensureAuthProfileStore } = await import("../agents/auth-profiles.js");
  const { promptAuthChoiceGrouped } = await import("../commands/auth-choice-prompt.js");
  const { promptCustomApiConfig } = await import("../commands/onboard-custom.js");
  const { applyAuthChoice, resolvePreferredProviderForAuthChoice, warnIfModelConfigLooksOff } =
    await import("../commands/auth-choice.js");
  const { applyPrimaryModel, promptDefaultModel } = await import("../commands/model-picker.js");

  const authStore = ensureAuthProfileStore(undefined, {
    allowKeychainPrompt: false,
  });
  const authChoiceFromPrompt = opts.authChoice === undefined;
  const authChoice =
    opts.authChoice ??
    (await promptAuthChoiceGrouped({
      prompter,
      store: authStore,
      includeSkip: true,
    }));

  if (authChoice === "custom-api-key") {
    const customResult = await promptCustomApiConfig({
      prompter,
      runtime,
      config: nextConfig,
      secretInputMode: opts.secretInputMode,
    });
    nextConfig = customResult.config;
  } else if (authChoice !== "skip") {
    const authResult = await applyAuthChoice({
      authChoice,
      config: nextConfig,
      prompter,
      runtime,
      setDefaultModel: true,
      opts: {
        tokenProvider: opts.tokenProvider,
        token: opts.authChoice === "apiKey" && opts.token ? opts.token : undefined,
      },
    });
    nextConfig = authResult.config;
  }

  if (authChoiceFromPrompt && authChoice !== "custom-api-key" && authChoice !== "skip") {
    const modelSelection = await promptDefaultModel({
      config: nextConfig,
      prompter,
      allowKeep: true,
      ignoreAllowlist: true,
      includeVllm: true,
      preferredProvider: resolvePreferredProviderForAuthChoice(authChoice),
    });
    if (modelSelection.config) {
      nextConfig = modelSelection.config;
    }
    if (modelSelection.model) {
      nextConfig = applyPrimaryModel(nextConfig, modelSelection.model);
    }
  }

  await warnIfModelConfigLooksOff(nextConfig, prompter);

  if (isXClawMode()) {
    const ownerOnly = await prompter.confirm({
      message: "Отвечать только владельцу? (ownerOnly)",
      initialValue: true,
    });
    if (ownerOnly) {
      process.env.XCLAW_OWNER_ONLY = "1";
      // We should also persist this in config if possible.
      if (!nextConfig.xclaw) {
        nextConfig.xclaw = {};
      }
      nextConfig.xclaw.ownerOnly = true;
    }
  }

  const { configureGatewayForOnboarding } = await import("./onboarding.gateway-config.js");
  const gateway = await configureGatewayForOnboarding({
    flow,
    baseConfig,
    nextConfig,
    localPort,
    quickstartGateway,
    prompter,
    runtime,
  });
  nextConfig = gateway.nextConfig;
  const settings = gateway.settings;

  if (opts.skipChannels ?? opts.skipProviders) {
    await prompter.note(
      isXClawMode() ? "Пропуск настройки каналов." : "Skipping channel setup.",
      isXClawMode() ? "Каналы" : "Channels",
    );
  } else {
    const { listChannelPlugins } = await import("../channels/plugins/index.js");
    const { setupChannels } = await import("../commands/onboard-channels.js");
    const quickstartAllowFromChannels =
      flow === "quickstart"
        ? listChannelPlugins()
            .filter((plugin) => plugin.meta.quickstartAllowFrom)
            .map((plugin) => plugin.id)
        : [];
    nextConfig = await setupChannels(nextConfig, runtime, prompter, {
      allowSignalInstall: true,
      forceAllowFromChannels: quickstartAllowFromChannels,
      skipDmPolicyPrompt: flow === "quickstart",
      skipConfirm: flow === "quickstart",
      quickstartDefaults: flow === "quickstart",
    });
  }

  await writeConfigFile(nextConfig);
  const { logConfigUpdated } = await import("../config/logging.js");
  logConfigUpdated(runtime);
  await onboardHelpers.ensureWorkspaceAndSessions(workspaceDir, runtime, {
    skipBootstrap: Boolean(nextConfig.agents?.defaults?.skipBootstrap),
  });

  if (opts.skipSkills) {
    await prompter.note(
      isXClawMode() ? "Пропуск настройки навыков." : "Skipping skills setup.",
      isXClawMode() ? "Навыки" : "Skills",
    );
  } else {
    const { setupSkills } = await import("../commands/onboard-skills.js");
    nextConfig = await setupSkills(nextConfig, workspaceDir, runtime, prompter);
  }

  // Setup hooks (session memory on /new)
  const { setupInternalHooks } = await import("../commands/onboard-hooks.js");
  nextConfig = await setupInternalHooks(nextConfig, runtime, prompter);

  nextConfig = onboardHelpers.applyWizardMetadata(nextConfig, { command: "onboard", mode });
  await writeConfigFile(nextConfig);

  const { finalizeOnboardingWizard } = await import("./onboarding.finalize.js");
  const { launchedTui } = await finalizeOnboardingWizard({
    flow,
    opts,
    baseConfig,
    nextConfig,
    workspaceDir,
    settings,
    prompter,
    runtime,
  });
  if (launchedTui) {
    return;
  }
}
