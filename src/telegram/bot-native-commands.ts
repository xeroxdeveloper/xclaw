import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Bot, Context } from "grammy";
import type { ReactionTypeEmoji } from "@grammyjs/types";
import { resolveChunkMode, type ChunkMode } from "../auto-reply/chunk.js";
import type { CommandArgs } from "../auto-reply/commands-registry.js";
import {
  buildCommandTextFromArgs,
  findCommandByNativeName,
  listNativeCommandSpecs,
  listNativeCommandSpecsForConfig,
  parseCommandArgs,
  resolveCommandArgMenu,
} from "../auto-reply/commands-registry.js";
import { finalizeInboundContext } from "../auto-reply/reply/inbound-context.js";
import { dispatchReplyWithBufferedBlockDispatcher } from "../auto-reply/reply/provider-dispatcher.js";
import { listSkillCommandsForAgents } from "../auto-reply/skill-commands.js";
import { resolveCommandAuthorizedFromAuthorizers } from "../channels/command-gating.js";
import { createReplyPrefixOptions } from "../channels/reply-prefix.js";
import type { OpenClawConfig } from "../config/config.js";
import type { ChannelGroupPolicy } from "../config/group-policy.js";
import { resolveMarkdownTableMode } from "../config/markdown-tables.js";
import { recordSessionMetaFromInbound, resolveStorePath } from "../config/sessions.js";
import {
  normalizeTelegramCommandName,
  resolveTelegramCustomCommands,
  TELEGRAM_COMMAND_NAME_PATTERN,
} from "../config/telegram-custom-commands.js";
import type {
  ReplyToMode,
  TelegramAccountConfig,
  TelegramGroupConfig,
  TelegramTopicConfig,
} from "../config/types.js";
import { danger, logVerbose } from "../globals.js";
import { theme } from "../terminal/theme.js";
import { withProgress } from "../cli/progress.js";
import { formatCliCommand } from "../cli/command-format.js";
import {
  resolveCommandRuntimeContext,
  resolveTelegramThreadSpec,
  buildSenderName,
  resolveTelegramForumThreadId,
  buildTelegramGroupPeerId,
  buildTelegramParentPeer,
  resolveTelegramGroupAllowFromContext,
  type TelegramThreadSpec,
} from "./bot/helpers.js";
import type { TelegramNativeCommandContext } from "./bot/types.js";
import {
  evaluateTelegramGroupBaseAccess,
  evaluateTelegramGroupPolicyAccess,
} from "./group-access.js";
import { resolveTelegramGroupPromptSettings } from "./group-config-helpers.js";
import { buildInlineKeyboard } from "./send.js";
import { IS_XCLAW_MODE, resolveTelegramNativeCommandAllowlist, resolveTelegramOwnerIds } from "../xclaw/mode.js";
import { withTelegramApiErrorLogging } from "./api-logging.js";
import { deliverReplies } from "./bot/delivery.replies.js";
import { normalizeDmAllowFromWithStore, isSenderAllowed } from "./bot-access.js";
import type { MarkdownTableMode } from "../config/types.base.js";
import { RegisterTelegramHandlerParams } from "./bot-native-commands.js";

type TelegramCommandAuthResult = {
  chatId: number;
  isGroup: boolean;
  isForum: boolean;
  resolvedThreadId?: number;
  dmThreadId?: number;
  groupConfig?: TelegramGroupConfig | TelegramDirectConfig;
  topicConfig?: TelegramTopicConfig;
  commandAuthorized: boolean;
  isOwner: boolean;
};

const execFileAsync = promisify(execFile);
const XCLAW_SHELL_OUTPUT_LIMIT = 3800;

function chunkTextByLength(text: string, maxLength = XCLAW_SHELL_OUTPUT_LIMIT): string[] {
  const chunks: string[] = [];
  const normalized = String(text ?? "");
  if (!normalized) {
    return ["(empty)"];
  }
  for (let index = 0; index < normalized.length; index += maxLength) {
    chunks.push(normalized.slice(index, index + maxLength));
  }
  return chunks.length > 0 ? chunks : ["(empty)"];
}

function isTelegramOwner(senderId: string, cfg: OpenClawConfig): boolean {
  const normalizedSenderId = senderId.trim();
  if (!normalizedSenderId) return false;
  
  const ownerIds = resolveTelegramOwnerIds();
  if (ownerIds.has(normalizedSenderId.toLowerCase())) return true;
  
  if (cfg.xclaw?.ranks?.[normalizedSenderId] === "owner") return true;
  if (cfg.xclaw?.ranks?.[`tg:${normalizedSenderId}`] === "owner") return true;

  return false;
}

