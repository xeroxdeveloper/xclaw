import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Command } from "commander";
import { theme } from "../../terminal/theme.js";
import { CONFIG_PATH } from "../../config/config.js";
import JSON5 from "json5";
import { multiselect, intro, outro, cancel, isCancel } from "@clack/prompts";

export function registerRemoveOwnerCommand(program: Command) {
  program
    .command("remove")
    .description("Интерактивное удаление Telegram ID из списка владельцев")
    .action(async () => {
      if (!existsSync(CONFIG_PATH)) {
        console.error(theme.error("Ошибка: Конфиг не найден. Сначала запустите 'xclaw onboard'"));
        process.exit(1);
      }

      try {
        const raw = readFileSync(CONFIG_PATH, "utf8");
        const config = JSON5.parse(raw);
        const allowFrom: Array<string | number> = config.channels?.telegram?.allowFrom || [];

        if (allowFrom.length === 0) {
          console.log(theme.info("Список владельцев пуст. Некого удалять."));
          return;
        }

        intro(theme.heading("Удаление владельцев XClaw"));

        const selectedIds = await multiselect({
          message: "Выберите ID для удаления (используйте Пробел для выбора, Enter для подтверждения)",
          options: allowFrom.map((id) => ({
            value: String(id),
            label: String(id),
          })),
          required: false,
        });

        if (isCancel(selectedIds)) {
          cancel("Удаление отменено.");
          process.exit(0);
        }

        const idsToRemove = selectedIds as string[];
        if (idsToRemove.length === 0) {
          outro(theme.muted("Никто не был выбран. Изменения не внесены."));
          return;
        }

        const nextAllowFrom = allowFrom.filter((id) => !idsToRemove.includes(String(id)));
        config.channels.telegram.allowFrom = nextAllowFrom;

        writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
        
        outro(theme.success(`Успешно удалено ${idsToRemove.length} пользователей: ${idsToRemove.join(", ")}`));
        console.log(theme.warn("Перезапустите 'xclaw gateway' для применения изменений."));
      } catch (err) {
        console.error(theme.error("Ошибка при выполнении команды:"), err);
      }
    });
}
