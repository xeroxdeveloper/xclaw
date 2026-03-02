import { readFileSync, existsSync } from "node:fs";
import JSON5 from "json5";
import { CONFIG_PATH } from "../config/config.js";
import { isXClawMode } from "./mode.js";

let currentLang = "ru";

function loadLang() {
  if (!isXClawMode()) {
    currentLang = "en";
    return;
  }

  try {
    if (existsSync(CONFIG_PATH)) {
      const config = JSON5.parse(readFileSync(CONFIG_PATH, "utf8"));
      if (config?.xclaw?.lang) {
        currentLang = config.xclaw.lang;
      }
    }
  } catch {
    // ignore
  }
}

loadLang();

export function getLang() {
  return currentLang;
}

export function setLang(lang: string) {
  currentLang = lang;
}

const translations: Record<string, Record<string, string>> = {
  ru: {
    "setup.description": "Инициализация локального конфига и рабочей области",
    "onboard.description": "Интерактивный мастер настройки шлюза, рабочей области и навыков",
    "configure.description":
      "Интерактивный мастер настройки ключей, каналов, шлюза и параметров агента",
    "config.description":
      "Помощники настройки (get/set/unset/file/validate). По умолчанию: запускает мастер.",
    "doctor.description": "Проверка здоровья и быстрые исправления для шлюза и каналов",
    "dashboard.description": "Открыть панель управления (Control UI) с текущим токеном",
    "reset.description": "Сброс локального конфига/состояния (CLI остается)",
    "uninstall.description": "Удаление службы шлюза и локальных данных",
    "message.description": "Отправка, чтение и управление сообщениями",
    "memory.description": "Поиск и переиндексация файлов памяти",
    "agent.description": "Выполнить один ход агента через шлюз",
    "agents.description": "Управление изолированными агентами",
    "status.description": "Показать здоровье каналов и последних получателей",
    "health.description": "Получить данные о здоровье работающего шлюза",
    "sessions.description": "Список сохраненных сессий диалогов",
    "browser.description": "Управление выделенным браузером (Chrome/Chromium)",
    "lang.description": "Настройка языка CLI (ru/en)",
    "auth.choice.message": "Провайдер моделей/аутентификации",
    "auth.method.message": "Метод аутентификации {label}",
    "auth.skip": "Пропустить пока что",
    "auth.back": "Назад",
    "onboard.mode.message": "Режим настройки",
    "onboard.mode.quick": "Быстрый старт",
    "onboard.mode.manual": "Ручная настройка",
  },
  en: {
    "setup.description": "Initialize local config and agent workspace",
    "onboard.description": "Interactive onboarding wizard for gateway, workspace, and skills",
    "configure.description":
      "Interactive setup wizard for credentials, channels, gateway, and agent defaults",
    "config.description":
      "Non-interactive config helpers (get/set/unset/file/validate). Default: starts setup wizard.",
    "doctor.description": "Health checks + quick fixes for the gateway and channels",
    "dashboard.description": "Open the Control UI with your current token",
    "reset.description": "Reset local config/state (keeps the CLI installed)",
    "uninstall.description": "Uninstall the gateway service + local data (CLI remains)",
    "message.description": "Send, read, and manage messages",
    "memory.description": "Search and reindex memory files",
    "agent.description": "Run one agent turn via the Gateway",
    "agents.description": "Manage isolated agents (workspaces, auth, routing)",
    "status.description": "Show channel health and recent session recipients",
    "health.description": "Fetch health from the running gateway",
    "sessions.description": "List stored conversation sessions",
    "browser.description": "Manage OpenClaw's dedicated browser (Chrome/Chromium)",
    "lang.description": "Set CLI language (ru/en)",
    "auth.choice.message": "Model/auth provider",
    "auth.method.message": "{label} auth method",
    "auth.skip": "Skip for now",
    "auth.back": "Back",
    "onboard.mode.message": "Onboarding mode",
    "onboard.mode.quick": "QuickStart",
    "onboard.mode.manual": "Manual",
  },
};

export function t(key: string, params: Record<string, string> = {}): string {
  let text = translations[currentLang]?.[key] || translations["en"]?.[key] || key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(`{${k}}`, v);
  }
  return text;
}
