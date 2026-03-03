import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Command } from "commander";
import { theme } from "../../terminal/theme.js";
import { CONFIG_PATH } from "../../config/config.js";
import JSON5 from "json5";

export function registerAddOwnerCommand(program: Command) {
  program
    .command("add <id>")
    .description("Добавить Telegram ID в список владельцев бота")
    .action(async (id: string) => {
      const normalizedId = id.trim().toLowerCase();
      if (!/^\d+$/.test(normalizedId) && !normalizedId.startsWith("tg:")) {
         console.error(theme.error("Ошибка: Введите числовой Telegram ID (например: 12345678)"));
         process.exit(1);
      }
      
      const finalId = normalizedId.startsWith("tg:") ? normalizedId : `tg:${normalizedId}`;

      if (!existsSync(CONFIG_PATH)) {
        console.error(theme.error("Ошибка: Конфиг не найден. Сначала запустите 'xclaw onboard'"));
        process.exit(1);
      }

      try {
        const raw = readFileSync(CONFIG_PATH, "utf8");
        const config = JSON5.parse(raw);

        if (!config.channels) config.channels = {};
        if (!config.channels.telegram) config.channels.telegram = {};
        
        const allowFrom = config.channels.telegram.allowFrom || [];
        
        if (allowFrom.includes(finalId)) {
          console.log(theme.info(`ID ${finalId} уже есть в списке владельцев.`));
          return;
        }

        allowFrom.push(finalId);
        config.channels.telegram.allowFrom = allowFrom;
        
        // Also ensure ownerOnly is enabled if we are adding owners
        if (!config.xclaw) config.xclaw = {};
        config.xclaw.ownerOnly = true;

        writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
        console.log(theme.success(`Пользователь ${finalId} успешно добавлен в владельцы.`));
        console.log(theme.warn("Перезапустите 'xclaw gateway' для применения изменений."));
      } catch (err) {
        console.error(theme.error("Ошибка при обновлении конфига:"), err);
      }
    });
}
