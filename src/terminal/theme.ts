import chalk, { Chalk } from "chalk";
import { BOX_PALETTE } from "./palette.js";

const hasForceColor =
  typeof process.env.FORCE_COLOR === "string" &&
  process.env.FORCE_COLOR.trim().length > 0 &&
  process.env.FORCE_COLOR.trim() !== "0";

const baseChalk = process.env.NO_COLOR && !hasForceColor ? new Chalk({ level: 0 }) : chalk;

const hex = (value: string) => baseChalk.hex(value);

export const theme = {
  accent: hex(BOX_PALETTE.accent),
  accentBright: hex(BOX_PALETTE.accentBright),
  accentDim: hex(BOX_PALETTE.accentDim),
  info: hex(BOX_PALETTE.info),
  success: hex(BOX_PALETTE.success),
  warn: hex(BOX_PALETTE.warn),
  error: hex(BOX_PALETTE.error),
  muted: hex(BOX_PALETTE.muted),
  heading: baseChalk.bold.hex(BOX_PALETTE.accent),
  command: hex(BOX_PALETTE.accentBright),
  option: hex(BOX_PALETTE.warn),
} as const;

export const isRich = () => Boolean(baseChalk.level > 0);

export const colorize = (rich: boolean, color: (value: string) => string, value: string) =>
  rich ? color(value) : value;
