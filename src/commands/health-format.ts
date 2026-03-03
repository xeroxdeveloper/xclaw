import { IS_XCLAW_MODE } from "../xclaw/mode.js";
import { colorize, isRich, theme } from "../terminal/theme.js";

const formatKv = (line: string, rich: boolean) => {
  const IS_XCLAW = IS_XCLAW_MODE;
  const idx = line.indexOf(": ");
  if (idx <= 0) {
    return colorize(rich, theme.muted, line);
  }
  let key = line.slice(0, idx);
  const value = line.slice(idx + 2);

  if (IS_XCLAW) {
    if (key === "Gateway target") key = "Цель шлюза";
    if (key === "Config") key = "Конфиг";
    if (key === "Source") key = "Источник";
    if (key === "Bind") key = "Привязка";
  }

  const valueColor =
    key === "Gateway target" || key === "Цель шлюза" || key === "Config" || key === "Конфиг"
      ? theme.command
      : key === "Source" || key === "Источник"
        ? theme.muted
        : theme.info;

  return `${colorize(rich, theme.muted, `${key}:`)} ${colorize(rich, valueColor, value)}`;
};

export function formatHealthCheckFailure(err: unknown, opts: { rich?: boolean } = {}): string {
  const rich = opts.rich ?? isRich();
  const raw = String(err);
  const IS_XCLAW = IS_XCLAW_MODE;
  const message = err instanceof Error ? err.message : raw;

  const translatedRaw = IS_XCLAW 
    ? raw.replace("gateway closed", "шлюз закрыт")
         .replace("abnormal closure", "аномальное закрытие")
         .replace("no close reason", "причина не указана")
    : raw;

  if (!rich) {
    return IS_XCLAW ? `Ошибка проверки здоровья: ${translatedRaw}` : `Health check failed: ${raw}`;
  }

  const lines = message
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(Boolean);
  const detailsIdx = lines.findIndex((l) => l.startsWith("Gateway target: "));

  const summaryLines = (detailsIdx >= 0 ? lines.slice(0, detailsIdx) : lines)
    .map((l) => l.trim())
    .filter(Boolean);
  const detailLines = detailsIdx >= 0 ? lines.slice(detailsIdx) : [];

  const summary = summaryLines.length > 0 ? summaryLines.join(" ") : message;
  const header = colorize(rich, theme.error.bold, IS_XCLAW ? "Ошибка проверки здоровья" : "Health check failed");

  const out: string[] = [`${header}: ${IS_XCLAW ? summary.replace("gateway closed", "шлюз закрыт") : summary}`];
  for (const line of detailLines) {
    out.push(`  ${formatKv(line, rich)}`);
  }
  return out.join("\n");
}
