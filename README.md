# 📦 XClaw — Box Alpha

<p align="center">
    <pre>
▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
       .
      / \
     /   \
    /     \
   <       >
    \     /
     \   /
      \ /
       '
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
                    📦 XCLAW 📦
    </pre>
</p>

<p align="center">
  <strong>Ваши чаты — чистая огранка, блестящий результат.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Status-Box_Alpha-orange?style=for-the-badge" alt="Status">
  <img src="https://img.shields.io/badge/Focus-Telegram_First-0088cc?style=for-the-badge" alt="Telegram First">
</p>

---

**XClaw** — это элитный персональный AI-ассистент, созданный как независимый форк для тех, кто ценит скорость, приватность и безупречный UX в Telegram. В отличие от других решений, XClaw сфокусирован на работе с **Telegram API**, **OpenAI** и **Gemini**, предлагая уникальные возможности управления и глубокую кастомизацию.

## ✨ Ключевые особенности

- **📦 Telegram First:** Оптимизированный движок для Telegram с поддержкой всех современных фич (топики, реакции, файлы).
- **🛑 Кнопка СТОП:** Мгновенное прерывание генерации ответа прямо из чата.
- **🛡️ Новая система авторизации:** Если боту напишет посторонний, вы получите уведомление с кнопками **Разрешить** или **Отклонить**.
- **🐚 Shell-доступ (`/xexec`):** Выполняйте команды терминала прямо из Telegram (только для владельца).
- **⚡ Реакции-статусы:** Визуальное отображение процесса «мыслей» бота через эмодзи-реакции.
- **📦 Компактный режим:** Чистые ответы без лишних технических заголовков.
- **🕵️ Маскировка секретов:** Автоматическое скрытие ваших токенов и ключей из всех логов.
- **🌍 Полная русификация:** Интерфейс CLI и бота полностью переведен на русский язык.

## 🚀 Установка

### Обычный Linux (Ubuntu/Debian)
```bash
sudo apt update && sudo apt install -y nodejs npm git
npm install -g pnpm
git clone https://github.com/xeroxdeveloper/xclaw.git
cd xclaw
pnpm install
pnpm build
./xclaw.mjs onboard
```

### Termux (Android)
```bash
pkg update && pkg upgrade
pkg install nodejs git python
npm install -g pnpm
git clone https://github.com/xeroxdeveloper/xclaw.git
cd xclaw
pnpm install
pnpm build
./xclaw.mjs onboard
```

### UserLand (Android)
Установите дистрибутив Ubuntu внутри UserLand и следуйте инструкциям для «Обычного Linux».

## 🛠️ Команды CLI

- `xclaw onboard` — запустить интерактивную настройку.
- `xclaw gateway` — запустить шлюз XClaw.
- `xclaw add <ID>` — добавить Telegram ID в список владельцев.
- `xclaw remove` — интерактивное удаление ID из списка владельцев.
- `xclaw rank` — управление правами (Owner/Admin) для добавленных ID.
- `xclaw autonomous` — управление автономными постами.
- `xclaw status` — проверить состояние каналов и сессий.
- `xclaw doctor` — диагностика и исправление ошибок.
- `xclaw lang ru|en` — переключить язык интерфейса.
- `xclaw xupdate` — обновить XClaw до последней версии из Git.

## 🔒 Безопасность

XClaw разработан как персональный инструмент. По умолчанию:
- Доступ ограничен через **allowlist** (белый список ID).
- Опасные команды требуют прав владельца.
- Вы можете назначать **Admin** ранг другим пользователям через `xclaw rank`, чтобы они тоже могли управлять доступом (кнопками), но не имели доступа к опасным командам типа `/xexec`.
- Все данные хранятся локально в директории `~/.xclaw`.

---

<p align="center">
  Создано с любовью к деталям и страстью к автоматизации. 📦
</p>
