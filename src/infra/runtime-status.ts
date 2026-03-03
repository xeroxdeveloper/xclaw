import { IS_XCLAW_MODE } from "../xclaw/mode.js";

type RuntimeStatusFormatInput = {
  status?: string;
  pid?: number;
  state?: string;
  details?: string[];
};

export function formatRuntimeStatusWithDetails({
  status,
  pid,
  state,
  details = [],
}: RuntimeStatusFormatInput): string {
  const IS_XCLAW = IS_XCLAW_MODE;
  const runtimeStatus = status ?? (IS_XCLAW ? "неизвестно" : "unknown");
  const fullDetails: string[] = [];
  if (pid) {
    fullDetails.push(`pid ${pid}`);
  }
  if (state && state.toLowerCase() !== runtimeStatus) {
    fullDetails.push(`${IS_XCLAW ? "статус" : "state"} ${state}`);
  }
  for (const detail of details) {
    if (detail) {
      fullDetails.push(detail);
    }
  }
  return fullDetails.length > 0 ? `${runtimeStatus} (${fullDetails.join(", ")})` : runtimeStatus;
}
