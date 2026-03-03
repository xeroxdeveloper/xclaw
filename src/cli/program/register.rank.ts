import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Command } from "commander";
import { theme } from "../../terminal/theme.js";
import { CONFIG_PATH } from "../../config/config.js";
import JSON5 from "json5";
import { select, intro, outro, cancel, isCancel } from "@clack/prompts";

export function registerRankCommand(program: Command) {
  program
    .command("rank")
    .description("Интерактивное управление правами пользователей")
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
          console.log(theme.info("Список владельцев пуст. Добавьте кого-нибудь через 'xclaw add'."));
          return;
        }

        intro(theme.heading("Управление рангами XClaw"));

        const userId = await select({
          message: "Выберите пользователя для изменения ранга",
          options: allowFrom.map((id) => ({
            value: String(id),
            label: String(id),
            hint: config.xclaw?.ranks?.[String(id)] || "нет ранга",
          })),
        });

        if (isCancel(userId)) {
          cancel("Отменено.");
          return;
        }

        const rank = await select({
          message: `Выберите ранг для ${userId}`,
          options: [
            { value: "owner", label: "Owner (Владелец)", hint: "Полный доступ к боту и CLI" },
            { value: "admin", label: "Admin (Админ)", hint: "Доступ к кнопкам Разрешить/Отклонить" },
            { value: "none", label: "None (Обычный)", hint: "Только общение (если разрешено)" },
          ],
        });

        if (isCancel(rank)) {
          cancel("Отменено.");
          return;
        }

        if (!config.xclaw) config.xclaw = {};
        if (!config.xclaw.ranks) config.xclaw.ranks = {};

        if (rank === "none") {
          delete config.xclaw.ranks[String(userId)];
        } else {
          config.xclaw.ranks[String(userId)] = rank;
        }

        writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
        
        outro(theme.success(`Ранг пользователя ${userId} изменен на ${rank}.`));
        console.log(theme.warn("Перезапустите 'xclaw gateway' для применения изменений."));
      } catch (err) {
        console.error(theme.error("Ошибка при выполнении команды:"), err);
      }
    });
}
