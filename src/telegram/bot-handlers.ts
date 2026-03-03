import type { Message, ReactionTypeEmoji } from "@grammyjs/types";
import { resolveAgentDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { hasControlCommand } from "../auto-reply/command-detection.js";
import {
  createInboundDebouncer,
  resolveInboundDebounceMs,
} from "../auto-reply/inbound-debounce.js";
import { resolveStoredModelOverride } from "../auto-reply/reply/model-selection.js";
import { loadConfig } from "../config/config.js";
import { writeConfigFile } from "../config/io.js";
import { loadSessionStore, resolveStorePath } from "../config/sessions.js";
import type { DmPolicy } from "../config/types.base.js";
import type {
  TelegramDirectConfig,
  TelegramGroupConfig,
  TelegramTopicConfig,
} from "../config/types.js";
import { getChildLogger } from "../logging.js";
import { danger, logVerbose, warn } from "../globals.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import { MediaFetchError } from "../media/fetch.js";
import { readChannelAllowFromStore } from "../pairing/pairing-store.js";
import { resolveAgentRoute } from "../routing/resolve-route.js";
import { resolveThreadSessionKeys } from "../routing/session-key.js";
import { isXClawMode, resolveTelegramOwnerIds } from "../xclaw/mode.js";
import { withTelegramApiErrorLogging } from "./api-logging.js";
import {
  isSenderAllowed,
  normalizeDmAllowFromWithStore,
  type NormalizedAllowFrom,
} from "./bot-access.js";
import type { TelegramMediaRef } from "./bot-message-context.js";
import { RegisterTelegramHandlerParams } from "./bot-native-commands.js";
import {
  MEDIA_GROUP_TIMEOUT_MS,
  type MediaGroupEntry,
} from "./bot-updates.js";
import { resolveMedia } from "./bot/delivery.js";
import {
  buildTelegramGroupPeerId,
  buildTelegramParentPeer,
  resolveTelegramForumThreadId,
  resolveTelegramGroupAllowFromContext,
  buildSyntheticContext,
} from "./bot/helpers.js";
import type { TelegramContext } from "./bot/types.js";
import { enforceTelegramDmAccess } from "./dm-access.js";
import {
  evaluateTelegramGroupBaseAccess,
  evaluateTelegramGroupPolicyAccess,
} from "./group-access.js";
import { wasSentByBot } from "./sent-message-cache.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { deliverReplies } from "./bot/delivery.replies.js";

function isMediaSizeLimitError(err: unknown): boolean {
  const errMsg = String(err);
  return errMsg.includes("exceeds") && errMsg.includes("MB limit");
}

function isRecoverableMediaGroupError(err: unknown): boolean {
  return err instanceof MediaFetchError || isMediaSizeLimitError(err);
}

function hasInboundMedia(msg: Message): boolean {
  return (
    Boolean(msg.media_group_id) ||
    (Array.isArray(msg.photo) && msg.photo.length > 0) ||
    Boolean(msg.video ?? msg.video_note ?? msg.document ?? msg.audio ?? msg.voice ?? msg.sticker)
  );
}

function hasReplyTargetMedia(msg: Message): boolean {
  const externalReply = (msg as Message & { external_reply?: Message }).external_reply;
  const replyTarget = msg.reply_to_message ?? externalReply;
  return Boolean(replyTarget && hasInboundMedia(replyTarget));
}

function resolveInboundMediaFileId(msg: Message): string | undefined {
  return (
    msg.sticker?.file_id ??
    msg.photo?.[msg.photo.length - 1]?.file_id ??
    msg.video?.file_id ??
    msg.video_note?.file_id ??
    msg.document?.file_id ??
    msg.audio?.file_id ??
    msg.voice?.file_id
  );
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

function isTelegramAdmin(senderId: string, cfg: OpenClawConfig): boolean {
  const normalizedSenderId = senderId.trim();
  if (isTelegramOwner(senderId, cfg)) return true;
  
  if (cfg.xclaw?.ranks?.[normalizedSenderId] === "admin") return true;
  if (cfg.xclaw?.ranks?.[`tg:${normalizedSenderId}`] === "admin") return true;
  
  return false;
}

const rateLimits = new Map<string, { count: number, resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const limit = rateLimits.get(userId);
  if (!limit || now > limit.resetAt) {
    rateLimits.set(userId, { count: 1, resetAt: now + 60000 });
    return true;
  }
  if (limit.count >= 20) {
    return false;
  }
  limit.count += 1;
  return true;
}

export const registerTelegramHandlers = ({
  cfg,
  accountId,
  bot,
  opts,
  runtime,
  mediaMaxBytes,
  telegramCfg,
  allowFrom,
  groupAllowFrom,
  resolveGroupPolicy,
  resolveTelegramGroupConfig,
  shouldSkipUpdate,
  processMessage,
  logger,
}: RegisterTelegramHandlerParams) => {
  const debounceMs = resolveInboundDebounceMs({ cfg, channel: "telegram" });
  
  const inboundDebouncer = createInboundDebouncer<TelegramDebounceEntry>({
    debounceMs,
    resolveDebounceMs: (entry) =>
      entry.debounceLane === "forward" ? 80 : debounceMs,
    buildKey: (entry) => entry.debounceKey,
    shouldDebounce: (entry) => {
      const text = entry.msg.text ?? entry.msg.caption ?? "";
      if (text && hasControlCommand(text, cfg, { botUsername: entry.botUsername })) return false;
      return entry.allMedia.length === 0 && text.trim().length > 0;
    },
    onFlush: async (entries) => {
      const last = entries.at(-1);
      if (!last) return;
      
      const senderId = last.msg.from?.id ? String(last.msg.from.id) : "";
      const isOwner = isTelegramOwner(senderId, cfg);
      const ownerOnly = isXClawMode() && (process.env.XCLAW_OWNER_ONLY === "1" || cfg.xclaw?.ownerOnly);

      if (ownerOnly && !isOwner) {
        if (last.msg.chat.type === "private") {
           const ownerIds = Array.from(resolveTelegramOwnerIds());
           const primaryOwnerId = ownerIds[0] || (Array.isArray(allowFrom) ? String(allowFrom[0]) : "");
           if (primaryOwnerId) {
              await bot.api.sendMessage(primaryOwnerId, `🔔 Попытка доступа: ${last.msg.from?.first_name} ID: \`${senderId}\``, {
                reply_markup: {
                  inline_keyboard: [[
                    { text: "✅ Разрешить", callback_data: `xclaw_allow_${senderId}` },
                    { text: "❌ Отклонить", callback_data: `xclaw_deny_${senderId}` }
                  ]]
                },
                parse_mode: "Markdown"
              }).catch(() => {});
           }
           await bot.api.sendMessage(last.msg.chat.id, "Бот настроен только для ответов владельцу.").catch(() => {});
        }
        return;
      }

      if (entries.length === 1) {
        const replyMedia = await resolveReplyMediaForMessage(last.ctx, last.msg);
        await processMessage(last.ctx, last.allMedia, last.storeAllowFrom, undefined, replyMedia);
        return;
      }
      
      const combinedText = entries.map(e => e.msg.text || e.msg.caption || "").filter(Boolean).join("\n");
      const combinedMedia = entries.flatMap(e => e.allMedia);
      const first = entries[0];
      await processMessage(buildSyntheticContext(first.ctx, buildSyntheticTextMessage({ base: first.msg, text: combinedText })), combinedMedia, first.storeAllowFrom);
    },
    onError: (err) => {
      runtime.error?.(danger(`telegram debounce flush failed: ${String(err)}`));
    },
  });

  const buildSyntheticTextMessage = (params: { base: Message; text: string }): Message => ({
    ...params.base, text: params.text, caption: undefined
  });

  const resolveReplyMediaForMessage = async (ctx: TelegramContext, msg: Message): Promise<TelegramMediaRef[]> => {
    const replyMessage = msg.reply_to_message;
    if (!replyMessage || !hasInboundMedia(replyMessage)) return [];
    const fileId = resolveInboundMediaFileId(replyMessage);
    if (!fileId) return [];
    try {
      const media = await resolveMedia({ message: replyMessage, me: ctx.me, getFile: () => bot.api.getFile(fileId) }, mediaMaxBytes, opts.token, opts.proxyFetch);
      return media ? [{ path: media.path, contentType: media.contentType, stickerMetadata: media.stickerMetadata }] : [];
    } catch { return []; }
  };

  const handleInboundMessageLike = async (event: InboundTelegramEvent) => {
    if (event.senderId && !checkRateLimit(event.senderId)) return;
    try {
      if (shouldSkipUpdate(event.ctxForDedupe)) return;
      
      const context = await resolveTelegramEventAuthorizationContext({
        chatId: event.chatId, isGroup: event.isGroup, isForum: event.isForum, messageThreadId: event.messageThreadId
      });
      
      const isOwner = isTelegramOwner(event.senderId, cfg);
      const ownerOnly = isXClawMode() && (process.env.XCLAW_OWNER_ONLY === "1" || cfg.xclaw?.ownerOnly);

      if (event.isGroup && !(cfg.xclaw?.groupWhitelist || []).includes(String(event.chatId))) {
        const isReplyToBot = event.msg.reply_to_message?.from?.id === event.ctx.me.id;
        if (isReplyToBot || isOwner) {
           const primaryOwnerId = Array.from(resolveTelegramOwnerIds())[0];
           if (primaryOwnerId) {
              await bot.api.sendMessage(primaryOwnerId, `👥 Запрос группы: ${event.msg.chat.title}\nID: <code>${event.chatId}</code>`, {
                reply_markup: { inline_keyboard: [[{ text: "✅ Да", callback_data: `xclaw_allowgroup_${event.chatId}` }, { text: "❌ Нет", callback_data: `xclaw_denygroup_${event.chatId}` }]] },
                parse_mode: "HTML"
              }).catch(() => {});
           }
        }
        if (!isOwner && !isReplyToBot) return;
      }

      if (ownerOnly && !isOwner) {
        if (!event.isGroup) {
           const primaryOwnerId = Array.from(resolveTelegramOwnerIds())[0];
           if (primaryOwnerId) {
              await bot.api.sendMessage(primaryOwnerId, `🔔 Вход: ${event.msg.from?.first_name} ID: \`${event.senderId}\``, {
                reply_markup: { inline_keyboard: [[{ text: "✅ Да", callback_data: `xclaw_allow_${event.senderId}` }, { text: "❌ Нет", callback_data: `xclaw_deny_${event.senderId}` }]] },
                parse_mode: "Markdown"
              }).catch(() => {});
           }
           await bot.api.sendMessage(event.chatId, "Доступ только владельцу.").catch(() => {});
        }
        return;
      }

      await inboundDebouncer.enqueue({
        ctx: event.ctx, msg: event.msg, allMedia: [], storeAllowFrom: context.storeAllowFrom,
        debounceKey: `tg:${event.chatId}:${event.senderId}`,
        debounceLane: (event.msg as any).forward_date ? "forward" : "default",
      });
    } catch (err) { runtime.error?.(danger(`handler failed: ${String(err)}`)); }
  };

  const resolveTelegramEventAuthorizationContext = async (params: { chatId: number; isGroup: boolean; isForum: boolean; messageThreadId?: number }) => {
     return await resolveTelegramGroupAllowFromContext({
        chatId: params.chatId, accountId, isGroup: params.isGroup, isForum: params.isForum,
        messageThreadId: params.messageThreadId, groupAllowFrom, resolveTelegramGroupConfig
     });
  };

  bot.on("message", async (ctx) => {
    const msg = ctx.message;
    if (!msg) return;
    await handleInboundMessageLike({
      ctxForDedupe: ctx, ctx: buildSyntheticContext(ctx, msg), msg, chatId: msg.chat.id,
      isGroup: msg.chat.type.includes("group"), isForum: msg.chat.is_forum === true,
      senderId: String(msg.from?.id), senderUsername: msg.from?.username ?? "",
      requireConfiguredGroup: false, sendOversizeWarning: true, oversizeLogMessage: "too big", errorMessage: "failed",
    });
  });

  bot.on("callback_query", async (ctx) => {
    const callback = ctx.callbackQuery;
    const data = callback.data || "";
    if (isXClawMode() && data.startsWith("xclaw_")) {
      const senderId = String(callback.from.id);
      if (!isTelegramAdmin(senderId, cfg)) {
        await bot.api.answerCallbackQuery(callback.id, { text: "Нет прав.", show_alert: true });
        return;
      }
      const [,, action, targetId] = data.split("_");
      if (action === "allow") {
        const c = loadConfig();
        if (!c.channels) c.channels = {};
        if (!c.channels.telegram) c.channels.telegram = {};
        const allow = c.channels.telegram.allowFrom || [];
        if (!allow.includes(`tg:${targetId}`)) {
          allow.push(`tg:${targetId}`);
          c.channels.telegram.allowFrom = allow;
          await writeConfigFile(c);
          await ctx.editMessageText(`✅ Разрешено для ${targetId}`);
          await bot.api.sendMessage(targetId, "🎉 Доступ разрешен!");
        }
      } else if (action === "deny") {
        await ctx.editMessageText(`❌ Отклонено для ${targetId}`);
      } else if (action === "allowgroup") {
        const c = loadConfig();
        if (!c.xclaw) c.xclaw = {};
        const gw = c.xclaw.groupWhitelist || [];
        if (!gw.includes(targetId)) {
          gw.push(targetId);
          c.xclaw.groupWhitelist = gw;
          await writeConfigFile(c);
          await ctx.editMessageText(`✅ Группа ${targetId} авторизована.`);
          await bot.api.sendMessage(targetId, "🎉 Группа авторизована!");
        }
      }
      await bot.api.answerCallbackQuery(callback.id);
    }
  });
};

type TelegramDebounceLane = "default" | "forward";
type TelegramDebounceEntry = {
  ctx: TelegramContext;
  msg: Message;
  allMedia: TelegramMediaRef[];
  storeAllowFrom: string[];
  debounceKey: string | null;
  debounceLane: TelegramDebounceLane;
  botUsername?: string;
};

type InboundTelegramEvent = {
  ctxForDedupe: Context;
  ctx: TelegramContext;
  msg: Message;
  chatId: number;
  isGroup: boolean;
  isForum: boolean;
  messageThreadId?: number;
  senderId: string;
  senderUsername: string;
  requireConfiguredGroup: boolean;
  sendOversizeWarning: boolean;
  oversizeLogMessage: string;
  errorMessage: string;
};