async function resolveTelegramCommandAuth(params: {
  msg: NonNullable<TelegramNativeCommandContext["message"]>;
  bot: Bot;
  cfg: OpenClawConfig;
  accountId: string;
  telegramCfg: TelegramAccountConfig;
  allowFrom?: Array<string | number>;
  groupAllowFrom?: Array<string | number>;
  useAccessGroups: boolean;
  resolveGroupPolicy: (chatId: string | number) => ChannelGroupPolicy;
  resolveTelegramGroupConfig: (
    chatId: string | number,
    messageThreadId?: number,
  ) => { groupConfig?: TelegramGroupConfig | TelegramDirectConfig; topicConfig?: TelegramTopicConfig };
  requireAuth: boolean;
}): Promise<TelegramCommandAuthResult | null> {
  const {
    msg,
    bot,
    cfg,
    accountId,
    telegramCfg,
    allowFrom,
    groupAllowFrom,
    useAccessGroups,
    resolveGroupPolicy,
    resolveTelegramGroupConfig,
    requireAuth,
  } = params;
  const chatId = msg.chat.id;
  const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
  const messageThreadId = (msg as { message_thread_id?: number }).message_thread_id;
  const isForum = (msg.chat as { is_forum?: boolean }).is_forum === true;
  const groupAllowContext = await resolveTelegramGroupAllowFromContext({
    chatId,
    accountId,
    isGroup,
    isForum,
    messageThreadId,
    groupAllowFrom,
    resolveTelegramGroupConfig,
  });

  const {
    resolvedThreadId,
    dmThreadId,
    groupConfig,
    topicConfig,
    effectiveGroupAllow,
    hasGroupAllowOverride,
  } = groupAllowContext;

  const sendAuthMessage = async (text: string) => {
    await withTelegramApiErrorLogging({
      operation: "sendMessage",
      fn: () => bot.api.sendMessage(chatId, text, { message_thread_id: messageThreadId }),
    });
    return null;
  };

  const rejectNotAuthorized = async () => {
    return await sendAuthMessage("You are not authorized to use this command.");
  };

  const senderId = msg.from?.id ? String(msg.from.id) : "";
  const senderUsername = msg.from?.username ?? "";
  const isOwner = isTelegramOwner(senderId, cfg);

  const baseAccess = evaluateTelegramGroupBaseAccess({
    isGroup,
    groupConfig,
    topicConfig,
    hasGroupAllowOverride,
    effectiveGroupAllow,
    senderId,
    senderUsername,
    enforceAllowOverride: requireAuth,
    requireSenderForAllowOverride: true,
  });
  if (!baseAccess.allowed) {
    if (baseAccess.reason === "group-disabled") {
      return null;
    }
    if (requireAuth) {
      return await rejectNotAuthorized();
    }
  }

  const dmAllow = normalizeDmAllowFromWithStore({
    allowFrom,
    storeAllowFrom: groupAllowContext.storeAllowFrom,
  });
  const senderAllowed = isSenderAllowed({
    allow: dmAllow,
    senderId,
    senderUsername,
  });

  const commandAuthorizedBase = resolveCommandAuthorizedFromAuthorizers({
    useAccessGroups,
    authorizers: [{ configured: dmAllow.hasEntries, allowed: senderAllowed }],
    modeWhenAccessGroupsOff: "configured",
  });
  const commandAuthorized = commandAuthorizedBase || isOwner;

  if (requireAuth && !commandAuthorized && !isOwner) {
    return await rejectNotAuthorized();
  }

  return {
    chatId,
    isGroup,
    isForum,
    resolvedThreadId,
    dmThreadId,
    groupConfig,
    topicConfig,
    commandAuthorized,
    isOwner,
  };
}

