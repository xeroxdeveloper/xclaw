import { resolveAgentConfig, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { resolveHeartbeatReplyPayload } from "../auto-reply/heartbeat-reply-payload.js";
import { resolveHeartbeatPrompt } from "../auto-reply/heartbeat.js";
import { deliverOutboundPayloads } from "../infra/outbound/deliver.js";
import { buildOutboundSessionContext } from "../infra/outbound/session-context.js";
import { resolveHeartbeatSenderContext } from "../infra/outbound/targets.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { CommandLane } from "../process/lanes.js";
import { defaultRuntime } from "../runtime.js";
import { isXClawMode } from "./mode.js";

const log = createSubsystemLogger("xclaw/autonomous");

/**
 * XClaw Autonomous Mode:
 * Allows the agent to post to specific groups even without being messaged.
 */
export async function runXClawAutonomousCheck() {
  if (!isXClawMode()) {
    return;
  }

  const runtime = defaultRuntime;
  const config = (await import("../config/config.js")).loadConfig();
  
  const autonomous = config.xclaw?.autonomous;
  if (!autonomous || !Array.isArray(autonomous) || autonomous.length === 0) {
    return;
  }

  const now = Date.now();
  
  for (const entry of autonomous) {
    const { chatId, intervalMs, lastRunAt = 0, prompt } = entry;
    
    if (now - lastRunAt < intervalMs) {
      continue;
    }

    log.info(`Running autonomous post for chat ${chatId}`);
    
    try {
      const agentId = resolveDefaultAgentId(config);
      const agentConfig = resolveAgentConfig(config, agentId);
      
      const senderContext = resolveHeartbeatSenderContext({
        channel: "telegram",
        chatId: String(chatId),
      });

      const heartbeatPrompt = await resolveHeartbeatPrompt({
        config,
        agentId,
        customPrompt: prompt || "Вы работаете в автономном режиме. Напишите что-нибудь полезное или интересное в этот чат, основываясь на последних событиях или просто чтобы поддержать общение.",
      });

      const outboundContext = buildOutboundSessionContext({
        config,
        agentId,
        lane: CommandLane.HEARTBEAT,
        sender: senderContext,
      });

      const payload = await resolveHeartbeatReplyPayload({
        config,
        agentId,
        agentConfig,
        prompt: heartbeatPrompt,
        context: outboundContext,
      });

      if (payload) {
        await deliverOutboundPayloads({
          payloads: [payload],
          runtime,
          config,
        });
      }

      // Update lastRunAt in config (best effort)
      entry.lastRunAt = now;
      
    } catch (err) {
      log.error(`Autonomous post failed for ${chatId}: ${String(err)}`);
    }
  }
}

let autonomousTimer: NodeJS.Timeout | null = null;

export function startXClawAutonomousService() {
  if (autonomousTimer) {
    return;
  }
  // Check every minute
  autonomousTimer = setInterval(runXClawAutonomousCheck, 60_000);
  log.info("XClaw Autonomous Service started.");
}
