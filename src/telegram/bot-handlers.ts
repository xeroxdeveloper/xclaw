import type { Message, ReactionTypeEmoji } from "@grammyjs/types";
import { resolveAgentDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { hasControlCommand } from "../auto-reply/command-detection.js";
import {
  createInboundDebouncer,
  resolveInboundDebounceMs,
} from "../auto-reply/inbound-debounce.js";
import { buildCommandsPaginationKeyboard } from "../auto-reply/reply/commands-info.js";
import {
  buildModelsProviderData,
  formatModelsAvailableHeader,
} from "../auto-reply/reply/commands-models.js";
import { resolveStoredModelOverride } from "../auto-reply/reply/model-selection.js";
import { listSkillCommandsForAgents } from "../auto-reply/skill-commands.js";
import { buildCommandsMessagePaginated } from "../auto-reply/status.js";
import { resolveChannelConfigWrites } from "../channels/plugins/config-writes.js";
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
import { IS_XCLAW_MODE, isXClawMode, resolveTelegramOwnerIds } from "../xclaw/mode.js";
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
  type TelegramUpdateKeyContext,
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
import { migrateTelegramGroupConfig } from "./group-migration.js";
import { resolveTelegramInlineButtonsScope } from "./inline-buttons.js";
import {
  buildModelsKeyboard,
  buildProviderKeyboard,
  calculateTotalPages,
  getModelsPageSize,
  parseModelCallbackData,
  type ProviderInfo,
} from "./model-buttons.js";
import { buildInlineKeyboard } from "./send.js";
import { wasSentByBot } from "./sent-message-cache.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";

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
  const DEFAULT_TEXT_FRAGMENT_MAX_GAP_MS = 1500;
  const TELEGRAM_TEXT_FRAGMENT_START_THRESHOLD_CHARS = 4000;
  const TELEGRAM_TEXT_FRAGMENT_MAX_GAP_MS =
    typeof opts.testTimings?.textFragmentGapMs === "number" &&
    Number.isFinite(opts.testTimings.textFragmentGapMs)
      ? Math.max(10, Math.floor(opts.testTimings.textFragmentGapMs))
      : DEFAULT_TEXT_FRAGMENT_MAX_GAP_MS;
  const TELEGRAM_TEXT_FRAGMENT_MAX_ID_GAP = 1;
  const TELEGRAM_TEXT_FRAGMENT_MAX_PARTS = 12;
  const TELEGRAM_TEXT_FRAGMENT_MAX_TOTAL_CHARS = 50_000;
  const mediaGroupTimeoutMs =
    typeof opts.testTimings?.mediaGroupFlushMs === "number" &&
    Number.isFinite(opts.testTimings.mediaGroupFlushMs)
      ? Math.max(10, Math.floor(opts.testTimings.mediaGroupFlushMs))
      : MEDIA_GROUP_TIMEOUT_MS;

  const mediaGroupBuffer = new Map<string, MediaGroupEntry>();
  let mediaGroupProcessing: Promise<void> = Promise.resolve();

  type TextFragmentEntry = {
    key: string;
    messages: Array<{ msg: Message; ctx: TelegramContext; receivedAtMs: number }>;
    timer: ReturnType<typeof setTimeout>;
  };
  const textFragmentBuffer = new Map<string, TextFragmentEntry>();
  let textFragmentProcessing: Promise<void> = Promise.resolve();

  const debounceMs = resolveInboundDebounceMs({ cfg, channel: "telegram" });
  const FORWARD_BURST_DEBOUNCE_MS = 80;
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
  const resolveTelegramDebounceLane = (msg: Message): TelegramDebounceLane => {
    const forwardMeta = msg as {
      forward_origin?: unknown;
      forward_from?: unknown;
      forward_from_chat?: unknown;
      forward_sender_name?: unknown;
      forward_date?: unknown;
    };
    return (forwardMeta.forward_origin ??
      forwardMeta.forward_from ??
      forwardMeta.forward_from_chat ??
      forwardMeta.forward_sender_name ??
      forwardMeta.forward_date)
      ? "forward"
      : "default";
  };
  const buildSyntheticTextMessage = (params: {
    base: Message;
    text: string;
    date?: number;
    from?: Message["from"];
  }): Message => ({
    ...params.base,
    ...(params.from ? { from: params.from } : {}),
    text: params.text,
    caption: undefined,
    caption_entities: undefined,
    entities: undefined,
    ...(params.date != null ? { date: params.date } : {}),
  });

  const inboundDebouncer = createInboundDebouncer<TelegramDebounceEntry>({
    debounceMs,
    resolveDebounceMs: (entry) =>
      entry.debounceLane === "forward" ? FORWARD_BURST_DEBOUNCE_MS : debounceMs,
    buildKey: (entry) => entry.debounceKey,
    shouldDebounce: (entry) => {
      const text = entry.msg.text ?? entry.msg.caption ?? "";
      const hasText = text.trim().length > 0;
      if (hasText && hasControlCommand(text, cfg, { botUsername: entry.botUsername })) {
        return false;
      }
      if (entry.debounceLane === "forward") {
        return true;
      }
      return entry.allMedia.length === 0 && hasText;
    },
    onFlush: async (entries) => {
      const last = entries.at(-1);
      if (!last) return;
      
      const senderId = last.msg.from?.id ? String(last.msg.from.id) : "";
      const ownerOnly = IS_XCLAW_MODE && (process.env.XCLAW_OWNER_ONLY === "1" || cfg.xclaw?.ownerOnly);
      const isOwner = isTelegramOwner(senderId, cfg);

      if (ownerOnly && !isOwner) {
        if (last.msg.chat.type === "private") {
           const ownerIds = Array.from(resolveTelegramOwnerIds());
           const primaryOwnerId = ownerIds[0] || (Array.isArray(allowFrom) ? String(allowFrom[0]) : "");
           
           if (primaryOwnerId) {
              await withTelegramApiErrorLogging({
                operation: "sendMessage",
                runtime,
                fn: () => bot.api.sendMessage(primaryOwnerId, `🔔 Попытка доступа: ${last.msg.from?.first_name} (@${last.msg.from?.username || "no_user"}) ID: \`${senderId}\``, {
                  reply_markup: {
                    inline_keyboard: [
                      [
                        { text: "✅ Разрешить", callback_data: `xclaw_allow_${senderId}` },
                        { text: "❌ Отклонить", callback_data: `xclaw_deny_${senderId}` }
                      ]
                    ]
                  },
                  parse_mode: "Markdown"
                }),
              }).catch(() => {});
           }

           await withTelegramApiErrorLogging({
             operation: "sendMessage",
             runtime,
             fn: () => bot.api.sendMessage(last.msg.chat.id, "Бот настроен только для ответов владельцу. Уведомление отправлено."),
           });
        }
        return;
      }

      if (entries.length === 1) {
        const replyMedia = await resolveReplyMediaForMessage(last.ctx, last.msg);
        await processMessage(last.ctx, last.allMedia, last.storeAllowFrom, undefined, replyMedia);
        return;
      }
      const combinedText = entries
        .map((entry) => entry.msg.text ?? entry.msg.caption ?? "")
        .filter(Boolean)
        .join("\n");
      const combinedMedia = entries.flatMap((entry) => entry.allMedia);
      if (!combinedText.trim() && combinedMedia.length === 0) {
        return;
      }
      const first = entries[0];
      const baseCtx = first.ctx;
      const syntheticMessage = buildSyntheticTextMessage({
        base: first.msg,
        text: combinedText,
        date: last.msg.date ?? first.msg.date,
      });
      const messageIdOverride = last.msg.message_id ? String(last.msg.message_id) : undefined;
      const syntheticCtx = buildSyntheticContext(baseCtx, syntheticMessage);
      const replyMedia = await resolveReplyMediaForMessage(baseCtx, syntheticMessage);

      await processMessage(
        syntheticCtx,
        combinedMedia,
        first.storeAllowFrom,
        messageIdOverride ? { messageIdOverride } : undefined,
        replyMedia,
      );
    },
    onError: (err) => {
      runtime.error?.(danger(`telegram debounce flush failed: ${String(err)}`));
    },
  });

  const resolveTelegramSessionState = (params: {
    chatId: number | string;
    isGroup: boolean;
    isForum: boolean;
    messageThreadId?: number;
    resolvedThreadId?: number;
  }): {
    agentId: string;
    sessionEntry: any;
    model?: string;
  } => {
    const resolvedThreadId =
      params.resolvedThreadId ??
      resolveTelegramForumThreadId({
        isForum: params.isForum,
        messageThreadId: params.messageThreadId,
      });
    const peerId = params.isGroup
      ? buildTelegramGroupPeerId(params.chatId, resolvedThreadId)
      : String(params.chatId);
    const parentPeer = buildTelegramParentPeer({
      isGroup: params.isGroup,
      resolvedThreadId,
      chatId: params.chatId,
    });
    const route = resolveAgentRoute({
      cfg,
      channel: "telegram",
      accountId,
      peer: {
        kind: params.isGroup ? "group" : "direct",
        id: peerId,
      },
      parentPeer,
    });
    const baseSessionKey = route.sessionKey;
    const dmThreadId = !params.isGroup ? params.messageThreadId : undefined;
    const threadKeys =
      dmThreadId != null
        ? resolveThreadSessionKeys({ baseSessionKey, threadId: `${params.chatId}:${dmThreadId}` })
        : null;
    const sessionKey = threadKeys?.sessionKey ?? baseSessionKey;
    const storePath = resolveStorePath(cfg.session?.store, { agentId: route.agentId });
    const store = loadSessionStore(storePath);
    const entry = store[sessionKey];
    const storedOverride = resolveStoredModelOverride({
      sessionEntry: entry,
      sessionStore: store,
      sessionKey,
    });
    if (storedOverride) {
      return {
        agentId: route.agentId,
        sessionEntry: entry,
        model: storedOverride.provider
          ? `${storedOverride.provider}/${storedOverride.model}`
          : storedOverride.model,
      };
    }
    const provider = entry?.modelProvider?.trim();
    const model = entry?.model?.trim();
    if (provider && model) {
      return {
        agentId: route.agentId,
        sessionEntry: entry,
        model: `${provider}/${model}`,
      };
    }
    const modelCfg = cfg.agents?.defaults?.model;
    return {
      agentId: route.agentId,
      sessionEntry: entry,
      model: typeof modelCfg === "string" ? modelCfg : modelCfg?.primary,
    };
  };

  const processMediaGroup = async (entry: MediaGroupEntry) => {
    try {
      entry.messages.sort((a, b) => a.msg.message_id - b.msg.message_id);

      const captionMsg = entry.messages.find((m) => m.msg.caption || m.msg.text);
      const primaryEntry = captionMsg ?? entry.messages[0];

      const allMedia: TelegramMediaRef[] = [];
      for (const { ctx } of entry.messages) {
        let media;
        try {
          media = await resolveMedia(ctx, mediaMaxBytes, opts.token, opts.proxyFetch);
        } catch (mediaErr) {
          if (!isRecoverableMediaGroupError(mediaErr)) {
            throw mediaErr;
          }
          runtime.log?.(
            warn(`media group: skipping photo that failed to fetch: ${String(mediaErr)}`),
          );
          continue;
        }
        if (media) {
          allMedia.push({
            path: media.path,
            contentType: media.contentType,
            stickerMetadata: media.stickerMetadata,
          });
        }
      }

      const storeAllowFrom = await loadStoreAllowFrom();
      const replyMedia = await resolveReplyMediaForMessage(primaryEntry.ctx, primaryEntry.msg);
      await processMessage(primaryEntry.ctx, allMedia, storeAllowFrom, undefined, replyMedia);
    } catch (err) {
      runtime.error?.(danger(`media group handler failed: ${String(err)}`));
    }
  };

  const flushTextFragments = async (entry: TextFragmentEntry) => {
    try {
      entry.messages.sort((a, b) => a.msg.message_id - b.msg.message_id);

      const first = entry.messages[0];
      const last = entry.messages.at(-1);
      if (!first || !last) {
        return;
      }

      const combinedText = entry.messages.map((m) => m.msg.text ?? "").join("");
      if (!combinedText.trim()) {
        return;
      }

      const syntheticMessage = buildSyntheticTextMessage({
        base: first.msg,
        text: combinedText,
        date: last.msg.date ?? first.msg.date,
      });

      const storeAllowFrom = await loadStoreAllowFrom();
      const baseCtx = first.ctx;

      await processMessage(buildSyntheticContext(baseCtx, syntheticMessage), [], storeAllowFrom, {
        messageIdOverride: String(last.msg.message_id),
      });
    } catch (err) {
      runtime.error?.(danger(`text fragment handler failed: ${String(err)}`));
    }
  };

  const queueTextFragmentFlush = async (entry: TextFragmentEntry) => {
    textFragmentProcessing = textFragmentProcessing
      .then(async () => {
        await flushTextFragments(entry);
      })
      .catch(() => undefined);
    await textFragmentProcessing;
  };

  const runTextFragmentFlush = async (entry: TextFragmentEntry) => {
    textFragmentBuffer.delete(entry.key);
    await queueTextFragmentFlush(entry);
  };

  const scheduleTextFragmentFlush = (entry: TextFragmentEntry) => {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(async () => {
      await runTextFragmentFlush(entry);
    }, TELEGRAM_TEXT_FRAGMENT_MAX_GAP_MS);
  };

  const loadStoreAllowFrom = async () =>
    readChannelAllowFromStore("telegram", process.env, accountId).catch(() => []);

  const resolveReplyMediaForMessage = async (
    ctx: TelegramContext,
    msg: Message,
  ): Promise<TelegramMediaRef[]> => {
    const replyMessage = msg.reply_to_message;
    if (!replyMessage || !hasInboundMedia(replyMessage)) {
      return [];
    }
    const replyFileId = resolveInboundMediaFileId(replyMessage);
    if (!replyFileId) {
      return [];
    }
    try {
      const media = await resolveMedia(
        {
          message: replyMessage,
          me: ctx.me,
          getFile: async () => await bot.api.getFile(replyFileId),
        },
        mediaMaxBytes,
        opts.token,
        opts.proxyFetch,
      );
      if (!media) {
        return [];
      }
      return [
        {
          path: media.path,
          contentType: media.contentType,
          stickerMetadata: media.stickerMetadata,
        },
      ];
    } catch (err) {
      logger.warn({ chatId: msg.chat.id, error: String(err) }, "reply media fetch failed");
      return [];
    }
  };

  const isAllowlistAuthorized = (
    allow: NormalizedAllowFrom,
    senderId: string,
    senderUsername: string,
  ) =>
    allow.hasWildcard ||
    (allow.hasEntries &&
      isSenderAllowed({
        allow,
        senderId,
        senderUsername,
      }));

  const shouldSkipGroupMessage = (params: {
    isGroup: boolean;
    chatId: string | number;
    chatTitle?: string;
    resolvedThreadId?: number;
    senderId: string;
    senderUsername: string;
    effectiveGroupAllow: NormalizedAllowFrom;
    hasGroupAllowOverride: boolean;
    groupConfig?: TelegramGroupConfig;
    topicConfig?: TelegramTopicConfig;
  }) => {
    const {
      isGroup,
      chatId,
      chatTitle,
      resolvedThreadId,
      senderId,
      senderUsername,
      effectiveGroupAllow,
      hasGroupAllowOverride,
      groupConfig,
      topicConfig,
    } = params;
    const baseAccess = evaluateTelegramGroupBaseAccess({
      isGroup,
      groupConfig,
      topicConfig,
      hasGroupAllowOverride,
      effectiveGroupAllow,
      senderId,
      senderUsername,
      enforceAllowOverride: true,
      requireSenderForAllowOverride: true,
    });
    if (!baseAccess.allowed) {
      if (baseAccess.reason === "group-disabled") {
        logVerbose(`Blocked telegram group ${chatId} (group disabled)`);
        return true;
      }
      if (baseAccess.reason === "topic-disabled") {
        logVerbose(
          `Blocked telegram topic ${chatId} (${resolvedThreadId ?? "unknown"}) (topic disabled)`,
        );
        return true;
      }
      logVerbose(
        `Blocked telegram group sender ${senderId || "unknown"} (group allowFrom override)`,
      );
      return true;
    }
    if (!isGroup) {
      return false;
    }
    const policyAccess = evaluateTelegramGroupPolicyAccess({
      isGroup,
      chatId,
      cfg,
      telegramCfg,
      topicConfig,
      groupConfig,
      effectiveGroupAllow,
      senderId,
      senderUsername,
      resolveGroupPolicy,
      enforcePolicy: true,
      useTopicAndGroupOverrides: true,
      enforceAllowlistAuthorization: true,
      allowEmptyAllowlistEntries: false,
      requireSenderForAllowlistAuthorization: true,
      checkChatAllowlist: true,
    });
    if (!policyAccess.allowed) {
      if (policyAccess.reason === "group-policy-disabled") {
        logVerbose("Blocked telegram group message (groupPolicy: disabled)");
        return true;
      }
      if (policyAccess.reason === "group-policy-allowlist-no-sender") {
        logVerbose("Blocked telegram group message (no sender ID, groupPolicy: allowlist)");
        return true;
      }
      if (policyAccess.reason === "group-policy-allowlist-empty") {
        logVerbose(
          "Blocked telegram group message (groupPolicy: allowlist, no group allowlist entries)",
        );
        return true;
      }
      if (policyAccess.reason === "group-policy-allowlist-unauthorized") {
        logVerbose(`Blocked telegram group message from ${senderId} (groupPolicy: allowlist)`);
        return true;
      }
      logger.info({ chatId, title: chatTitle, reason: "not-allowed" }, "skipping group message");
      return true;
    }
    return false;
  };

  const resolveTelegramEventAuthorizationContext = async (params: {
    chatId: number;
    isGroup: boolean;
    isForum: boolean;
    messageThreadId?: number;
  }): Promise<any> => {
    const groupAllowContext = await resolveTelegramGroupAllowFromContext({
      chatId: params.chatId,
      accountId,
      isGroup: params.isGroup,
      isForum: params.isForum,
      messageThreadId: params.messageThreadId,
      groupAllowFrom,
      resolveTelegramGroupConfig,
    });
    const effectiveDmPolicy =
      !params.isGroup &&
      groupAllowContext.groupConfig &&
      "dmPolicy" in groupAllowContext.groupConfig
        ? (groupAllowContext.groupConfig.dmPolicy ?? telegramCfg.dmPolicy ?? "pairing")
        : (telegramCfg.dmPolicy ?? "pairing");
    return { dmPolicy: effectiveDmPolicy, ...groupAllowContext };
  };

  const authorizeTelegramEventSender = (params: {
    chatId: number;
    chatTitle?: string;
    isGroup: boolean;
    senderId: string;
    senderUsername: string;
    mode: string;
    context: any;
  }) => {
    const { chatId, chatTitle, isGroup, senderId, senderUsername, context } = params;
    const {
      dmPolicy,
      resolvedThreadId,
      storeAllowFrom,
      groupConfig,
      topicConfig,
      groupAllowOverride,
      effectiveGroupAllow,
      hasGroupAllowOverride,
    } = context;
    
    if (
      shouldSkipGroupMessage({
        isGroup,
        chatId,
        chatTitle,
        resolvedThreadId,
        senderId,
        senderUsername,
        effectiveGroupAllow,
        hasGroupAllowOverride,
        groupConfig,
        topicConfig,
      })
    ) {
      return { allowed: false, reason: "group-policy" };
    }

    if (!isGroup) {
      if (dmPolicy === "disabled") return { allowed: false, reason: "direct-disabled" };
      if (dmPolicy !== "open") {
        const dmAllowFrom = groupAllowOverride ?? allowFrom;
        const effectiveDmAllow = normalizeDmAllowFromWithStore({
          allowFrom: dmAllowFrom,
          storeAllowFrom,
          dmPolicy,
        });
        if (!isAllowlistAuthorized(effectiveDmAllow, senderId, senderUsername)) {
          return { allowed: false, reason: "direct-unauthorized" };
        }
      }
    }
    return { allowed: true };
  };

  bot.on("message_reaction", async (ctx) => {
    try {
      const reaction = ctx.messageReaction;
      if (!reaction || shouldSkipUpdate(ctx)) return;

      const chatId = reaction.chat.id;
      const user = reaction.user;
      if (!user || user.is_bot) return;
      
      const senderId = String(user.id);
      const isGroup = reaction.chat.type === "group" || reaction.chat.type === "supergroup";
      const isForum = reaction.chat.is_forum === true;

      const context = await resolveTelegramEventAuthorizationContext({ chatId, isGroup, isForum });
      const auth = authorizeTelegramEventSender({
        chatId, isGroup, senderId, senderUsername: user.username ?? "", mode: "reaction", context, chatTitle: reaction.chat.title
      });
      if (!auth.allowed) return;

      const addedReactions = reaction.new_reaction.filter((r): r is ReactionTypeEmoji => r.type === "emoji");
      if (addedReactions.length === 0) return;

      const route = resolveAgentRoute({
        cfg: loadConfig(),
        channel: "telegram",
        accountId,
        peer: { kind: isGroup ? "group" : "direct", id: isGroup ? buildTelegramGroupPeerId(chatId, undefined) : String(chatId) },
        parentPeer: buildTelegramParentPeer({ isGroup, resolvedThreadId: undefined, chatId }),
      });

      for (const r of addedReactions) {
        enqueueSystemEvent(`Telegram reaction added: ${r.emoji} by ${user.first_name} on msg ${reaction.message_id}`, {
          sessionKey: route.sessionKey,
          contextKey: `telegram:reaction:add:${chatId}:${reaction.message_id}:${user.id}:${r.emoji}`,
        });
      }
    } catch (err) {
      runtime.error?.(danger(`telegram reaction handler failed: ${String(err)}`));
    }
  });

  const handleInboundMessageLike = async (event: InboundTelegramEvent) => {
    if (event.senderId && !checkRateLimit(event.senderId)) return;
    try {
      if (shouldSkipUpdate(event.ctxForDedupe)) return;
      
      const context = await resolveTelegramEventAuthorizationContext({
        chatId: event.chatId, isGroup: event.isGroup, isForum: event.isForum, messageThreadId: event.messageThreadId
      });
      
      const { dmPolicy, resolvedThreadId, dmThreadId, storeAllowFrom, groupConfig, topicConfig, effectiveGroupAllow, hasGroupAllowOverride } = context;

      const xclawCfg = cfg.xclaw;
      const groupWhitelist = xclawCfg?.groupWhitelist;
      if (event.isGroup && Array.isArray(groupWhitelist) && !groupWhitelist.includes(String(event.chatId))) {
        if (isXClawMode()) logVerbose(`[XClaw] Blocked group ${event.chatId} - not in whitelist`);
        return;
      }

      const skipGroup = shouldSkipGroupMessage({
        isGroup: event.isGroup, chatId: event.chatId, chatTitle: event.msg.chat.title, resolvedThreadId,
        senderId: event.senderId, senderUsername: event.senderUsername, effectiveGroupAllow,
        hasGroupAllowOverride, groupConfig, topicConfig,
      });
      if (skipGroup) return;

      const isOwner = isTelegramOwner(event.senderId, cfg);
      const ownerOnly = isXClawMode() && (process.env.XCLAW_OWNER_ONLY === "1" || xclawCfg?.ownerOnly);

      if (ownerOnly && !isOwner) {
        if (!event.isGroup) {
           const ownerIds = Array.from(resolveTelegramOwnerIds());
           const primaryOwnerId = ownerIds[0] || (Array.isArray(allowFrom) ? String(allowFrom[0]) : "");
           if (primaryOwnerId) {
              await withTelegramApiErrorLogging({
                operation: "sendMessage",
                runtime,
                fn: () => bot.api.sendMessage(primaryOwnerId, `🔔 Попытка доступа: ${event.msg.from?.first_name} (@${event.msg.from?.username || "no_user"}) ID: \`${event.senderId}\``, {
                  reply_markup: {
                    inline_keyboard: [[
                      { text: "✅ Разрешить", callback_data: `xclaw_allow_${event.senderId}` },
                      { text: "❌ Отклонить", callback_data: `xclaw_deny_${event.senderId}` }
                    ]]
                  },
                  parse_mode: "Markdown"
                }),
              }).catch(() => {});
           }
           await bot.api.sendMessage(event.chatId, "Бот настроен только для ответов владельцу.");
        }
        return;
      }

      if (!event.isGroup && (hasInboundMedia(event.msg) || hasReplyTargetMedia(event.msg))) {
        const dmAuthorized = await enforceTelegramDmAccess({
          isGroup: event.isGroup, dmPolicy, msg: event.msg, chatId: event.chatId,
          effectiveDmAllow: normalizeDmAllowFromWithStore({ allowFrom, storeAllowFrom, dmPolicy }),
          accountId, bot, logger,
        });
        if (!dmAuthorized) return;
      }

      await inboundDebouncer.enqueue({
        ctx: event.ctx, msg: event.msg, allMedia: [], storeAllowFrom,
        debounceKey: `tg:${event.chatId}:${event.senderId}`,
        debounceLane: "default",
      });
    } catch (err) {
      runtime.error?.(danger(`${event.errorMessage}: ${String(err)}`));
    }
  };

  bot.on("message", async (ctx) => {
    const msg = ctx.message;
    if (!msg) return;
    if (isXClawMode()) logVerbose(`[XClaw] Message from ${msg.from?.id} in ${msg.chat.id}`);
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
        const currentConfig = loadConfig();
        const tgId = `tg:${targetId}`;
        const allowFrom = currentConfig.channels?.telegram?.allowFrom || [];
        if (!allowFrom.includes(tgId)) {
          allowFrom.push(tgId);
          if (!currentConfig.channels) currentConfig.channels = {};
          if (!currentConfig.channels.telegram) currentConfig.channels.telegram = {};
          currentConfig.channels.telegram.allowFrom = allowFrom;
          await writeConfigFile(currentConfig);
          await ctx.editMessageText(`✅ Разрешено для ${targetId}`);
          await bot.api.sendMessage(targetId, "🎉 Доступ разрешен!");
        }
      } else if (action === "deny") {
        await ctx.editMessageText(`❌ Отклонено для ${targetId}`);
        await bot.api.sendMessage(targetId, "😔 Доступ отклонен.");
      }
      await bot.api.answerCallbackQuery(callback.id);
    }
  });
};
