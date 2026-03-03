import { IS_XCLAW_MODE } from "../xclaw/mode.js";
import { formatRuntimeStatusWithDetails } from "../infra/runtime-status.js";

export type ServiceRuntimeLike = {
  status?: string;
  state?: string;
  subState?: string;
  pid?: number;
  lastExitStatus?: number;
  lastExitReason?: string;
  lastRunResult?: string;
  lastRunTime?: string;
  detail?: string;
};

export function formatRuntimeStatus(runtime: ServiceRuntimeLike | undefined): string | null {
  if (!runtime) {
    return null;
  }
  const IS_XCLAW = IS_XCLAW_MODE;
  const details: string[] = [];
  if (runtime.subState) {
    details.push(`${IS_XCLAW ? "состояние" : "sub"} ${runtime.subState}`);
  }
  if (runtime.lastExitStatus !== undefined) {
    details.push(`${IS_XCLAW ? "последний выход" : "last exit"} ${runtime.lastExitStatus}`);
  }
  if (runtime.lastExitReason) {
    details.push(`${IS_XCLAW ? "причина" : "reason"} ${runtime.lastExitReason}`);
  }
  if (runtime.lastRunResult) {
    details.push(`${IS_XCLAW ? "последний результат" : "last run"} ${runtime.lastRunResult}`);
  }
  if (runtime.lastRunTime) {
    details.push(`${IS_XCLAW ? "последний запуск" : "last run time"} ${runtime.lastRunTime}`);
  }
  if (runtime.detail) {
    details.push(runtime.detail);
  }
  
  let status = runtime.status;
  if (IS_XCLAW) {
    if (status === "running") status = "запущено";
    if (status === "stopped") status = "остановлено";
    if (status === "error") status = "ошибка";
  }

  return formatRuntimeStatusWithDetails({
    status,
    pid: runtime.pid,
    state: runtime.state,
    details,
  });
}
