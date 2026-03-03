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
  const details: string[] = [];
  if (runtime.subState) {
    details.push(`${IS_XCLAW_MODE ? "состояние" : "sub"} ${runtime.subState}`);
  }
  if (runtime.lastExitStatus !== undefined) {
    details.push(`${IS_XCLAW_MODE ? "последний выход" : "last exit"} ${runtime.lastExitStatus}`);
  }
  if (runtime.lastExitReason) {
    details.push(`${IS_XCLAW_MODE ? "причина" : "reason"} ${runtime.lastExitReason}`);
  }
  if (runtime.lastRunResult) {
    details.push(`${IS_XCLAW_MODE ? "последний результат" : "last run"} ${runtime.lastRunResult}`);
  }
  if (runtime.lastRunTime) {
    details.push(`${IS_XCLAW_MODE ? "последний запуск" : "last run time"} ${runtime.lastRunTime}`);
  }
  if (runtime.detail) {
    details.push(runtime.detail);
  }
  
  let status = runtime.status;
  if (IS_XCLAW_MODE) {
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
