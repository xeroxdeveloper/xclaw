import { IS_XCLAW_MODE, isXClawMode, resolveOnlyChannelsFromEnv, resolveOnlyModelProvidersFromEnv, resolveTelegramNativeCommandAllowlist, resolveTelegramOwnerIds } from "../../xclaw/mode.js";
import type { Command } from "commander";
import { formatDocsLink } from "../../terminal/links.js";
import { isRich, theme } from "../../terminal/theme.js";
import { escapeRegExp } from "../../utils.js";
import { t } from "../../xclaw/i18n.js";
import { hasFlag, hasRootVersionAlias } from "../argv.js";
import { formatCliBannerLine, hasEmittedCliBanner } from "../banner.js";
import { replaceCliName, resolveCliName } from "../cli-name.js";
import { CLI_LOG_LEVEL_VALUES, parseCliLogLevelOption } from "../log-level-option.js";
import { getCoreCliCommandsWithSubcommands } from "./command-registry.js";
import type { ProgramContext } from "./context.js";
import { getSubCliCommandsWithSubcommands } from "./register.subclis.js";

const CLI_NAME = resolveCliName();
const CLI_NAME_PATTERN = escapeRegExp(CLI_NAME);
const ROOT_COMMANDS_WITH_SUBCOMMANDS = new Set([
  ...getCoreCliCommandsWithSubcommands(),
  ...getSubCliCommandsWithSubcommands(),
]);
const ROOT_COMMANDS_HINT = t("help.hint");

const EXAMPLES = [
  ["xclaw models --help", "Показать детальную справку по команде models."],
  [
    "xclaw channels login --verbose",
    "Привязать личный WhatsApp Web и показать QR + логи подключения.",
  ],
  [
    'xclaw message send --target +15555550123 --message "Привет" --json',
    "Отправить сообщение и вывести результат в формате JSON.",
  ],
  ["xclaw gateway --port 18789", "Запустить WebSocket шлюз локально."],
  ["xclaw --dev gateway", "Запустить шлюз в режиме разработки (изолированный конфиг)."],
  ["xclaw gateway --force", "Принудительно освободить порт и запустить шлюз."],
  ["xclaw gateway ...", "Управление шлюзом через WebSocket."],
  [
    'xclaw agent --to +15555550123 --message "Отчет" --deliver',
    "Поговорить напрямую с агентом через шлюз.",
  ],
  [
    'xclaw message send --channel telegram --target @mychat --message "Привет"',
    "Отправить через вашего Telegram бота.",
  ],
] as const;

export function configureProgramHelp(program: Command, ctx: ProgramContext) {
  program
    .name(CLI_NAME)
    .description("")
    .version(ctx.programVersion)
    .option(
      "--dev",
      IS_XCLAW_MODE
        ? "Режим разработки: изолированное состояние в ~/.xclaw-dev, порт 19001."
        : "Dev profile: isolate state under ~/.openclaw-dev, default gateway port 19001, and shift derived ports (browser/canvas)",
    )
    .option(
      "--profile <name>",
      IS_XCLAW_MODE
        ? "Использовать именованный профиль (изолирует конфиг в ~/.xclaw-<имя>)"
        : "Use a named profile (isolates OPENCLAW_STATE_DIR/OPENCLAW_CONFIG_PATH under ~/.openclaw-<name>)",
    )
    .option(
      "--log-level <level>",
      IS_XCLAW_MODE
        ? `Переопределение уровня логирования (${CLI_LOG_LEVEL_VALUES})`
        : `Global log level override for file + console (${CLI_LOG_LEVEL_VALUES})`,
      parseCliLogLevelOption,
    );

  program.option("--no-color", IS_XCLAW_MODE ? "Отключить цвета ANSI" : "Disable ANSI colors", false);
  program.helpOption("-h, --help", IS_XCLAW_MODE ? "Показать справку" : "Display help for command");
  program.helpCommand("help [command]", IS_XCLAW_MODE ? "Показать справку по команде" : "Display help for command");

  program.configureHelp({
    // sort options and subcommands alphabetically
    sortSubcommands: true,
    sortOptions: true,
    optionTerm: (option) => theme.option(option.flags),
    subcommandTerm: (cmd) => {
      const isRootCommand = cmd.parent === program;
      const hasSubcommands = isRootCommand && ROOT_COMMANDS_WITH_SUBCOMMANDS.has(cmd.name());
      return theme.command(hasSubcommands ? `${cmd.name()} *` : cmd.name());
    },
  });

  const formatHelpOutput = (str: string) => {
    let output = str;
    const isRootHelp = new RegExp(
      `^Usage:\\s+${CLI_NAME_PATTERN}\\s+\\[options\\]\\s+\\[command\\]\\s*$`,
      "m",
    ).test(output);
    if (isRootHelp && /^Commands:/m.test(output)) {
      output = output.replace(/^Commands:/m, `${t("help.commands")}\n  ${theme.muted(ROOT_COMMANDS_HINT)}`);
    }

    return output
      .replace(/^Usage:/gm, theme.heading(t("help.usage")))
      .replace(/^Options:/gm, theme.heading(t("help.options")))
      .replace(/^Commands:/gm, theme.heading(t("help.commands")))
      .replace(/^Arguments:/gm, theme.heading(t("help.arguments")));
  };

  program.configureOutput({
    writeOut: (str) => {
      process.stdout.write(formatHelpOutput(str));
    },
    writeErr: (str) => {
      process.stderr.write(formatHelpOutput(str));
    },
    outputError: (str, write) => write(theme.error(str)),
  });

  if (
    hasFlag(process.argv, "-V") ||
    hasFlag(process.argv, "--version") ||
    hasRootVersionAlias(process.argv)
  ) {
    console.log(ctx.programVersion);
    process.exit(0);
  }

  program.addHelpText("beforeAll", () => {
    if (hasEmittedCliBanner()) {
      return "";
    }
    const rich = isRich();
    const line = formatCliBannerLine(ctx.programVersion, { richTty: rich });
    return `\n${line}\n`;
  });

  const fmtExamples = EXAMPLES.map(
    ([cmd, desc]) => `  ${theme.command(replaceCliName(cmd, CLI_NAME))}\n    ${theme.muted(desc)}`,
  ).join("\n");

  program.addHelpText("afterAll", ({ command }) => {
    if (command !== program) {
      return "";
    }
    const docs = formatDocsLink("/cli", "docs.openclaw.ai/cli");
    return `\n${theme.heading(t("help.examples"))}\n${fmtExamples}\n\n${theme.muted(t("help.docs"))} ${docs}\n`;
  });
}
