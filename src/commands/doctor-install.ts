import { isXClawMode } from "../xclaw/mode.js";
import fs from "node:fs";
import path from "node:path";
import { note } from "../terminal/note.js";

export function noteSourceInstallIssues(root: string | null) {
  if (!root) {
    return;
  }

  const workspaceMarker = path.join(root, "pnpm-workspace.yaml");
  if (!fs.existsSync(workspaceMarker)) {
    return;
  }

  const warnings: string[] = [];
  const nodeModules = path.join(root, "node_modules");
  const pnpmStore = path.join(nodeModules, ".pnpm");
  const tsxBin = path.join(nodeModules, ".bin", "tsx");
  const srcEntry = path.join(root, "src", "entry.ts");

  if (fs.existsSync(nodeModules) && !fs.existsSync(pnpmStore)) {
    warnings.push(
      isXClawMode() 
        ? "- папка node_modules не была установлена через pnpm (отсутствует .pnpm). Выполните: pnpm install"
        : "- node_modules was not installed by pnpm (missing node_modules/.pnpm). Run: pnpm install",
    );
  }

  if (fs.existsSync(path.join(root, "package-lock.json"))) {
    warnings.push(
      isXClawMode()
        ? "- файл package-lock.json обнаружен в pnpm-воркспейсе. Если вы запускали npm install, удалите его и переустановите через pnpm."
        : "- package-lock.json present in a pnpm workspace. If you ran npm install, remove it and reinstall with pnpm.",
    );
  }

  if (fs.existsSync(srcEntry) && !fs.existsSync(tsxBin)) {
    warnings.push(isXClawMode() ? "- бинарный файл tsx отсутствует для запуска из исходников. Выполните: pnpm install" : "- tsx binary is missing for source runs. Run: pnpm install");
  }

  if (warnings.length > 0) {
    note(warnings.join("\n"), isXClawMode() ? "Установка" : "Install");
  }
}
