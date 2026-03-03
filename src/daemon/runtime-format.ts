import { isXClawMode } from "../xclaw/mode.js";
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
    details.push(`${isXClawMode() ? "состояние" : "sub"} ${runtime.subState}`);
  }
  if (runtime.lastExitStatus !== undefined) {
    details.push(`${isXClawMode() ? "последний выход" : "last exit"} ${runtime.lastExitStatus}`);
  }
  if (runtime.lastExitReason) {
    details.push(`${isXClawMode() ? "причина" : "reason"} ${runtime.lastExitReason}`);
  }
  if (runtime.lastRunResult) {
    details.push(`${isXClawMode() ? "последний результат" : "last run"} ${runtime.lastRunResult}`);
  }
  if (runtime.lastRunTime) {
    details.push(`${isXClawMode() ? "последний запуск" : "last run time"} ${runtime.lastRunTime}`);
  }
  if (runtime.detail) {
    details.push(runtime.detail);
  }
  
  let status = runtime.status;
  if (isXClawMode()) {
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
