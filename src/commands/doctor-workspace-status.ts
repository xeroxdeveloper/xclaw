import { IS_XCLAW_MODE, isXClawMode } from "../xclaw/mode.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { buildWorkspaceSkillStatus } from "../agents/skills-status.js";
import type { OpenClawConfig } from "../config/config.js";
import { loadOpenClawPlugins } from "../plugins/loader.js";
import { note } from "../terminal/note.js";
import { detectLegacyWorkspaceDirs, formatLegacyWorkspaceWarning } from "./doctor-workspace.js";

export function noteWorkspaceStatus(cfg: OpenClawConfig) {
  const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
  const legacyWorkspace = detectLegacyWorkspaceDirs({ workspaceDir });
  if (legacyWorkspace.legacyDirs.length > 0) {
    note(formatLegacyWorkspaceWarning(legacyWorkspace), IS_XCLAW_MODE ? "Лишняя рабочая область" : "Extra workspace");
  }

  const skillsReport = buildWorkspaceSkillStatus(workspaceDir, { config: cfg });
  note(
    [
      `${IS_XCLAW_MODE ? "Доступно" : "Eligible"}: ${skillsReport.skills.filter((s) => s.eligible).length}`,
      `${IS_XCLAW_MODE ? "Не хватает данных" : "Missing requirements"}: ${
        skillsReport.skills.filter((s) => !s.eligible && !s.disabled && !s.blockedByAllowlist)
          .length
      }`,
      `${IS_XCLAW_MODE ? "Заблокировано списком" : "Blocked by allowlist"}: ${skillsReport.skills.filter((s) => s.blockedByAllowlist).length}`,
    ].join("\n"),
    IS_XCLAW_MODE ? "Статус навыков" : "Skills status",
  );

  const pluginRegistry = loadOpenClawPlugins({
    config: cfg,
    workspaceDir,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  });
  if (pluginRegistry.plugins.length > 0) {
    const loaded = pluginRegistry.plugins.filter((p) => p.status === "loaded");
    const disabled = pluginRegistry.plugins.filter((p) => p.status === "disabled");
    const errored = pluginRegistry.plugins.filter((p) => p.status === "error");

    const lines = [
      `${IS_XCLAW_MODE ? "Загружено" : "Loaded"}: ${loaded.length}`,
      `${IS_XCLAW_MODE ? "Отключено" : "Disabled"}: ${disabled.length}`,
      `${IS_XCLAW_MODE ? "Ошибки" : "Errors"}: ${errored.length}`,
      errored.length > 0
        ? `- ${errored
            .slice(0, 10)
            .map((p) => p.id)
            .join("\n- ")}${errored.length > 10 ? "\n- ..." : ""}`
        : null,
    ].filter((line): line is string => Boolean(line));

    note(lines.join("\n"), IS_XCLAW_MODE ? "Плагины" : "Plugins");
  }
  if (pluginRegistry.diagnostics.length > 0) {
    const lines = pluginRegistry.diagnostics.map((diag) => {
      const prefix = diag.level.toUpperCase();
      const plugin = diag.pluginId ? ` ${diag.pluginId}` : "";
      const source = diag.source ? ` (${diag.source})` : "";
      return `- ${prefix}${plugin}: ${diag.message}${source}`;
    });
    note(lines.join("\n"), IS_XCLAW_MODE ? "Диагностика плагинов" : "Plugin diagnostics");
  }

  return { workspaceDir };
}
