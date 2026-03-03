import { IS_XCLAW_MODE } from "../xclaw/mode.js";

// Lobster palette tokens for CLI/UI theming. "lobster seam" == use this palette.
// Keep in sync with docs/cli/index.md (CLI palette section).
const IS_XCLAW = IS_XCLAW_MODE;

export const DIAMOND_PALETTE = {
  accent: IS_XCLAW ? "#808080" : "#FF5A2D",
  accentBright: IS_XCLAW ? "#A9A9A9" : "#FF7A3D",
  accentDim: IS_XCLAW ? "#696969" : "#D14A22",
  info: IS_XCLAW ? "#D3D3D3" : "#FF8A5B",
  success: "#2FBF71",
  warn: "#FFB020",
  error: "#E23D2D",
  muted: "#8B7F77",
} as const;
