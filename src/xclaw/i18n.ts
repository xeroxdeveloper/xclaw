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
    "configure.description": "Интерактивный мастер настройки ключей, каналов, шлюза и параметров агента",
    "config.description": "Помощники настройки (get/set/unset/file/validate). По умолчанию: запускает мастер.",
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
    "update.description": "Обновить XClaw до последней версии",
    "help.usage": "Использование:",
    "help.options": "Опции:",
    "help.commands": "Команды:",
    "help.arguments": "Аргументы:",
    "help.examples": "Примеры:",
    "help.docs": "Документация:",
    "help.hint": "Подсказка: команды с суффиксом * имеют подкоманды. Запустите <команда> --help для деталей.",
    "auth.choice.message": "Провайдер моделей/аутентификации",
    "auth.method.message": "Метод аутентификации {label}",
    "auth.skip": "Пропустить пока что",
    "auth.back": "Назад",
    "onboard.mode.message": "Режим настройки",
    "onboard.mode.quick": "Быстрый старт",
    "onboard.mode.manual": "Ручная настройка",
    "auth.api_key.how": "Как вы хотите предоставить API ключ?",
    "auth.api_key.paste": "Вставить API ключ сейчас",
    "auth.api_key.env": "Использовать переменную окружения",
    "auth.api_key.enter": "Введите API ключ {label}",
    "model.configured.title": "Модель настроена",
    "model.configured.message": "Модель по умолчанию установлена: {model}",
    "model.default.message": "Модель по умолчанию",
    "channel.status.title": "Статус каналов",
    "channel.how.title": "Как работают каналы",
    "channel.how.pairing": "Безопасность ЛС: по умолчанию используется 'pairing'; для неизвестных контактов генерируется код сопряжения.",
    "channel.how.approve": "Одобрить: {cmd} pairing approve <channel> <code>",
    "channel.how.open": "Публичные ЛС: требуется dmPolicy='open' + allowFrom=['*'].",
    "channel.how.multiuser": "Многопользовательский режим: выполните '{cmd} config set session.dmScope \"per-channel-peer\"' для изоляции сессий.",
    "channel.select.message": "Выберите канал (Быстрый старт)",
    "channel.selected.title": "Выбранные каналы",
    "onboard.success.title": "Настройка завершена!",
    "onboard.success.message": "XClaw Box Alpha готов к работе. Используйте '/help' в Telegram.",
    "onboard.risk.message": "Я понимаю, что это персональный инструмент по умолчанию, и совместное использование требует защиты. Продолжить?",
    "onboard.invalid.config": "Невалидный конфиг",
    "onboard.config.issues": "Проблемы конфига",
    "onboard.config.invalid_outro": "Конфиг невалиден. Запустите '{cmd}' для исправления, затем повторите настройку.",
    "onboard.config.handling": "Работа с конфигом",
    "onboard.config.keep": "Использовать текущие значения",
    "onboard.config.modify": "Обновить значения",
    "onboard.config.reset": "Сбросить",
    "onboard.reset.scope": "Область сброса",
    "onboard.reset.config": "Только конфиг",
    "onboard.reset.creds": "Конфиг + ключи + сессии",
    "onboard.reset.full": "Полный сброс (все данные)",
    "onboard.workspace.message": "Рабочая директория",
    "auth.no_api.hint": "Скоро...",
    "auth.local_ai.hint": "локальная модель",
  },
  en: {
    "setup.description": "Initialize local config and agent workspace",
    "onboard.description": "Interactive onboarding wizard for gateway, workspace, and skills",
    "configure.description": "Interactive setup wizard for credentials, channels, gateway, and agent defaults",
    "config.description": "Non-interactive config helpers (get/set/unset/file/validate). Default: starts setup wizard.",
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
    "auth.api_key.how": "How do you want to provide this API key?",
    "auth.api_key.paste": "Paste API key now",
    "auth.api_key.env": "Use environment variable",
    "auth.api_key.enter": "Enter {label} API key",
    "model.configured.title": "Model configured",
    "model.configured.message": "Default model set to {model}",
    "model.default.message": "Default model",
    "channel.status.title": "Channel status",
    "channel.how.title": "How channels work",
    "channel.how.pairing": "DM security: default is pairing; unknown DMs get a pairing code.",
    "channel.how.approve": "Approve with: {cmd} pairing approve <channel> <code>",
    "channel.how.open": "Public DMs require dmPolicy='open' + allowFrom=['*'].",
    "channel.how.multiuser": "Multi-user DMs: run: {cmd} config set session.dmScope \"per-channel-peer\" to isolate sessions.",
    "channel.select.message": "Select channel (QuickStart)",
    "channel.selected.title": "Selected channels",
    "onboard.success.title": "Onboarding complete!",
    "onboard.success.message": "XClaw Box Alpha is ready. Use '/help' in Telegram.",
    "onboard.risk.message": "I understand this is personal-by-default and shared/multi-user use requires lock-down. Continue?",
    "onboard.invalid.config": "Invalid config",
    "onboard.config.issues": "Config issues",
    "onboard.config.invalid_outro": "Config invalid. Run '{cmd}' to repair it, then re-run onboarding.",
    "onboard.config.handling": "Config handling",
    "onboard.config.keep": "Use existing values",
    "onboard.config.modify": "Update values",
    "onboard.config.reset": "Reset",
    "onboard.reset.scope": "Reset scope",
    "onboard.reset.config": "Config only",
    "onboard.reset.creds": "Config + creds + sessions",
    "onboard.reset.full": "Full reset (all data)",
    "onboard.workspace.message": "Workspace directory",
  },
};

export function t(key: string, params: Record<string, string> = {}): string {
  let text = translations[currentLang]?.[key] || translations["en"]?.[key] || key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(`{${k}}`, v);
  }
  return text;
}
