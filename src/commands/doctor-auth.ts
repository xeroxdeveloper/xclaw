import { IS_XCLAW_MODE, isXClawMode } from "../xclaw/mode.js";
import {
  buildAuthHealthSummary,
  DEFAULT_OAUTH_WARN_MS,
  formatRemainingShort,
} from "../agents/auth-health.js";
import {
  CLAUDE_CLI_PROFILE_ID,
  CODEX_CLI_PROFILE_ID,
  ensureAuthProfileStore,
  repairOAuthProfileIdMismatch,
  resolveApiKeyForProfile,
  resolveProfileUnusableUntilForDisplay,
} from "../agents/auth-profiles.js";
import { updateAuthProfileStoreWithLock } from "../agents/auth-profiles/store.js";
import { formatCliCommand } from "../cli/command-format.js";
import type { OpenClawConfig } from "../config/config.js";
import { note } from "../terminal/note.js";
import type { DoctorPrompter } from "./doctor-prompter.js";

export async function maybeRepairAnthropicOAuthProfileId(
  cfg: OpenClawConfig,
  prompter: DoctorPrompter,
): Promise<OpenClawConfig> {
  if (IS_XCLAW_MODE) {
    return cfg;
  }
  const store = ensureAuthProfileStore();
  const repair = repairOAuthProfileIdMismatch({
    cfg,
    store,
    provider: "anthropic",
    legacyProfileId: "anthropic:default",
  });
  if (!repair.migrated || repair.changes.length === 0) {
    return cfg;
  }

  note(repair.changes.map((c) => `- ${c}`).join("\n"), IS_XCLAW_MODE ? "Профили авторизации" : "Auth profiles");
  const apply = await prompter.confirm({
    message: IS_XCLAW_MODE ? "Обновить ID профиля Anthropic в конфиге?" : "Update Anthropic OAuth profile id in config now?",
    initialValue: true,
  });
  if (!apply) {
    return cfg;
  }
  return repair.config;
}

function pruneAuthOrder(
  order: Record<string, string[]> | undefined,
  profileIds: Set<string>,
): { next: Record<string, string[]> | undefined; changed: boolean } {
  if (!order) {
    return { next: order, changed: false };
  }
  let changed = false;
  const next: Record<string, string[]> = {};
  for (const [provider, list] of Object.entries(order)) {
    const filtered = list.filter((id) => !profileIds.has(id));
    if (filtered.length !== list.length) {
      changed = true;
    }
    if (filtered.length > 0) {
      next[provider] = filtered;
    }
  }
  return { next: Object.keys(next).length > 0 ? next : undefined, changed };
}

function pruneAuthProfiles(
  cfg: OpenClawConfig,
  profileIds: Set<string>,
): { next: OpenClawConfig; changed: boolean } {
  const profiles = cfg.auth?.profiles;
  const order = cfg.auth?.order;
  const nextProfiles = profiles ? { ...profiles } : undefined;
  let changed = false;

  if (nextProfiles) {
    for (const id of profileIds) {
      if (id in nextProfiles) {
        delete nextProfiles[id];
        changed = true;
      }
    }
  }

  const prunedOrder = pruneAuthOrder(order, profileIds);
  if (prunedOrder.changed) {
    changed = true;
  }

  if (!changed) {
    return { next: cfg, changed: false };
  }

  const nextAuth =
    nextProfiles || prunedOrder.next
      ? {
          ...cfg.auth,
          profiles: nextProfiles && Object.keys(nextProfiles).length > 0 ? nextProfiles : undefined,
          order: prunedOrder.next,
        }
      : undefined;

  return {
    next: {
      ...cfg,
      auth: nextAuth,
    },
    changed: true,
  };
}

