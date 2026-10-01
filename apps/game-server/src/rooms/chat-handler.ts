import {
  QUICK_CHAT,
  filterChatMessage,
  type ClientMessage,
  type SurvivalConfig,
} from '@baha/shared/survival';
import { errInfo, log } from '../log.ts';
import { services, type PlayerProfile } from '../services/index.ts';
import { ChatGuard, HEAVY_MASK_WORDS, type ChatLine } from '../sim/chat.ts';

/** What the chat handler needs from the room (keeps it testable and the room file small). */
export interface ChatHost {
  runId(): string | null;
  sessionId(): string | null;
  /** Connected recipients: userId → profile + send function. */
  members(): { profile: PlayerProfile; send: (type: string, payload: unknown) => void }[];
  sendTo(userId: string, type: string, payload: unknown): void;
}

const key = (a: string, b: string) => `${a}>${b}`;

/**
 * Team text chat + quick chat (Section 17). Everything is enforced here on the server:
 * kill switch, admin chat restriction, the player's own chat mode, auto-mute, rate and
 * duplicate limits, the profanity/PII filter, storage for moderation, mutes and blocks.
 */
export class ChatHandler {
  readonly guard: ChatGuard;
  private mutes = new Set<string>();
  private blocks = new Set<string>();
  private lastQuick = new Map<string, number>();

  constructor(
    private cfg: SurvivalConfig['chat'],
    private host: ChatHost,
    private now: () => number = Date.now,
  ) {
    this.guard = new ChatGuard(cfg);
  }

  /** Loads mutes/blocks involving a joining player (and everyone present). */
  async loadRelations(userIds: string[]) {
    try {
      const r = await services().db.loadRelations(userIds);
      for (const [a, b] of r.mutes) this.mutes.add(key(a, b));
      for (const [a, b] of r.blocks) this.blocks.add(key(a, b));
    } catch (e) {
      log.warn('chat relations load failed', errInfo(e));
    }
  }

  /** Recipient hides sender: muted or blocked by the recipient. */
  hidden(recipient: string, sender: string) {
    return this.mutes.has(key(recipient, sender)) || this.blocks.has(key(recipient, sender));
  }

  historyFor(profile: PlayerProfile) {
    if (profile.chatMode !== 'full') return [];
    return this.guard.history.slice(-100).filter((l) => !this.hidden(profile.userId, l.senderId));
  }

  async send(sender: PlayerProfile, m: ClientMessage<'chat:send'>) {
    const s = services();
    const reject = (reasonKey: string, extra: Record<string, unknown> = {}) =>
      this.host.sendTo(sender.userId, 'chat:rejected', {
        clientMsgId: m.clientMsgId,
        reasonKey,
        ...extra,
      });

    if (sender.chatMode !== 'full') return reject('chat_off_for_you');
    if (sender.chatRestricted) return reject('restricted');
    if (!(await s.db.chatEnabled())) return reject('chat_disabled');
    const mutedUntil = await s.moderation.mutedUntil(sender.userId);
    if (mutedUntil > this.now())
      return this.host.sendTo(sender.userId, 'chat:muted', { until: mutedUntil });
    const pre = this.guard.precheck(sender.userId, m.text, this.now());
    if (pre) return reject(pre);

    const runId = this.host.runId();
    if (!runId) return reject('try_again');
    const f = filterChatMessage(m.text, { maxLength: this.cfg.maxLength });
    let id: number;
    try {
      id = await s.db.insertChat({
        runId,
        sessionId: this.host.sessionId(),
        senderId: sender.userId,
        bodyOriginal: m.text,
        bodyDelivered: f.status === 'rejected' ? null : f.text,
        status: f.status,
        filterHits: f.hits,
      });
    } catch (e) {
      // Child safety: nothing is delivered unless it is logged for moderation.
      log.error('chat store failed', errInfo(e));
      return reject('try_again');
    }

    const heavy = f.status === 'masked' && f.maskedWords >= HEAVY_MASK_WORDS;
    if (f.status === 'rejected' || heavy) await this.hit(sender.userId, runId);
    if (f.status === 'rejected') return reject(f.reasonKey);

    const line: ChatLine = {
      id,
      senderId: sender.userId,
      text: f.text,
      status: f.status,
      at: this.now(),
    };
    this.guard.remember(line);
    for (const r of this.host.members()) {
      if (r.profile.userId === sender.userId) {
        r.send('chat:message', { ...line, clientMsgId: m.clientMsgId });
        continue;
      }
      if (r.profile.chatMode !== 'full' || this.hidden(r.profile.userId, sender.userId)) continue;
      r.send('chat:message', line);
    }
  }

