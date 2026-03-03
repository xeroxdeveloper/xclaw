export type XClawConfig = {
  /** Enable owner-only response mode. */
  ownerOnly?: boolean;
  /** Set the CLI/Bot language (ru/en). */
  lang?: string;
  /** Use compact headers in messages. */
  compactMode?: boolean;
  /** Show loading spinner/typing in Telegram. */
  loadingIndicator?: boolean;
  /** Use reactions for progress status. */
  reactionStatuses?: boolean;
  /** Enable automatic context summarization. */
  autoSummarize?: boolean;
  /** Self-update from Git on startup (dangerous). */
  autoUpdate?: boolean;
  /** List of allowed group IDs. */
  groupWhitelist?: string[];
  /** Ranks for users (e.g. { "tg:123456": "admin" }). */
  ranks?: Record<string, string>;
  /** Autonomous posting configuration. */
  autonomous?: Array<{
    chatId: string | number;
    intervalMs: number;
    lastRunAt?: number;
    prompt?: string;
  }>;
};