export async function maybeRemoveDeprecatedCliAuthProfiles(
  cfg: OpenClawConfig,
  prompter: DoctorPrompter,
): Promise<OpenClawConfig> {
  const store = ensureAuthProfileStore(undefined, { allowKeychainPrompt: false });
  const deprecated = new Set<string>();
  if (!IS_XCLAW_MODE && (store.profiles[CLAUDE_CLI_PROFILE_ID] || cfg.auth?.profiles?.[CLAUDE_CLI_PROFILE_ID])) {
    deprecated.add(CLAUDE_CLI_PROFILE_ID);
  }
  if (store.profiles[CODEX_CLI_PROFILE_ID] || cfg.auth?.profiles?.[CODEX_CLI_PROFILE_ID]) {
    deprecated.add(CODEX_CLI_PROFILE_ID);
  }

  if (deprecated.size === 0) {
    return cfg;
  }

  const lines = [IS_XCLAW_MODE ? "Обнаружены устаревшие внешние профили CLI (больше не поддерживаются):" : "Deprecated external CLI auth profiles detected (no longer supported):"];
  if (deprecated.has(CLAUDE_CLI_PROFILE_ID)) {
    lines.push(
      `- ${CLAUDE_CLI_PROFILE_ID} (Anthropic): ${IS_XCLAW_MODE ? "используйте токен настройки" : "use setup-token"} → ${formatCliCommand(`${IS_XCLAW_MODE ? "xclaw" : "openclaw"} models auth setup-token`)}`,
    );
  }
  if (deprecated.has(CODEX_CLI_PROFILE_ID)) {
    lines.push(
      `- ${CODEX_CLI_PROFILE_ID} (OpenAI Codex): ${IS_XCLAW_MODE ? "используйте OAuth" : "use OAuth"} → ${formatCliCommand(
        `${IS_XCLAW_MODE ? "xclaw" : "openclaw"} models auth login --provider openai-codex`,
      )}`,
    );
  }
  note(lines.join("\n"), IS_XCLAW_MODE ? "Профили авторизации" : "Auth profiles");

  const shouldRemove = await prompter.confirmRepair({
    message: IS_XCLAW_MODE ? "Удалить устаревшие профили CLI сейчас?" : "Remove deprecated CLI auth profiles now?",
    initialValue: true,
  });
  if (!shouldRemove) {
    return cfg;
  }

  await updateAuthProfileStoreWithLock({
    updater: (nextStore) => {
      let mutated = false;
      for (const id of deprecated) {
        if (nextStore.profiles[id]) {
          delete nextStore.profiles[id];
          mutated = true;
        }
        if (nextStore.usageStats?.[id]) {
          delete nextStore.usageStats[id];
          mutated = true;
        }
      }
      if (nextStore.order) {
        for (const [provider, list] of Object.entries(nextStore.order)) {
          const filtered = list.filter((id) => !deprecated.has(id));
          if (filtered.length !== list.length) {
            mutated = true;
            if (filtered.length > 0) {
              nextStore.order[provider] = filtered;
            } else {
              delete nextStore.order[provider];
            }
          }
        }
      }
      if (nextStore.lastGood) {
        for (const [provider, profileId] of Object.entries(nextStore.lastGood)) {
          if (deprecated.has(profileId)) {
            delete nextStore.lastGood[provider];
            mutated = true;
          }
        }
      }
      return mutated;
    },
  });

  const pruned = pruneAuthProfiles(cfg, deprecated);
  if (pruned.changed) {
    note(
      Array.from(deprecated.values())
        .map((id) => IS_XCLAW_MODE ? `- удален ${id} из конфига` : `- removed ${id} from config`)
        .join("\n"),
      IS_XCLAW_MODE ? "Изменения доктора" : "Doctor changes",
    );
  }
  return pruned.next;
}

type AuthIssue = {
  profileId: string;
  provider: string;
  status: string;
  remainingMs?: number;
};

export function resolveUnusableProfileHint(params: {
  kind: "cooldown" | "disabled";
  reason?: string;
}): string {
  if (params.kind === "disabled") {
    if (params.reason === "billing") {
      return IS_XCLAW_MODE ? "Пополните баланс (биллинг провайдера) или смените провайдера." : "Top up credits (provider billing) or switch provider.";
    }
    if (params.reason === "auth_permanent" || params.reason === "auth") {
      return IS_XCLAW_MODE ? "Обновите или замените учетные данные, затем попробуйте снова." : "Refresh or replace credentials, then retry.";
    }
  }
  return IS_XCLAW_MODE ? "Подождите завершения таймаута или смените провайдера." : "Wait for cooldown or switch provider.";
}