  private async hit(userId: string, runId: string) {
    if (!this.guard.recordHit(userId, this.now())) return;
    const s = services();
    try {
      const { until, level } = await s.moderation.applyAutoMute(userId, this.cfg.muteMinutes);
      this.host.sendTo(userId, 'chat:muted', { until });
      // Repeat offenders within 24 h get a moderation flag for admins.
      if (level >= 2) await s.db.insertChatFlag(userId, runId, `auto_mute_level_${level}`);
    } catch (e) {
      log.warn('auto-mute failed', errInfo(e));
    }
  }

  /** Quick chat is always allowed (it can't carry unsafe content), except chat mode "off". */
  quick(sender: PlayerProfile, m: ClientMessage<'quickChat'>) {
    if (m.id >= QUICK_CHAT.length) return;
    const now = this.now();
    if (now - (this.lastQuick.get(sender.userId) ?? -Infinity) < this.cfg.quickChatIntervalMs)
      return;
    this.lastQuick.set(sender.userId, now);
    for (const r of this.host.members()) {
      if (
        r.profile.userId !== sender.userId &&
        (r.profile.chatMode === 'off' || this.hidden(r.profile.userId, sender.userId))
      )
        continue;
      r.send('quickChat', { senderId: sender.userId, id: m.id, at: now });
    }
  }

  async mute(muter: PlayerProfile, mutedId: string, on: boolean) {
    if (mutedId === muter.userId) return;
    const s = services();
    if (!(await s.limiter.check('mute', muter.userId))) return;
    try {
      await s.db.setMute(muter.userId, mutedId, on);
    } catch (e) {
      log.warn('mute save failed', errInfo(e));
      return;
    }
    if (on) this.mutes.add(key(muter.userId, mutedId));
    else this.mutes.delete(key(muter.userId, mutedId));
    this.host.sendTo(muter.userId, 'chat:muteState', { userId: mutedId, muted: on });
  }

  /** Report a message from this session; evidence (context) is attached by the server. */
  async report(reporter: PlayerProfile, m: ClientMessage<'chat:report'>) {
    const s = services();
    const ctx = this.guard.context(m.messageId);
    const target = ctx?.find((l) => l.id === m.messageId);
    if (!ctx || !target || target.senderId === reporter.userId)
      return this.host.sendTo(reporter.userId, 'chat:reported', {
        messageId: m.messageId,
        ok: false,
      });
    if (!(await s.limiter.check('report', reporter.userId)))
      return this.host.sendTo(reporter.userId, 'chat:reported', {
        messageId: m.messageId,
        ok: false,
        reason: 'rate_limited',
      });
    const theirs = this.guard.history.filter((l) => l.senderId === target.senderId).slice(-50);
    try {
      await s.db.createReport({
        runId: this.host.runId(),
        reporterId: reporter.userId,
        reportedId: target.senderId,
        reason: m.reason,
        priority: m.reason === 'personal_info_request' ? 'high' : 'normal',
        messageId: m.messageId,
        evidence: {
          message_ids: [...new Set([...ctx, ...theirs].map((l) => l.id))],
          context: ctx.map((l) => ({ id: l.id, sender: l.senderId, at: l.at })),
          session_id: this.host.sessionId(),
        },
      });
      this.host.sendTo(reporter.userId, 'chat:reported', { messageId: m.messageId, ok: true });
    } catch (e) {
      log.error('report save failed', errInfo(e));
      this.host.sendTo(reporter.userId, 'chat:reported', {
        messageId: m.messageId,
        ok: false,
        reason: 'try_again',
      });
    }
  }
}
