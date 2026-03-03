import { IS_XCLAW_MODE, isXClawMode } from "../xclaw/mode.js";
import { formatCliCommand } from "../cli/command-format.js";
import { withProgress } from "../cli/progress.js";
import { loadConfig, resolveGatewayPort } from "../config/config.js";
import { buildGatewayConnectionDetails, callGateway } from "../gateway/call.js";
import { info } from "../globals.js";
import { formatTimeAgo } from "../infra/format-time/format-relative.ts";
import type { HeartbeatEventPayload } from "../infra/heartbeat-events.js";
import { formatUsageReportLines, loadProviderUsageSummary } from "../infra/provider-usage.js";
import { normalizeUpdateChannel, resolveUpdateChannelDisplay } from "../infra/update-channels.js";
import { formatGitInstallLabel } from "../infra/update-check.js";
import {
  resolveMemoryCacheSummary,
  resolveMemoryFtsState,
  resolveMemoryVectorState,
  type Tone,
} from "../memory/status-format.js";
import type { RuntimeEnv } from "../runtime.js";
import { runSecurityAudit } from "../security/audit.js";
import { renderTable } from "../terminal/table.js";
import { theme } from "../terminal/theme.js";
import { formatHealthChannelLines, type HealthSummary } from "./health.js";
import { resolveControlUiLinks } from "./onboard-helpers.js";
import { statusAllCommand } from "./status-all.js";
import { formatGatewayAuthUsed } from "./status-all/format.js";
import { getDaemonStatusSummary, getNodeDaemonStatusSummary } from "./status.daemon.js";
import {
  formatDuration,
  formatKTokens,
  formatTokensCompact,
  shortenText,
} from "./status.format.js";
import { resolveGatewayProbeAuth } from "./status.gateway-probe.js";
import { scanStatus } from "./status.scan.js";
import {
  formatUpdateAvailableHint,
  formatUpdateOneLiner,
  resolveUpdateAvailability,
} from "./status.update.js";

function resolvePairingRecoveryContext(params: {
  error?: string | null;
  closeReason?: string | null;
}): { requestId: string | null } | null {
  const sanitizeRequestId = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    // Keep CLI guidance injection-safe: allow only compact id characters.
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(trimmed)) {
      return null;
    }
    return trimmed;
  };
  const source = [params.error, params.closeReason]
    .filter((part) => typeof part === "string" && part.trim().length > 0)
    .join(" ");
  if (!source || !/pairing required/i.test(source)) {
    return null;
  }
  const requestIdMatch = source.match(/requestId:\s*([^\s)]+)/i);
  const requestId =
    requestIdMatch && requestIdMatch[1] ? sanitizeRequestId(requestIdMatch[1]) : null;
  return { requestId: requestId || null };
}

