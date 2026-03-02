import { execSync } from "node:child_process";
import { Command } from "commander";
import { theme } from "../../terminal/theme.js";

export function registerUpdateCommand(program: Command) {
  program
    .command("xupdate")
    .description("Обновить XClaw до последней версии из Git")
    .action(async () => {
      console.log(theme.info("Проверка обновлений..."));
      try {
        const output = execSync("git pull", { encoding: "utf8" });
        console.log(theme.success("Обновление завершено!"));
        console.log(theme.muted(output));
        console.log(theme.warn("Рекомендуется перезапустить бота."));
      } catch (err) {
        console.error(theme.error("Ошибка при обновлении:"), err);
      }
    });
}
