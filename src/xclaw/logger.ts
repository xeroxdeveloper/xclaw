import { createSubsystemLogger } from "../logging/subsystem.js";
import { isXClawMode } from "./mode.js";

const log = createSubsystemLogger("xclaw");

export function xlog(message: string, description?: string) {
  const IS_XCLAW = isXClawMode();
  const finalMsg = IS_XCLAW ? message : (description || message);
  log.info(finalMsg);
  if (description && IS_XCLAW) {
    log.debug(`[Описание] ${description}`);
  }
}