export const registerTelegramNativeCommands = ({
  cfg,
  accountId,
  bot,
  runtime,
  telegramCfg,
  allowFrom,
  groupAllowFrom,
  useAccessGroups,
  resolveGroupPolicy,
  resolveTelegramGroupConfig,
  shouldSkipUpdate,
  skillCommands,
}: RegisterTelegramNativeCommandsParams) => {
  const nativeEnabled = telegramCfg.commands?.native !== false;
  const nativeCommandsRaw = nativeEnabled
    ? listNativeCommandSpecsForConfig(cfg, {
        skillCommands,
        provider: "telegram",
      })
    : [];
  const nativeCommandAllowlist = resolveTelegramNativeCommandAllowlist();
  const nativeCommands =
    nativeCommandAllowlist && nativeCommandAllowlist.size > 0
      ? nativeCommandsRaw.filter((command) =>
          nativeCommandAllowlist.has(normalizeTelegramCommandName(command.name).toLowerCase()),
        )
      : nativeCommandsRaw;

  const buildCommandDeliveryBaseOptions = (params: {
    chatId: number;
    mediaLocalRoots?: readonly string[];
    threadSpec?: TelegramThreadSpec;
    tableMode?: MarkdownTableMode;
    chunkMode?: ChunkMode;
  }) => ({
    chatId: String(params.chatId),
    token: telegramCfg.botToken!,
    runtime,
    bot,
    mediaLocalRoots: params.mediaLocalRoots,
    replyToMode: telegramCfg.replyToMode || "all",
    textLimit: 4000,
    thread: params.threadSpec,
    tableMode: params.tableMode,
    chunkMode: params.chunkMode,
    linkPreview: telegramCfg.linkPreview,
  });

  const registerXClawOwnerExecCommand = () => {
    if (!IS_XCLAW_MODE) {
      return;
    }
    bot.command("xexec", async (ctx: TelegramNativeCommandContext) => {
      const msg = ctx.message;
      if (!msg || shouldSkipUpdate(ctx)) {
        return;
      }

      const auth = await resolveTelegramCommandAuth({
        msg, bot, cfg, accountId, telegramCfg, allowFrom, groupAllowFrom,
        useAccessGroups, resolveGroupPolicy, resolveTelegramGroupConfig, requireAuth: true
      });
      if (!auth || !auth.isOwner) {
        await bot.api.sendMessage(msg.chat.id, "Only owner can run /xexec.");
        return;
      }

      const rawCommand = ctx.match?.trim() ?? "";
      if (!rawCommand) {
        await bot.api.sendMessage(msg.chat.id, "Usage: /xexec <shell-command>");
        return;
      }

      const { chatId, isGroup, isForum, resolvedThreadId } = auth;
      const { threadSpec, mediaLocalRoots, tableMode, chunkMode } = resolveCommandRuntimeContext({
        msg, isGroup, isForum, resolvedThreadId,
      });
      const deliveryBaseOptions = buildCommandDeliveryBaseOptions({
        chatId, mediaLocalRoots, threadSpec, tableMode, chunkMode,
      });

      let stdout = "";
      let stderr = "";
      let code = 0;
      try {
        const result = await execFileAsync("bash", ["-lc", rawCommand], {
          timeout: 120000,
          maxBuffer: 1024 * 1024,
        });
        stdout = String(result.stdout ?? "");
        stderr = String(result.stderr ?? "");
      } catch (err: any) {
        stdout = String(err.stdout ?? "");
        stderr = String(err.stderr ?? err.message ?? "");
        code = Number.isFinite(err.code) ? Number(err.code) : 1;
      }

      const lines = [
        `$ ${rawCommand}`,
        "",
        stdout.trim() ? stdout.trim() : "(no stdout)",
        stderr.trim() ? `\n[stderr]\n${stderr.trim()}` : "",
        `\n[exit=${code}]`,
      ].join("\n");

      const chunks = chunkTextByLength(lines);
      for (const chunk of chunks) {
        await deliverReplies({
          replies: [{ text: chunk }],
          ...deliveryBaseOptions,
        });
      }
    });

    bot.command("xupdate", async (ctx: TelegramNativeCommandContext) => {
      const msg = ctx.message;
      if (!msg || shouldSkipUpdate(ctx)) return;
      const auth = await resolveTelegramCommandAuth({
        msg, bot, cfg, accountId, telegramCfg, allowFrom, groupAllowFrom,
        useAccessGroups, resolveGroupPolicy, resolveTelegramGroupConfig, requireAuth: true
      });
      if (!auth || !auth.isOwner) return;

      await bot.api.sendMessage(msg.chat.id, "♻️ Обновление XClaw...");
      try {
        const { execSync } = await import("node:child_process");
        const output = execSync("git pull", { encoding: "utf8" });
        await bot.api.sendMessage(msg.chat.id, `✅ Обновлено!\n\n${output}`);
      } catch (err) {
        await bot.api.sendMessage(msg.chat.id, `❌ Ошибка обновления: ${String(err)}`);
      }
    });

    bot.command("ghissue", async (ctx: TelegramNativeCommandContext) => {
      const msg = ctx.message;
      if (!msg || shouldSkipUpdate(ctx)) return;
      const auth = await resolveTelegramCommandAuth({
        msg, bot, cfg, accountId, telegramCfg, allowFrom, groupAllowFrom,
        useAccessGroups, resolveGroupPolicy, resolveTelegramGroupConfig, requireAuth: true
      });
      if (!auth || !auth.isOwner) return;

      const match = ctx.match?.trim();
      if (!match) {
        await bot.api.sendMessage(msg.chat.id, "Использование: /ghissue <title>\\n<body>");
        return;
      }

      const [title, ...bodyParts] = match.split("\n");
      const body = bodyParts.join("\n") || "Created via XClaw";

      await bot.api.sendMessage(msg.chat.id, "🚀 Создание Issue...");
      try {
        const repo = "xeroxdeveloper/xclaw"; 
        const { execSync } = await import("node:child_process");
        const cmd = `gh issue create --repo ${repo} --title ${JSON.stringify(title)} --body ${JSON.stringify(body)}`;
        const output = execSync(cmd, { encoding: "utf8" });
        await bot.api.sendMessage(msg.chat.id, `✅ Issue создан!\n${output}`);
      } catch (err) {
        await bot.api.sendMessage(msg.chat.id, `❌ Ошибка: ${String(err)}`);
      }
    });

    bot.command("whois", async (ctx: TelegramNativeCommandContext) => {
      const msg = ctx.message;
      if (!msg || shouldSkipUpdate(ctx)) return;
      const auth = await resolveTelegramCommandAuth({
        msg, bot, cfg, accountId, telegramCfg, allowFrom, groupAllowFrom,
        useAccessGroups, resolveGroupPolicy, resolveTelegramGroupConfig, requireAuth: true
      });
      if (!auth) return;

      const targetIdStr = ctx.match?.trim() || String(msg.from?.id);
      const targetId = Number.parseInt(targetIdStr, 10);
      
      if (Number.isNaN(targetId)) {
        await bot.api.sendMessage(msg.chat.id, "Использование: /whois <id> (или без аргументов для себя)");
        return;
      }

      await bot.api.sendMessage(msg.chat.id, "🔍 Получение информации о профиле...");
      try {
        const chat = await bot.api.getChat(targetId);
        const details = [
          `👤 Профиль: ${chat.id}`,
          `Имя: ${[ (chat as any).first_name, (chat as any).last_name ].filter(Boolean).join(" ")}`,
          (chat as any).username ? `Username: @${(chat as any).username}` : null,
          (chat as any).bio ? `О себе: ${(chat as any).bio}` : null,
          (chat as any).description ? `Описание: ${(chat as any).description}` : null,
          `Тип: ${chat.type}`,
        ].filter(Boolean).join("\n");
        
        await bot.api.sendMessage(msg.chat.id, details);
      } catch (err) {
        await bot.api.sendMessage(msg.chat.id, `❌ Ошибка: пользователь не найден или бот не имеет к нему доступа. (${String(err)})`);
      }
    });
  };

  const registerSkillCommands = () => {
    // ... logic for skill commands
  };

  const pluginCatalog = { commands: [] };
  const commandsToRegister = nativeCommands.length > 0 ? nativeCommands : [];

  if (commandsToRegister.length > 0 || pluginCatalog.commands.length > 0) {
    const listCommands = async () => {
      const specs = nativeCommands.map((c) => ({
        command: c.name,
        description: c.description,
      }));
      await bot.api.setMyCommands(specs);
    };

    if (telegramCfg.commands?.native !== false) {
      for (const command of nativeCommands) {
        bot.command(command.name, async (ctx: TelegramNativeCommandContext) => {
          const msg = ctx.message;
          if (!msg || shouldSkipUpdate(ctx)) return;

          const auth = await resolveTelegramCommandAuth({
            msg, bot, cfg, accountId, telegramCfg, allowFrom, groupAllowFrom,
            useAccessGroups, resolveGroupPolicy, resolveTelegramGroupConfig, requireAuth: true
          });
          if (!auth) return;

          const { chatId, isGroup, isForum, resolvedThreadId } = auth;
          const { threadSpec, mediaLocalRoots, tableMode, chunkMode } = resolveCommandRuntimeContext({
            msg, isGroup, isForum, resolvedThreadId,
          });
          const deliveryBaseOptions = buildCommandDeliveryBaseOptions({
            chatId, mediaLocalRoots, threadSpec, tableMode, chunkMode,
          });

          const args = parseCommandArgs(ctx.match || "", command.args);
          const commandText = buildCommandTextFromArgs(command.name, args);

          const inboundContext = await finalizeInboundContext({
            cfg, runtime, accountId, channelId: "telegram", chatId: String(chatId),
            threadId: resolvedThreadId ? String(resolvedThreadId) : undefined,
            senderId: msg.from?.id != null ? String(msg.from.id) : undefined,
            senderUsername: msg.from?.username,
            body: commandText,
            timestamp: msg.date * 1000,
          });

          await dispatchReplyWithBufferedBlockDispatcher({
            inboundContext, deliveryBaseOptions, cfg, runtime, bot
          });
        });
      }

      registerXClawOwnerExecCommand();
      registerSkillCommands();

      void listCommands().catch((err) => {
        logVerbose(`telegram: failed to set bot commands: ${String(err)}`);
      });
    }
  }
};
