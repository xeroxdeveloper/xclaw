import { isXClawMode } from "../xclaw/mode.js";
import { formatCliCommand } from "../cli/command-format.js";

export function isSystemdUnavailableDetail(detail?: string): boolean {
  if (!detail) {
    return false;
  }
  const normalized = detail.toLowerCase();
  return (
    normalized.includes("systemctl --user unavailable") ||
    normalized.includes("systemctl not available") ||
    normalized.includes("not been booted with systemd") ||
    normalized.includes("failed to connect to bus") ||
    normalized.includes("systemd user services are required")
  );
}

export function renderSystemdUnavailableHints(options: { wsl?: boolean } = {}): string[] {
  if (options.wsl) {
    return isXClawMode()
      ? [
          "В WSL2 должен быть включен systemd: добавьте [boot]\\nsystemd=true в /etc/wsl.conf",
          "Затем выполните: wsl --shutdown (в PowerShell) и перезапустите дистрибутив.",
          "Проверка: systemctl --user status",
        ]
      : [
          "WSL2 needs systemd enabled: edit /etc/wsl.conf with [boot]\\nsystemd=true",
          "Then run: wsl --shutdown (from PowerShell) and reopen your distro.",
          "Verify: systemctl --user status",
        ];
  }
  return isXClawMode()
    ? [
        "Пользовательские службы systemd недоступны; установите/включите systemd или запустите шлюз через ваш менеджер процессов.",
        `Если вы в контейнере, запустите шлюз в интерактивном режиме вместо \`${formatCliCommand("xclaw gateway")}\`.`,
      ]
    : [
        "systemd user services are unavailable; install/enable systemd or run the gateway under your supervisor.",
        `If you're in a container, run the gateway in the foreground instead of \`${formatCliCommand("openclaw gateway")}\`.`,
      ];
}
