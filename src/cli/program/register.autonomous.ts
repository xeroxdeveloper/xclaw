import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Command } from "commander";
import { theme } from "../../terminal/theme.js";
import { CONFIG_PATH } from "../../config/config.js";
import JSON5 from "json5";
import { multiselect, intro, outro, cancel, isCancel, text } from "@clack/prompts";

export function registerAutonomousCommand(program: Command) {
  const autonomous = program.command("autonomous").description("Управление автономными постами в Telegram");

  autonomous
    .command("add <chatId> <intervalMs> [prompt...]")
    .description("Добавить автоматический пост в чат")
    .action(async (chatId: string, intervalMs: string, promptParts: string[]) => {
      const ms = Number.parseInt(intervalMs, 10);
      if (Number.isNaN(ms) || ms <= 0) {
        console.error(theme.error("Ошибка: интервал должен быть числом в миллисекундах."));
        process.exit(1);
      }

      const prompt = promptParts.join(" ");

      if (!existsSync(CONFIG_PATH)) {
        console.error(theme.error("Ошибка: Конфиг не найден."));
        process.exit(1);
      }

      try {
        const raw = readFileSync(CONFIG_PATH, "utf8");
        const config = JSON5.parse(raw);

        if (!config.xclaw) config.xclaw = {};
        if (!config.xclaw.autonomous) config.xclaw.autonomous = [];

        config.xclaw.autonomous.push({
          chatId,
          intervalMs: ms,
          prompt: prompt || undefined,
        });

        writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
        console.log(theme.success(`Автономный пост для чата ${chatId} добавлен (интервал: ${ms}мс).`));
      } catch (err) {
        console.error(theme.error("Ошибка при обновлении конфига:"), err);
      }
    });

  autonomous
    .command("status")
    .description("Показать статус автономных постов")
    .action(async () => {
      if (!existsSync(CONFIG_PATH)) {
        console.error(theme.error("Ошибка: Конфиг не найден."));
        process.exit(1);
      }

      try {
        const raw = readFileSync(CONFIG_PATH, "utf8");
        const config = JSON5.parse(raw);
        const entries = config.xclaw?.autonomous || [];

        if (entries.length === 0) {
          console.log(theme.info("Автономные посты не настроены."));
          return;
        }

        console.log(theme.heading("\nСтатус автономных постов XClaw:"));
        const now = Date.now();
        
        for (const entry of entries) {
          const lastRun = entry.lastRunAt ? new Date(entry.lastRunAt).toLocaleString("ru-RU") : "никогда";
          const nextRunMs = entry.lastRunAt ? Math.max(0, entry.intervalMs - (now - entry.lastRunAt)) : 0;
          const nextRun = nextRunMs > 0 ? `через ${Math.round(nextRunMs / 1000)}с` : "сейчас";
          
          console.log(`\n${theme.accent("●")} Чат ID: ${theme.command(entry.chatId)}`);
          console.log(`  Интервал: ${entry.intervalMs}мс`);
          console.log(`  Последний запуск: ${theme.muted(lastRun)}`);
          console.log(`  Следующий запуск: ${theme.info(nextRun)}`);
          if (entry.prompt) {
            console.log(`  Промпт: ${theme.muted(entry.prompt)}`);
          }
        }
        console.log("");
      } catch (err) {
        console.error(theme.error("Ошибка при чтении конфига:"), err);
      }
    });

  autonomous
    .command("remove")
    .description("Удалить автономный пост (интерактивно)")
    .action(async () => {
      if (!existsSync(CONFIG_PATH)) {
        console.error(theme.error("Ошибка: Конфиг не найден."));
        process.exit(1);
      }

      try {
        const raw = readFileSync(CONFIG_PATH, "utf8");
        const config = JSON5.parse(raw);
        const entries = config.xclaw?.autonomous || [];

        if (entries.length === 0) {
          console.log(theme.info("Список автономных постов пуст."));
          return;
        }

        intro(theme.heading("Удаление автономных постов XClaw"));

        const selected = await multiselect({
          message: "Выберите посты для удаления",
          options: entries.map((e: any, i: number) => ({
            value: i,
            label: `Чат: ${e.chatId}, Интервал: ${e.intervalMs}мс`,
            hint: e.prompt ? `Промпт: ${e.prompt.slice(0, 30)}...` : undefined,
          })),
        });

        if (isCancel(selected)) {
          cancel("Удаление отменено.");
          return;
        }

        const indicesToRemove = selected as number[];
        config.xclaw.autonomous = entries.filter((_: any, i: number) => !indicesToRemove.includes(i));

        writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
        outro(theme.success(`Удалено ${indicesToRemove.length} постов.`));
      } catch (err) {
        console.error(theme.error("Ошибка при выполнении команды:"), err);
      }
    });
}
