import { IS_XCLAW_MODE } from "../xclaw/mode.js";
import { installSkill } from "../agents/skills-install.js";
import { buildWorkspaceSkillStatus } from "../agents/skills-status.js";
import { formatCliCommand } from "../cli/command-format.js";
import type { OpenClawConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { normalizeSecretInput } from "../utils/normalize-secret-input.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { detectBinary, resolveNodeManagerOptions } from "./onboard-helpers.js";

function summarizeInstallFailure(message: string): string | undefined {
  const cleaned = message.replace(/^Install failed(?:\s*\([^)]*\))?\s*:?\s*/i, "").trim();
  if (!cleaned) {
    return undefined;
  }
  const maxLen = 140;
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

function formatSkillHint(skill: {
  description?: string;
  install: Array<{ label: string }>;
}): string {
  const desc = skill.description?.trim();
  const installLabel = skill.install[0]?.label?.trim();
  const combined = desc && installLabel ? `${desc} — ${installLabel}` : desc || installLabel;
  if (!combined) {
    return "install";
  }
  const maxLen = 90;
  return combined.length > maxLen ? `${combined.slice(0, maxLen - 1)}…` : combined;
}

function upsertSkillEntry(
  cfg: OpenClawConfig,
  skillKey: string,
  patch: { apiKey?: string },
): OpenClawConfig {
  const entries = { ...cfg.skills?.entries };
  const existing = (entries[skillKey] as { apiKey?: string } | undefined) ?? {};
  entries[skillKey] = { ...existing, ...patch };
  return {
    ...cfg,
    skills: {
      ...cfg.skills,
      entries,
    },
  };
}

export async function setupSkills(
  cfg: OpenClawConfig,
  workspaceDir: string,
  runtime: RuntimeEnv,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  const report = buildWorkspaceSkillStatus(workspaceDir, { config: cfg });
  const eligible = report.skills.filter((s) => s.eligible);
  const unsupportedOs = report.skills.filter(
    (s) => !s.disabled && !s.blockedByAllowlist && s.missing.os.length > 0,
  );
  const missing = report.skills.filter(
    (s) => !s.eligible && !s.disabled && !s.blockedByAllowlist && s.missing.os.length === 0,
  );
  const blocked = report.skills.filter((s) => s.blockedByAllowlist);

  await prompter.note(
    [
      `${IS_XCLAW_MODE ? "Доступно" : "Eligible"}: ${eligible.length}`,
      `${IS_XCLAW_MODE ? "Не хватает данных" : "Missing requirements"}: ${missing.length}`,
      `${IS_XCLAW_MODE ? "Не поддерживается этой ОС" : "Unsupported on this OS"}: ${unsupportedOs.length}`,
      `${IS_XCLAW_MODE ? "Заблокировано списком" : "Blocked by allowlist"}: ${blocked.length}`,
    ].join("\n"),
    IS_XCLAW_MODE ? "Статус навыков" : "Skills status",
  );

  const shouldConfigure = await prompter.confirm({
    message: IS_XCLAW_MODE ? "Настроить навыки сейчас? (рекомендуется)" : "Configure skills now? (recommended)",
    initialValue: true,
  });
  if (!shouldConfigure) {
    return cfg;
  }

  const installable = missing.filter(
    (skill) => skill.install.length > 0 && skill.missing.bins.length > 0,
  );
  let next: OpenClawConfig = cfg;
  if (installable.length > 0) {
    const toInstall = await prompter.multiselect({
      message: IS_XCLAW_MODE ? "Установить недостающие зависимости" : "Install missing skill dependencies",
      options: [
        {
          value: "__skip__",
          label: IS_XCLAW_MODE ? "Пропустить" : "Skip for now",
          hint: IS_XCLAW_MODE ? "Продолжить без установки зависимостей" : "Continue without installing dependencies",
        },
        ...installable.map((skill) => ({
          value: skill.name,
          label: `${skill.emoji ?? "🧩"} ${skill.name}`,
          hint: formatSkillHint(skill),
        })),
      ],
    });

    const selected = toInstall.filter((name) => name !== "__skip__");

    const selectedSkills = selected
      .map((name) => installable.find((s) => s.name === name))
      .filter((item): item is (typeof installable)[number] => Boolean(item));

    const needsBrewPrompt =
      process.platform !== "win32" &&
      selectedSkills.some((skill) => skill.install.some((option) => option.kind === "brew")) &&
      !(await detectBinary("brew"));

    if (needsBrewPrompt) {
      await prompter.note(
        IS_XCLAW_MODE
          ? [
              "Многие зависимости навыков распространяются через Homebrew.",
              "Без brew вам придется собирать их из исходников или скачивать вручную.",
            ].join("\n")
          : [
              "Many skill dependencies are shipped via Homebrew.",
              "Without brew, you'll need to build from source or download releases manually.",
            ].join("\n"),
        IS_XCLAW_MODE ? "Рекомендуется Homebrew" : "Homebrew recommended",
      );
      const showBrewInstall = await prompter.confirm({
        message: IS_XCLAW_MODE ? "Показать команду установки Homebrew?" : "Show Homebrew install command?",
        initialValue: true,
      });
      if (showBrewInstall) {
        await prompter.note(
          [
            IS_XCLAW_MODE ? "Выполните:" : "Run:",
            '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
          ].join("\n"),
          IS_XCLAW_MODE ? "Установка Homebrew" : "Homebrew install",
        );
      }
    }

    const needsNodeManagerPrompt = selectedSkills.some((skill) =>
      skill.install.some((option) => option.kind === "node"),
    );
    if (needsNodeManagerPrompt) {
      const nodeManager = (await prompter.select({
        message: IS_XCLAW_MODE ? "Предпочтительный менеджер пакетов для навыков" : "Preferred node manager for skill installs",
        options: resolveNodeManagerOptions(),
      })) as "npm" | "pnpm" | "bun";
      next = {
        ...next,
        skills: {
          ...next.skills,
          install: {
            ...next.skills?.install,
            nodeManager,
          },
        },
      };
    }

    for (const name of selected) {
      const target = installable.find((s) => s.name === name);
      if (!target || target.install.length === 0) {
        continue;
      }
      const installId = target.install[0]?.id;
      if (!installId) {
        continue;
      }
      const spin = prompter.progress(IS_XCLAW_MODE ? `Установка ${name}…` : `Installing ${name}…`);
      const result = await installSkill({
        workspaceDir,
        skillName: target.name,
        installId,
        config: next,
      });
      const warnings = result.warnings ?? [];
      if (result.ok) {
        spin.stop(warnings.length > 0 
          ? (IS_XCLAW_MODE ? `Установлено ${name} (с предупреждениями)` : `Installed ${name} (with warnings)`) 
          : (IS_XCLAW_MODE ? `Установлено ${name}` : `Installed ${name}`));
        for (const warning of warnings) {
          runtime.log(warning);
        }
        continue;
      }
      const code = result.code == null ? "" : ` (exit ${result.code})`;
      const detail = summarizeInstallFailure(result.message);
      spin.stop(IS_XCLAW_MODE 
        ? `Ошибка установки: ${name}${code}${detail ? ` — ${detail}` : ""}` 
        : `Install failed: ${name}${code}${detail ? ` — ${detail}` : ""}`);
      for (const warning of warnings) {
        runtime.log(warning);
      }
      if (result.stderr) {
        runtime.log(result.stderr.trim());
      } else if (result.stdout) {
        runtime.log(result.stdout.trim());
      }
      runtime.log(
        IS_XCLAW_MODE 
          ? `Совет: запустите \`${formatCliCommand("xclaw doctor")}\` для проверки навыков.` 
          : `Tip: run \`${formatCliCommand("openclaw doctor")}\` to review skills + requirements.`,
      );
      runtime.log(`Docs: https://docs.openclaw.ai/skills`);
    }
  }

  for (const skill of missing) {
    if (!skill.primaryEnv || skill.missing.env.length === 0) {
      continue;
    }
    const wantsKey = await prompter.confirm({
      message: IS_XCLAW_MODE ? `Установить ${skill.primaryEnv} для ${skill.name}?` : `Set ${skill.primaryEnv} for ${skill.name}?`,
      initialValue: false,
    });
    if (!wantsKey) {
      continue;
    }
    const apiKey = String(
      await prompter.text({
        message: IS_XCLAW_MODE ? `Введите ${skill.primaryEnv}` : `Enter ${skill.primaryEnv}`,
        validate: (value) => (value?.trim() ? undefined : (IS_XCLAW_MODE ? "Обязательно" : "Required")),
      }),
    );
    next = upsertSkillEntry(next, skill.skillKey, { apiKey: normalizeSecretInput(apiKey) });
  }

  return next;
}
