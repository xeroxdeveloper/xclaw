import { IS_XCLAW_MODE, isXClawMode } from "../xclaw/mode.js";
import { listChannelPlugins } from "../channels/plugins/index.js";
import type { ChannelId } from "../channels/plugins/types.js";
import { formatCliCommand } from "../cli/command-format.js";
import type { OpenClawConfig, GatewayBindMode } from "../config/config.js";
import { resolveGatewayAuth } from "../gateway/auth.js";
import { isLoopbackHost, resolveGatewayBindHost } from "../gateway/net.js";
import { resolveDmAllowState } from "../security/dm-policy-shared.js";
import { note } from "../terminal/note.js";
import { resolveDefaultChannelAccountContext } from "./channel-account-context.js";

export async function noteSecurityWarnings(cfg: OpenClawConfig) {
  const warnings: string[] = [];
  const auditHint = IS_XCLAW_MODE 
    ? `- Выполните: ${formatCliCommand("xclaw security audit --deep")}`
    : `- Run: ${formatCliCommand("openclaw security audit --deep")}`;

  if (cfg.approvals?.exec?.enabled === false) {
    warnings.push(
      IS_XCLAW_MODE
        ? "- Заметка: approvals.exec.enabled=false отключает только пересылку одобрений."
        : "- Note: approvals.exec.enabled=false disables approval forwarding only.",
      IS_XCLAW_MODE
        ? "  Ограничение выполнения shell-команд все еще берется из ~/.xclaw/exec-approvals.json."
        : "  Host exec gating still comes from ~/.openclaw/exec-approvals.json.",
      IS_XCLAW_MODE
        ? `  Проверьте политику командой: ${formatCliCommand("xclaw approvals get --gateway")}`
        : `  Check local policy with: ${formatCliCommand("openclaw approvals get --gateway")}`,
    );
  }

  // ===========================================
  // GATEWAY NETWORK EXPOSURE CHECK
  // ===========================================
  // Check for dangerous gateway binding configurations
  // that expose the gateway to network without proper auth

  const gatewayBind = (cfg.gateway?.bind ?? "loopback") as string;
  const customBindHost = cfg.gateway?.customBindHost?.trim();
  const bindModes: GatewayBindMode[] = ["auto", "lan", "loopback", "custom", "tailnet"];
  const bindMode = bindModes.includes(gatewayBind as GatewayBindMode)
    ? (gatewayBind as GatewayBindMode)
    : undefined;
  const resolvedBindHost = bindMode
    ? await resolveGatewayBindHost(bindMode, customBindHost)
    : "0.0.0.0";
  const isExposed = !isLoopbackHost(resolvedBindHost);

  const resolvedAuth = resolveGatewayAuth({
    authConfig: cfg.gateway?.auth,
    env: process.env,
    tailscaleMode: cfg.gateway?.tailscale?.mode ?? "off",
  });
  const authToken = resolvedAuth.token?.trim() ?? "";
  const authPassword = resolvedAuth.password?.trim() ?? "";
  const hasToken = authToken.length > 0;
  const hasPassword = authPassword.length > 0;
  const hasSharedSecret =
    (resolvedAuth.mode === "token" && hasToken) ||
    (resolvedAuth.mode === "password" && hasPassword);
  const bindDescriptor = `"${gatewayBind}" (${resolvedBindHost})`;
  const saferRemoteAccessLines = IS_XCLAW_MODE
    ? [
        "  Безопасный удаленный доступ: оставьте привязку loopback и используйте Tailscale или SSH туннель.",
        "  Пример туннеля: ssh -N -L 18789:127.0.0.1:18789 user@gateway-host",
      ]
    : [
        "  Safer remote access: keep bind loopback and use Tailscale Serve/Funnel or an SSH tunnel.",
        "  Example tunnel: ssh -N -L 18789:127.0.0.1:18789 user@gateway-host",
        "  Docs: https://docs.openclaw.ai/gateway/remote",
      ];

  if (isExposed) {
    if (!hasSharedSecret) {
      const authFixLines =
        resolvedAuth.mode === "password"
          ? [
              `  Исправьте: запустите ${formatCliCommand(IS_XCLAW_MODE ? "xclaw configure" : "openclaw configure")} для установки пароля`,
              `  Или переключитесь на токен: ${formatCliCommand(IS_XCLAW_MODE ? "xclaw config set gateway.auth.mode token" : "openclaw config set gateway.auth.mode token")}`,
            ]
          : [
              `  Исправьте: запустите ${formatCliCommand(IS_XCLAW_MODE ? "xclaw doctor --fix" : "openclaw doctor --fix")} для генерации токена`,
              `  Или установите напрямую: ${formatCliCommand(
                IS_XCLAW_MODE ? "xclaw config set gateway.auth.mode token" : "openclaw config set gateway.auth.mode token",
              )}`,
            ];
      warnings.push(
        IS_XCLAW_MODE 
          ? `- КРИТИЧЕСКИ: Шлюз привязан к ${bindDescriptor} без аутентификации.`
          : `- CRITICAL: Gateway bound to ${bindDescriptor} without authentication.`,
        IS_XCLAW_MODE
          ? `  Любой пользователь в вашей сети (или интернете при пробросе порта) может полностью управлять вашим агентом.`
          : `  Anyone on your network (or internet if port-forwarded) can fully control your agent.`,
        `  Исправьте: ${formatCliCommand(IS_XCLAW_MODE ? "xclaw config set gateway.bind loopback" : "openclaw config set gateway.bind loopback")}`,
        ...saferRemoteAccessLines,
        ...authFixLines,
      );
    } else {
      // Auth is configured, but still warn about network exposure
      warnings.push(
        IS_XCLAW_MODE
          ? `- ВНИМАНИЕ: Шлюз привязан к ${bindDescriptor} (доступен по сети).`
          : `- WARNING: Gateway bound to ${bindDescriptor} (network-accessible).`,
        IS_XCLAW_MODE
          ? `  Убедитесь, что ваши учетные данные сильные и не скомпрометированы.`
          : `  Ensure your auth credentials are strong and not exposed.`,
        ...saferRemoteAccessLines,
      );
    }
  }

  const warnDmPolicy = async (params: {
    label: string;
    provider: ChannelId;
    accountId: string;
    dmPolicy: string;
    allowFrom?: Array<string | number> | null;
    policyPath?: string;
    allowFromPath: string;
    approveHint: string;
    normalizeEntry?: (raw: string) => string;
  }) => {
    const dmPolicy = params.dmPolicy;
    const policyPath = params.policyPath ?? `${params.allowFromPath}policy`;
    const { hasWildcard, allowCount, isMultiUserDm } = await resolveDmAllowState({
      provider: params.provider,
      accountId: params.accountId,
      allowFrom: params.allowFrom,
      normalizeEntry: params.normalizeEntry,
    });
    const dmScope = cfg.session?.dmScope ?? "main";

    if (dmPolicy === "open") {
      const allowFromPath = `${params.allowFromPath}allowFrom`;
      warnings.push(
        IS_XCLAW_MODE
          ? `- ${params.label} ЛС: ОТКРЫТО (${policyPath}="open"). Любой может писать боту.`
          : `- ${params.label} DMs: OPEN (${policyPath}="open"). Anyone can DM it.`,
      );
      if (!hasWildcard) {
        warnings.push(
          IS_XCLAW_MODE
            ? `- ${params.label} ЛС: конфиг невалиден — "open" требует наличия "*" в ${allowFromPath}.`
            : `- ${params.label} DMs: config invalid — "open" requires ${allowFromPath} to include "*".`,
        );
      }
    }

    if (dmPolicy === "disabled") {
      warnings.push(
        IS_XCLAW_MODE
          ? `- ${params.label} ЛС: отключено (${policyPath}="disabled").`
          : `- ${params.label} DMs: disabled (${policyPath}="disabled").`,
      );
      return;
    }

    if (dmPolicy !== "open" && allowCount === 0) {
      warnings.push(
        IS_XCLAW_MODE
          ? `- ${params.label} ЛС: заблокировано (${policyPath}="${dmPolicy}") без белого списка; неизвестные отправители будут блокироваться или получать код сопряжения.`
          : `- ${params.label} DMs: locked (${policyPath}="${dmPolicy}") with no allowlist; unknown senders will be blocked / get a pairing code.`,
      );
      warnings.push(`  ${params.approveHint}`);
    }

    if (dmScope === "main" && isMultiUserDm) {
      warnings.push(
        IS_XCLAW_MODE
          ? `- ${params.label} ЛС: несколько отправителей делят одну сессию; выполните: ${formatCliCommand('xclaw config set session.dmScope "per-channel-peer"')} для изоляции.`
          : `- ${params.label} DMs: multiple senders share the main session; run: ` +
            formatCliCommand('openclaw config set session.dmScope "per-channel-peer"') +
            ' (or "per-account-channel-peer" for multi-account channels) to isolate sessions.',
      );
    }
  };

  for (const plugin of listChannelPlugins()) {
    if (!plugin.security) {
      continue;
    }
    const { defaultAccountId, account, enabled, configured } =
      await resolveDefaultChannelAccountContext(plugin, cfg);
    if (!enabled) {
      continue;
    }
    if (!configured) {
      continue;
    }
    const dmPolicy = plugin.security.resolveDmPolicy?.({
      cfg,
      accountId: defaultAccountId,
      account,
    });
    if (dmPolicy) {
      await warnDmPolicy({
        label: plugin.meta.label ?? plugin.id,
        provider: plugin.id,
        accountId: defaultAccountId,
        dmPolicy: dmPolicy.policy,
        allowFrom: dmPolicy.allowFrom,
        policyPath: dmPolicy.policyPath,
        allowFromPath: dmPolicy.allowFromPath,
        approveHint: dmPolicy.approveHint,
        normalizeEntry: dmPolicy.normalizeEntry,
      });
    }
    if (plugin.security.collectWarnings) {
      const extra = await plugin.security.collectWarnings({
        cfg,
        accountId: defaultAccountId,
        account,
      });
      if (extra?.length) {
        warnings.push(...extra);
      }
    }
  }

  const lines = warnings.length > 0 
    ? warnings 
    : [IS_XCLAW_MODE ? "- Проблем с безопасностью каналов не обнаружено." : "- No channel security warnings detected."];
  lines.push(auditHint);
  note(lines.join("\n"), IS_XCLAW_MODE ? "Безопасность" : "Security");
}