function formatAuthIssueHint(issue: AuthIssue): string | null {
  const cmd = IS_XCLAW_MODE ? "xclaw" : "openclaw";
  if (issue.provider === "anthropic" && issue.profileId === CLAUDE_CLI_PROFILE_ID) {
    return `${IS_XCLAW_MODE ? "Устаревший профиль. Используйте" : "Deprecated profile. Use"} ${formatCliCommand(`${cmd} models auth setup-token`)} ${IS_XCLAW_MODE ? "или" : "or"} ${formatCliCommand(
      `${cmd} configure`,
    )}.`;
  }
  if (issue.provider === "openai-codex" && issue.profileId === CODEX_CLI_PROFILE_ID) {
    return `${IS_XCLAW_MODE ? "Устаревший профиль. Используйте OAuth →" : "Deprecated profile. Use OAuth →"} ${formatCliCommand(
      `${cmd} models auth login --provider openai-codex`,
    )} ${IS_XCLAW_MODE ? "или" : "or"} ${formatCliCommand(`${cmd} configure`)}.`;
  }
  return IS_XCLAW_MODE 
    ? `Авторизуйтесь снова через \`${formatCliCommand("xclaw configure")}\` или \`${formatCliCommand("xclaw onboard")}\`.`
    : `Re-auth via \`${formatCliCommand("openclaw configure")}\` or \`${formatCliCommand("openclaw onboard")}\`.`;
}

function formatAuthIssueLine(issue: AuthIssue): string {
  const remaining =
    issue.remainingMs !== undefined ? ` (${formatRemainingShort(issue.remainingMs)})` : "";
  const hint = formatAuthIssueHint(issue);
  return `- ${issue.profileId}: ${issue.status}${remaining}${hint ? ` — ${hint}` : ""}`;
}

export async function noteAuthProfileHealth(params: {
  cfg: OpenClawConfig;
  prompter: DoctorPrompter;
  allowKeychainPrompt: boolean;
}): Promise<void> {
  const store = ensureAuthProfileStore(undefined, {
    allowKeychainPrompt: params.allowKeychainPrompt,
  });
  const unusable = (() => {
    const now = Date.now();
    const out: string[] = [];
    for (const profileId of Object.keys(store.usageStats ?? {})) {
      const until = resolveProfileUnusableUntilForDisplay(store, profileId);
      if (!until || now >= until) {
        continue;
      }
      const stats = store.usageStats?.[profileId];
      const remaining = formatRemainingShort(until - now);
      const disabledActive = typeof stats?.disabledUntil === "number" && now < stats.disabledUntil;
      const kind = disabledActive
        ? `disabled${stats.disabledReason ? `:${stats.disabledReason}` : ""}`
        : "cooldown";
      const hint = resolveUnusableProfileHint({
        kind: disabledActive ? "disabled" : "cooldown",
        reason: stats?.disabledReason,
      });
      out.push(`- ${profileId}: ${kind} (${remaining})${hint ? ` — ${hint}` : ""}`);
    }
    return out;
  })();

  if (unusable.length > 0) {
    note(unusable.join("\n"), IS_XCLAW_MODE ? "Таймауты профилей авторизации" : "Auth profile cooldowns");
  }

  let summary = buildAuthHealthSummary({
    store,
    cfg: params.cfg,
    warnAfterMs: DEFAULT_OAUTH_WARN_MS,
  });

  const findIssues = () =>
    summary.profiles.filter(
      (profile) =>
        (profile.type === "oauth" || profile.type === "token") &&
        (profile.status === "expired" ||
          profile.status === "expiring" ||
          profile.status === "missing"),
    );

  let issues = findIssues();
  if (issues.length === 0) {
    return;
  }

  const shouldRefresh = await params.prompter.confirmRepair({
    message: IS_XCLAW_MODE ? "Обновить истекающие токены OAuth? (статические токены требуют повторной авторизации)" : "Refresh expiring OAuth tokens now? (static tokens need re-auth)",
    initialValue: true,
  });

  if (shouldRefresh) {
    const refreshTargets = issues.filter(
      (issue) =>
        issue.type === "oauth" && ["expired", "expiring", "missing"].includes(issue.status),
    );
    const errors: string[] = [];
    for (const profile of refreshTargets) {
      try {
        await resolveApiKeyForProfile({
          cfg: params.cfg,
          store,
          profileId: profile.profileId,
        });
      } catch (err) {
        errors.push(`- ${profile.profileId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (errors.length > 0) {
      note(errors.join("\n"), "OAuth refresh errors");
    }
    summary = buildAuthHealthSummary({
      store: ensureAuthProfileStore(undefined, {
        allowKeychainPrompt: false,
      }),
      cfg: params.cfg,
      warnAfterMs: DEFAULT_OAUTH_WARN_MS,
    });
    issues = findIssues();
  }

  if (issues.length > 0) {
    note(
      issues
        .map((issue) =>
          formatAuthIssueLine({
            profileId: issue.profileId,
            provider: issue.provider,
            status: issue.status,
            remainingMs: issue.remainingMs,
          }),
        )
        .join("\n"),
      IS_XCLAW_MODE ? "Авторизация моделей" : "Model auth",
    );
  }
}