export async function statusCommand(
  opts: {
    json?: boolean;
    deep?: boolean;
    usage?: boolean;
    timeoutMs?: number;
    verbose?: boolean;
    all?: boolean;
  },
  runtime: RuntimeEnv,
) {
  if (opts.all && !opts.json) {
    await statusAllCommand(runtime, { timeoutMs: opts.timeoutMs });
    return;
  }

  const [scan, securityAudit] = opts.json
    ? await Promise.all([
        scanStatus({ json: opts.json, timeoutMs: opts.timeoutMs, all: opts.all }, runtime),
        runSecurityAudit({
          config: loadConfig(),
          deep: false,
          includeFilesystem: true,
          includeChannelSecurity: true,
        }),
      ])
    : [
        await scanStatus({ json: opts.json, timeoutMs: opts.timeoutMs, all: opts.all }, runtime),
        await withProgress(
          {
            label: "Running security audit…",
            indeterminate: true,
            enabled: true,
          },
          async () =>
            await runSecurityAudit({
              config: loadConfig(),
              deep: false,
              includeFilesystem: true,
              includeChannelSecurity: true,
            }),
        ),
      ];
  const {
    cfg,
    osSummary,
    tailscaleMode,
    tailscaleDns,
    tailscaleHttpsUrl,
    update,
    gatewayConnection,
    remoteUrlMissing,
    gatewayMode,
    gatewayProbe,
    gatewayReachable,
    gatewaySelf,
    channelIssues,
    agentStatus,
    channels,
    summary,
    memory,
    memoryPlugin,
  } = scan;

  const usage = opts.usage
    ? await withProgress(
        {
          label: "Fetching usage snapshot…",
          indeterminate: true,
          enabled: opts.json !== true,
        },
        async () => await loadProviderUsageSummary({ timeoutMs: opts.timeoutMs }),
      )
    : undefined;
  const health: HealthSummary | undefined = opts.deep
    ? await withProgress(
        {
          label: "Checking gateway health…",
          indeterminate: true,
          enabled: opts.json !== true,
        },
        async () =>
          await callGateway<HealthSummary>({
            method: "health",
            params: { probe: true },
            timeoutMs: opts.timeoutMs,
          }),
      )
    : undefined;
  const lastHeartbeat =
    opts.deep && gatewayReachable
      ? await callGateway<HeartbeatEventPayload | null>({
          method: "last-heartbeat",
          params: {},
          timeoutMs: opts.timeoutMs,
        }).catch(() => null)
      : null;

  const configChannel = normalizeUpdateChannel(cfg.update?.channel);
  const channelInfo = resolveUpdateChannelDisplay({
    configChannel,
    installKind: update.installKind,
    gitTag: update.git?.tag ?? null,
    gitBranch: update.git?.branch ?? null,
  });

  if (opts.json) {
    const [daemon, nodeDaemon] = await Promise.all([
      getDaemonStatusSummary(),
      getNodeDaemonStatusSummary(),
    ]);
    runtime.log(
      JSON.stringify(
        {
          ...summary,
          os: osSummary,
          update,
          updateChannel: channelInfo.channel,
          updateChannelSource: channelInfo.source,
          memory,
          memoryPlugin,
          gateway: {
            mode: gatewayMode,
            url: gatewayConnection.url,
            urlSource: gatewayConnection.urlSource,
            misconfigured: remoteUrlMissing,
            reachable: gatewayReachable,
            connectLatencyMs: gatewayProbe?.connectLatencyMs ?? null,
            self: gatewaySelf,
            error: gatewayProbe?.error ?? null,
          },
          gatewayService: daemon,
          nodeService: nodeDaemon,
          agents: agentStatus,
          securityAudit,
          ...(health || usage || lastHeartbeat ? { health, usage, lastHeartbeat } : {}),
        },
        null,
        2,
      ),
    );
    return;
  }

  const rich = true;
  const muted = (value: string) => (rich ? theme.muted(value) : value);
  const ok = (value: string) => (rich ? theme.success(value) : value);
  const warn = (value: string) => (rich ? theme.warn(value) : value);

  if (opts.verbose) {
    const details = buildGatewayConnectionDetails();
    runtime.log(info(IS_XCLAW_MODE ? "Подключение к шлюзу:" : "Gateway connection:"));
    for (const line of details.message.split("\n")) {
      runtime.log(`  ${line}`);
    }
    runtime.log("");
  }

  const tableWidth = Math.max(60, (process.stdout.columns ?? 120) - 1);

  const dashboard = (() => {
    const controlUiEnabled = cfg.gateway?.controlUi?.enabled ?? true;
    if (!controlUiEnabled) {
      return "disabled";
    }
    const links = resolveControlUiLinks({
      port: resolveGatewayPort(cfg),
      bind: cfg.gateway?.bind,
      customBindHost: cfg.gateway?.customBindHost,
      basePath: cfg.gateway?.controlUi?.basePath,
    });
    return links.httpUrl;
  })();

  const gatewayValue = (() => {
    const target = remoteUrlMissing
      ? `fallback ${gatewayConnection.url}`
      : `${gatewayConnection.url}${gatewayConnection.urlSource ? ` (${gatewayConnection.urlSource})` : ""}`;
    const reach = remoteUrlMissing
      ? warn("misconfigured (remote.url missing)")
      : gatewayReachable
        ? ok(`reachable ${formatDuration(gatewayProbe?.connectLatencyMs)}`)
        : warn(gatewayProbe?.error ? `unreachable (${gatewayProbe.error})` : "unreachable");
    const auth =
      gatewayReachable && !remoteUrlMissing
        ? ` · auth ${formatGatewayAuthUsed(resolveGatewayProbeAuth(cfg))}`
        : "";
    const self =
      gatewaySelf?.host || gatewaySelf?.version || gatewaySelf?.platform
        ? [
            gatewaySelf?.host ? gatewaySelf.host : null,
            gatewaySelf?.ip ? `(${gatewaySelf.ip})` : null,
            gatewaySelf?.version ? `app ${gatewaySelf.version}` : null,
            gatewaySelf?.platform ? gatewaySelf.platform : null,
          ]
            .filter(Boolean)
            .join(" ")
        : null;
    const suffix = self ? ` · ${self}` : "";
    return `${gatewayMode} · ${target} · ${reach}${auth}${suffix}`;
  })();
  const pairingRecovery = resolvePairingRecoveryContext({
    error: gatewayProbe?.error ?? null,
    closeReason: gatewayProbe?.close?.reason ?? null,
  });

  const agentsValue = (() => {
    const pending =
      agentStatus.bootstrapPendingCount > 0
        ? `${agentStatus.bootstrapPendingCount} ${IS_XCLAW_MODE ? "файл(ов)" : "bootstrap file"}${agentStatus.bootstrapPendingCount === 1 ? "" : IS_XCLAW_MODE ? "" : "s"} ${IS_XCLAW_MODE ? "настройки" : "present"}`
        : (IS_XCLAW_MODE ? "нет файлов настройки" : "no bootstrap files");
    const def = agentStatus.agents.find((a) => a.id === agentStatus.defaultId);
    const defActive = def?.lastActiveAgeMs != null ? formatTimeAgo(def.lastActiveAgeMs) : (IS_XCLAW_MODE ? "неизвестно" : "unknown");
    const defSuffix = def ? ` · дефолт ${def.id} активен ${defActive}` : "";
    return `${agentStatus.agents.length} · ${pending} · сессий ${agentStatus.totalSessions}${defSuffix}`;
  })();

  const [daemon, nodeDaemon] = await Promise.all([
    getDaemonStatusSummary(),
    getNodeDaemonStatusSummary(),
  ]);
  const daemonValue = (() => {
    if (daemon.installed === false) {
      return `${daemon.label} ${IS_XCLAW_MODE ? "не установлена" : "not installed"}`;
    }
    const installedPrefix = daemon.installed === true ? (IS_XCLAW_MODE ? "установлена · " : "installed · ") : "";
    return `${daemon.label} ${installedPrefix}${daemon.loadedText}${daemon.runtimeShort ? ` · ${daemon.runtimeShort}` : ""}`;
  })();
  const nodeDaemonValue = (() => {
    if (nodeDaemon.installed === false) {
      return `${nodeDaemon.label} ${IS_XCLAW_MODE ? "не установлена" : "not installed"}`;
    }
    const installedPrefix = nodeDaemon.installed === true ? (IS_XCLAW_MODE ? "установлена · " : "installed · ") : "";
    return `${nodeDaemon.label} ${installedPrefix}${nodeDaemon.loadedText}${nodeDaemon.runtimeShort ? ` · ${nodeDaemon.runtimeShort}` : ""}`;
  })();

  const defaults = summary.sessions.defaults;
  const defaultCtx = defaults.contextTokens
    ? ` (${formatKTokens(defaults.contextTokens)} ctx)`
    : "";
  const eventsValue =
    summary.queuedSystemEvents.length > 0 ? `${summary.queuedSystemEvents.length} ${IS_XCLAW_MODE ? "в очереди" : "queued"}` : (IS_XCLAW_MODE ? "нет" : "none");

  const probesValue = health ? ok(IS_XCLAW_MODE ? "включено" : "enabled") : muted(IS_XCLAW_MODE ? "пропущено (используйте --deep)" : "skipped (use --deep)");

  const heartbeatValue = (() => {
    const parts = summary.heartbeat.agents
      .map((agent) => {
        if (!agent.enabled || !agent.everyMs) {
          return `${IS_XCLAW_MODE ? "отключено" : "disabled"} (${agent.agentId})`;
        }
        const everyLabel = agent.every;
        return `${everyLabel} (${agent.agentId})`;
      })
      .filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : (IS_XCLAW_MODE ? "отключено" : "disabled");
  })();
  const lastHeartbeatValue = (() => {
    if (!opts.deep) {
      return null;
    }
    if (!gatewayReachable) {
      return warn(IS_XCLAW_MODE ? "недоступно" : "unavailable");
    }
    if (!lastHeartbeat) {
      return muted(IS_XCLAW_MODE ? "нет" : "none");
    }
    const age = formatTimeAgo(Date.now() - lastHeartbeat.ts);
    const channel = lastHeartbeat.channel ?? (IS_XCLAW_MODE ? "неизвестно" : "unknown");
    const accountLabel = lastHeartbeat.accountId ? `${IS_XCLAW_MODE ? "аккаунт" : "account"} ${lastHeartbeat.accountId}` : null;
    return [lastHeartbeat.status, `${age} ${IS_XCLAW_MODE ? "назад" : "ago"}`, channel, accountLabel].filter(Boolean).join(" · ");
  })();

  const storeLabel =
    summary.sessions.paths.length > 1
      ? `${summary.sessions.paths.length} ${IS_XCLAW_MODE ? "хранилищ" : "stores"}`
      : (summary.sessions.paths[0] ?? (IS_XCLAW_MODE ? "неизвестно" : "unknown"));

  const memoryValue = (() => {
    if (!memoryPlugin.enabled) {
      const suffix = memoryPlugin.reason ? ` (${memoryPlugin.reason})` : "";
      return muted(`${IS_XCLAW_MODE ? "отключено" : "disabled"}${suffix}`);
    }
    const mode = memoryPlugin.backend === "builtin" ? (IS_XCLAW_MODE ? "встроенная" : "builtin") : "qmd";
    const citations =
      memoryPlugin.citations === "on"
        ? (IS_XCLAW_MODE ? "цитаты" : "citations")
        : memoryPlugin.citations === "off"
          ? (IS_XCLAW_MODE ? "без цитат" : "no citations")
          : (IS_XCLAW_MODE ? "авто-цитаты" : "auto-citations");
    return `${mode} · ${citations}`;
  })();


  const updateAvailability = resolveUpdateAvailability(update);
  const updateLine = formatUpdateOneLiner(update).replace(/^Update:\s*/i, "");
  const channelLabel = channelInfo.label;
  const gitLabel = formatGitInstallLabel(update);

  const overviewRows = IS_XCLAW_MODE 
    ? [
        { Item: "Панель", Value: dashboard },
        { Item: "ОС", Value: `${osSummary.label} · node ${process.versions.node}` },
        {
          Item: "Tailscale",
          Value:
            tailscaleMode === "off"
              ? muted("выкл")
              : tailscaleDns && tailscaleHttpsUrl
                ? `${tailscaleMode} · ${tailscaleDns} · ${tailscaleHttpsUrl}`
                : warn(`${tailscaleMode} · magicdns неизвестен`),
        },
        { Item: "Канал", Value: channelLabel },
        ...(gitLabel ? [{ Item: "Git", Value: gitLabel }] : []),
        {
          Item: "Обновление",
          Value: updateAvailability.available ? warn(`доступно · ${updateLine}`) : updateLine,
        },
        { Item: "Шлюз", Value: gatewayValue },
        { Item: "Служба шлюза", Value: daemonValue },
        { Item: "Служба Node", Value: nodeDaemonValue },
        { Item: "Агенты", Value: agentsValue },
        { Item: "Память", Value: memoryValue },
        { Item: "Проверки", Value: probesValue },
        { Item: "События", Value: eventsValue },
        { Item: "Heartbeat", Value: heartbeatValue },
        ...(lastHeartbeatValue ? [{ Item: "Последний пульс", Value: lastHeartbeatValue }] : []),
        {
          Item: "Сессии",
          Value: `${summary.sessions.count} активных · дефолт ${defaults.model ?? "неизвестно"}${defaultCtx} · ${storeLabel}`,
        },
      ]
    : [
        { Item: "Dashboard", Value: dashboard },
        { Item: "OS", Value: `${osSummary.label} · node ${process.versions.node}` },
        {
          Item: "Tailscale",
          Value:
            tailscaleMode === "off"
              ? muted("off")
              : tailscaleDns && tailscaleHttpsUrl
                ? `${tailscaleMode} · ${tailscaleDns} · ${tailscaleHttpsUrl}`
                : warn(`${tailscaleMode} · magicdns unknown`),
        },
        { Item: "Channel", Value: channelLabel },
        ...(gitLabel ? [{ Item: "Git", Value: gitLabel }] : []),
        {
          Item: "Update",
          Value: updateAvailability.available ? warn(`available · ${updateLine}`) : updateLine,
        },
        { Item: "Gateway", Value: gatewayValue },
        { Item: "Gateway service", Value: daemonValue },
        { Item: "Node service", Value: nodeDaemonValue },
        { Item: "Agents", Value: agentsValue },
        { Item: "Memory", Value: memoryValue },
        { Item: "Probes", Value: probesValue },
        { Item: "Events", Value: eventsValue },
        { Item: "Heartbeat", Value: heartbeatValue },
        ...(lastHeartbeatValue ? [{ Item: "Last heartbeat", Value: lastHeartbeatValue }] : []),
        {
          Item: "Sessions",
          Value: `${summary.sessions.count} active · default ${defaults.model ?? "unknown"}${defaultCtx} · ${storeLabel}`,
        },
      ];

  runtime.log(theme.heading(IS_XCLAW_MODE ? "Статус XClaw" : "OpenClaw status"));
  runtime.log("");
  runtime.log(theme.heading(IS_XCLAW_MODE ? "Обзор" : "Overview"));
  runtime.log(
    renderTable({
      width: tableWidth,
      columns: [
        { key: "Item", header: IS_XCLAW_MODE ? "Параметр" : "Item", minWidth: 12 },
        { key: "Value", header: IS_XCLAW_MODE ? "Значение" : "Value", flex: true, minWidth: 32 },
      ],
      rows: overviewRows,
    }).trimEnd(),
  );

  if (pairingRecovery) {
    runtime.log("");
    runtime.log(theme.warn(IS_XCLAW_MODE ? "Требуется одобрение сопряжения шлюза." : "Gateway pairing approval required."));
    if (pairingRecovery.requestId) {
      runtime.log(
        theme.muted(
          IS_XCLAW_MODE 
            ? `Одобрение: ${formatCliCommand(`xclaw devices approve ${pairingRecovery.requestId}`)}`
            : `Recovery: ${formatCliCommand(`openclaw devices approve ${pairingRecovery.requestId}`)}`,
        ),
      );
    }
    runtime.log(theme.muted(IS_XCLAW_MODE ? `Резерв: ${formatCliCommand("xclaw devices approve --latest")}` : `Fallback: ${formatCliCommand("openclaw devices approve --latest")}`));
    runtime.log(theme.muted(IS_XCLAW_MODE ? `Проверка: ${formatCliCommand("xclaw devices list")}` : `Inspect: ${formatCliCommand("openclaw devices list")}`));
  }

  runtime.log("");
  runtime.log(theme.heading(IS_XCLAW_MODE ? "Аудит безопасности" : "Security audit"));
  const fmtSummary = (value: { critical: number; warn: number; info: number }) => {
    const parts = [
      theme.error(`${value.critical} ${IS_XCLAW_MODE ? "критично" : "critical"}`),
      theme.warn(`${value.warn} ${IS_XCLAW_MODE ? "предупреждение" : "warn"}`),
      theme.muted(`${value.info} ${IS_XCLAW_MODE ? "инфо" : "info"}`),
    ];
    return parts.join(" · ");
  };
  runtime.log(theme.muted(`${IS_XCLAW_MODE ? "Итог" : "Summary"}: ${fmtSummary(securityAudit.summary)}`));
  const importantFindings = securityAudit.findings.filter(
    (f) => f.severity === "critical" || f.severity === "warn",
  );
  if (importantFindings.length === 0) {
    runtime.log(theme.muted(IS_XCLAW_MODE ? "Критических проблем не обнаружено." : "No critical or warn findings detected."));
  } else {
    const severityLabel = (sev: "critical" | "warn" | "info") => {
      if (sev === "critical") {
        return theme.error(IS_XCLAW_MODE ? "КРИТИЧНО" : "CRITICAL");
      }
      if (sev === "warn") {
        return theme.warn(IS_XCLAW_MODE ? "ВНИМАНИЕ" : "WARN");
      }
      return theme.muted("INFO");
    };
    const sevRank = (sev: "critical" | "warn" | "info") =>
      sev === "critical" ? 0 : sev === "warn" ? 1 : 2;
    const sorted = [...importantFindings].toSorted(
      (a, b) => sevRank(a.severity) - sevRank(b.severity),
    );
    const shown = sorted.slice(0, 6);
    for (const f of shown) {
      runtime.log(`  ${severityLabel(f.severity)} ${f.title}`);
      runtime.log(`    ${shortenText(f.detail.replaceAll("\n", " "), 160)}`);
      if (f.remediation?.trim()) {
        runtime.log(`    ${theme.muted(`${IS_XCLAW_MODE ? "Исправление" : "Fix"}: ${f.remediation.trim()}`)}`);
      }
    }
    if (sorted.length > shown.length) {
      runtime.log(theme.muted(`… +${sorted.length - shown.length} ${IS_XCLAW_MODE ? "еще" : "more"}`));
    }
  }
  runtime.log(theme.muted(`${IS_XCLAW_MODE ? "Полный отчет" : "Full report"}: ${formatCliCommand(IS_XCLAW_MODE ? "xclaw security audit" : "openclaw security audit")}`));
  runtime.log(theme.muted(`${IS_XCLAW_MODE ? "Глубокая проверка" : "Deep probe"}: ${formatCliCommand(IS_XCLAW_MODE ? "xclaw security audit --deep" : "openclaw security audit --deep")}`));

  runtime.log("");
  runtime.log(theme.heading(IS_XCLAW_MODE ? "Каналы" : "Channels"));
  const channelIssuesByChannel = (() => {
    const map = new Map<string, typeof channelIssues>();
    for (const issue of channelIssues) {
      const key = issue.channel;
      const list = map.get(key);
      if (list) {
        list.push(issue);
      } else {
        map.set(key, [issue]);
      }
    }
    return map;
  })();
  runtime.log(
    renderTable({
      width: tableWidth,
      columns: [
        { key: "Channel", header: IS_XCLAW_MODE ? "Канал" : "Channel", minWidth: 10 },
        { key: "Enabled", header: IS_XCLAW_MODE ? "Вкл" : "Enabled", minWidth: 7 },
        { key: "State", header: IS_XCLAW_MODE ? "Статус" : "State", minWidth: 8 },
        { key: "Detail", header: IS_XCLAW_MODE ? "Детали" : "Detail", flex: true, minWidth: 24 },
      ],
      rows: channels.rows.map((row) => {
        const issues = channelIssuesByChannel.get(row.id) ?? [];
        const effectiveState = row.state === "off" ? "off" : issues.length > 0 ? "warn" : row.state;
        const issueSuffix =
          issues.length > 0
            ? ` · ${warn(`${IS_XCLAW_MODE ? "шлюз" : "gateway"}: ${shortenText(issues[0]?.message ?? "issue", 84)}`)}`
            : "";
        return {
          Channel: row.label,
          Enabled: row.enabled ? ok("ON") : muted("OFF"),
          State:
            effectiveState === "ok"
              ? ok("OK")
              : effectiveState === "warn"
                ? warn("WARN")
                : effectiveState === "off"
                  ? muted("OFF")
                  : theme.accentDim("SETUP"),
          Detail: `${row.detail}${issueSuffix}`,
        };
      }),
    }).trimEnd(),
  );

  runtime.log("");
  runtime.log(theme.heading(IS_XCLAW_MODE ? "Сессии" : "Sessions"));
  runtime.log(
    renderTable({
      width: tableWidth,
      columns: [
        { key: "Key", header: IS_XCLAW_MODE ? "Ключ" : "Key", minWidth: 20, flex: true },
        { key: "Kind", header: IS_XCLAW_MODE ? "Тип" : "Kind", minWidth: 6 },
        { key: "Age", header: IS_XCLAW_MODE ? "Давность" : "Age", minWidth: 9 },
        { key: "Model", header: IS_XCLAW_MODE ? "Модель" : "Model", minWidth: 14 },
        { key: "Tokens", header: IS_XCLAW_MODE ? "Токены" : "Tokens", minWidth: 16 },
      ],
      rows:
        summary.sessions.recent.length > 0
          ? summary.sessions.recent.map((sess) => ({
              Key: shortenText(sess.key, 32),
              Kind: sess.kind,
              Age: sess.updatedAt ? formatTimeAgo(sess.age) : (IS_XCLAW_MODE ? "нет активности" : "no activity"),
              Model: sess.model ?? "unknown",
              Tokens: formatTokensCompact(sess),
            }))
          : [
              {
                Key: muted(IS_XCLAW_MODE ? "сессий пока нет" : "no sessions yet"),
                Kind: "",
                Age: "",
                Model: "",
                Tokens: "",
              },
            ],
    }).trimEnd(),
  );

  if (summary.queuedSystemEvents.length > 0) {
    runtime.log("");
    runtime.log(theme.heading(IS_XCLAW_MODE ? "Системные события" : "System events"));
    runtime.log(
      renderTable({
        width: tableWidth,
        columns: [{ key: "Event", header: IS_XCLAW_MODE ? "Событие" : "Event", flex: true, minWidth: 24 }],
        rows: summary.queuedSystemEvents.slice(0, 5).map((event) => ({
          Event: event,
        })),
      }).trimEnd(),
    );
    if (summary.queuedSystemEvents.length > 5) {
      runtime.log(muted(`… +${summary.queuedSystemEvents.length - 5} ${IS_XCLAW_MODE ? "еще" : "more"}`));
    }
  }

  if (health) {
    runtime.log("");
    runtime.log(theme.heading(IS_XCLAW_MODE ? "Здоровье" : "Health"));
    const rows: Array<Record<string, string>> = [];
    rows.push({
      Item: IS_XCLAW_MODE ? "Шлюз" : "Gateway",
      Status: ok(IS_XCLAW_MODE ? "доступен" : "reachable"),
      Detail: `${health.durationMs}ms`,
    });

    for (const line of formatHealthChannelLines(health, { accountMode: "all" })) {
      const colon = line.indexOf(":");
      if (colon === -1) {
        continue;
      }
      const item = line.slice(0, colon).trim();
      const detail = line.slice(colon + 1).trim();
      const normalized = detail.toLowerCase();
      const status = (() => {
        if (normalized.startsWith("ok")) {
          return ok("OK");
        }
        if (normalized.startsWith("failed")) {
          return warn(IS_XCLAW_MODE ? "ОШИБКА" : "WARN");
        }
        if (normalized.startsWith("not configured")) {
          return muted(IS_XCLAW_MODE ? "ВЫКЛ" : "OFF");
        }
        if (normalized.startsWith("configured")) {
          return ok("OK");
        }
        if (normalized.startsWith("linked")) {
          return ok(IS_XCLAW_MODE ? "ПРИВЯЗАНО" : "LINKED");
        }
        if (normalized.startsWith("not linked")) {
          return warn(IS_XCLAW_MODE ? "ОТКЛЮЧЕНО" : "UNLINKED");
        }
        return warn(IS_XCLAW_MODE ? "ВНИМАНИЕ" : "WARN");
      })();
      rows.push({ Item: item, Status: status, Detail: detail });
    }

    runtime.log(
      renderTable({
        width: tableWidth,
        columns: [
          { key: "Item", header: IS_XCLAW_MODE ? "Параметр" : "Item", minWidth: 10 },
          { key: "Status", header: IS_XCLAW_MODE ? "Статус" : "Status", minWidth: 8 },
          { key: "Detail", header: IS_XCLAW_MODE ? "Детали" : "Detail", flex: true, minWidth: 28 },
        ],
        rows,
      }).trimEnd(),
    );
  }

  if (usage) {
    runtime.log("");
    runtime.log(theme.heading(IS_XCLAW_MODE ? "Использование" : "Usage"));
    for (const line of formatUsageReportLines(usage)) {
      runtime.log(line);
    }
  }

  runtime.log("");
  runtime.log(`FAQ: https://docs.openclaw.ai/faq`);
  runtime.log(`Troubleshooting: https://docs.openclaw.ai/troubleshooting`);
  runtime.log("");
  const updateHint = formatUpdateAvailableHint(update);
  if (updateHint) {
    runtime.log(theme.warn(updateHint));
    runtime.log("");
  }
  runtime.log(IS_XCLAW_MODE ? "Следующие шаги:" : "Next steps:");
  runtime.log(`  ${IS_XCLAW_MODE ? "Нужно поделиться?" : "Need to share?"}      ${formatCliCommand(IS_XCLAW_MODE ? "xclaw status --all" : "openclaw status --all")}`);
  runtime.log(`  ${IS_XCLAW_MODE ? "Живые логи?" : "Need to debug live?"} ${formatCliCommand(IS_XCLAW_MODE ? "xclaw logs --follow" : "openclaw logs --follow")}`);
  if (gatewayReachable) {
    runtime.log(`  ${IS_XCLAW_MODE ? "Проверить каналы?" : "Need to test channels?"} ${formatCliCommand(IS_XCLAW_MODE ? "xclaw status --deep" : "openclaw status --deep")}`);
  } else {
    runtime.log(`  ${IS_XCLAW_MODE ? "Сначала почините шлюз:" : "Fix reachability first:"} ${formatCliCommand(IS_XCLAW_MODE ? "xclaw gateway probe" : "openclaw gateway probe")}`);
  }
}
