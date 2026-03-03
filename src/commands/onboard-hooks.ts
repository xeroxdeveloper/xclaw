import { isXClawMode } from "../xclaw/mode.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { formatCliCommand } from "../cli/command-format.js";
import type { OpenClawConfig } from "../config/config.js";
import { buildWorkspaceHookStatus } from "../hooks/hooks-status.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";

export async function setupInternalHooks(
  cfg: OpenClawConfig,
  runtime: RuntimeEnv,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  await prompter.note(
    isXClawMode()
      ? [
          "Хуки позволяют автоматизировать действия при выполнении команд агента.",
          "Пример: Сохранить контекст сессии в память при выполнении /new или /reset.",
          "",
          "Документация: https://docs.openclaw.ai/automation/hooks",
        ].join("\n")
      : [
          "Hooks let you automate actions when agent commands are issued.",
          "Example: Save session context to memory when you issue /new or /reset.",
          "",
          "Learn more: https://docs.openclaw.ai/automation/hooks",
        ].join("\n"),
    isXClawMode() ? "Хуки" : "Hooks",
  );

  // Discover available hooks using the hook discovery system
  const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
  const report = buildWorkspaceHookStatus(workspaceDir, { config: cfg });

  // Show every eligible hook so users can opt in during onboarding.
  const eligibleHooks = report.hooks.filter((h) => h.eligible);

  if (eligibleHooks.length === 0) {
    await prompter.note(
      isXClawMode()
        ? "Подходящих хуков не найдено. Вы можете настроить их позже в конфиге."
        : "No eligible hooks found. You can configure hooks later in your config.",
      isXClawMode() ? "Нет доступных хуков" : "No Hooks Available",
    );
    return cfg;
  }

  const toEnable = await prompter.multiselect({
    message: isXClawMode() ? "Включить хуки?" : "Enable hooks?",
    options: [
      { value: "__skip__", label: isXClawMode() ? "Пропустить" : "Skip for now" },
      ...eligibleHooks.map((hook) => ({
        value: hook.name,
        label: `${hook.emoji ?? "🔗"} ${hook.name}`,
        hint: hook.description,
      })),
    ],
  });

  const selected = toEnable.filter((name) => name !== "__skip__");
  if (selected.length === 0) {
    return cfg;
  }

  // Enable selected hooks using the new entries config format
  const entries = { ...cfg.hooks?.internal?.entries };
  for (const name of selected) {
    entries[name] = { enabled: true };
  }

  const next: OpenClawConfig = {
    ...cfg,
    hooks: {
      ...cfg.hooks,
      internal: {
        enabled: true,
        entries,
      },
    },
  };

  await prompter.note(
    isXClawMode()
      ? [
          `Включено ${selected.length} хук${selected.length === 1 ? "" : selected.length < 5 ? "а" : "ов"}: ${selected.join(", ")}`,
          "",
          "Вы можете управлять хуками позже:",
          `  ${formatCliCommand("xclaw hooks list")}`,
          `  ${formatCliCommand("xclaw hooks enable <имя>")}`,
          `  ${formatCliCommand("xclaw hooks disable <имя>")}`,
        ].join("\n")
      : [
          `Enabled ${selected.length} hook${selected.length > 1 ? "s" : ""}: ${selected.join(", ")}`,
          "",
          "You can manage hooks later with:",
          `  ${formatCliCommand("openclaw hooks list")}`,
          `  ${formatCliCommand("openclaw hooks enable <name>")}`,
          `  ${formatCliCommand("openclaw hooks disable <name>")}`,
        ].join("\n"),
    isXClawMode() ? "Хуки настроены" : "Hooks Configured",
  );

  return next;
}
