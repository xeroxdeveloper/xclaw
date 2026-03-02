import { Command } from "commander";
import { writeConfigFile, readConfigFileSnapshot } from "../../config/config.js";
import { theme } from "../../terminal/theme.js";
import { setLang } from "../../xclaw/i18n.js";

export function registerLangCommand(program: Command) {
  program
    .command("lang <code..>")
    .description("Настройка языка CLI (ru/en)")
    .action(async (code: string[]) => {
      const lang = code[0].toLowerCase();
      if (lang !== "ru" && lang !== "en") {
        console.error(theme.error("Некорректный код языка. Используйте 'ru' или 'en'."));
        process.exit(1);
      }

      const snapshot = await readConfigFileSnapshot();
      const config = snapshot.valid ? snapshot.config : {};

      if (!config.xclaw) {
        config.xclaw = {};
      }
      config.xclaw.lang = lang;

      await writeConfigFile(config);
      setLang(lang);
      console.log(theme.success(lang === "ru" ? `Язык изменен на RU.` : `Language set to EN.`));
    });
}
