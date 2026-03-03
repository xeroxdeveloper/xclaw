import { IS_XCLAW_MODE, isXClawMode, resolveOnlyChannelsFromEnv, resolveOnlyModelProvidersFromEnv, resolveTelegramNativeCommandAllowlist, resolveTelegramOwnerIds } from "../xclaw/mode.js";

// Lobster palette tokens for CLI/UI theming. "lobster seam" == use this palette.
// Keep in sync with docs/cli/index.md (CLI palette section).

export const BOX_PALETTE = {
  accent: IS_XCLAW_MODE ? "#808080" : "#FF5A2D",
  accentBright: IS_XCLAW_MODE ? "#A9A9A9" : "#FF7A3D",
  accentDim: IS_XCLAW_MODE ? "#696969" : "#D14A22",
  info: IS_XCLAW_MODE ? "#D3D3D3" : "#FF8A5B",
  success: "#2FBF71",
  warn: "#FFB020",
  error: "#E23D2D",
  muted: "#8B7F77",
} as const;
