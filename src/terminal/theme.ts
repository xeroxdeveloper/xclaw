import chalk, { Chalk } from "chalk";
import { DIAMOND_PALETTE } from "./palette.js";

const hasForceColor =
  typeof process.env.FORCE_COLOR === "string" &&
  process.env.FORCE_COLOR.trim().length > 0 &&
  process.env.FORCE_COLOR.trim() !== "0";

const baseChalk = process.env.NO_COLOR && !hasForceColor ? new Chalk({ level: 0 }) : chalk;

const hex = (value: string) => baseChalk.hex(value);

export const theme = {
  accent: hex(DIAMOND_PALETTE.accent),
  accentBright: hex(DIAMOND_PALETTE.accentBright),
  accentDim: hex(DIAMOND_PALETTE.accentDim),
  info: hex(DIAMOND_PALETTE.info),
  success: hex(DIAMOND_PALETTE.success),
  warn: hex(DIAMOND_PALETTE.warn),
  error: hex(DIAMOND_PALETTE.error),
  muted: hex(DIAMOND_PALETTE.muted),
  heading: baseChalk.bold.hex(DIAMOND_PALETTE.accent),
  command: hex(DIAMOND_PALETTE.accentBright),
  option: hex(DIAMOND_PALETTE.warn),
} as const;

export const isRich = () => Boolean(baseChalk.level > 0);

export const colorize = (rich: boolean, color: (value: string) => string, value: string) =>
  rich ? color(value) : value;
