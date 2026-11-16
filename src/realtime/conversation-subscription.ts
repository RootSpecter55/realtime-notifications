import type { MessageView, RealtimeEvent, ServerEvent } from './protocol';

/**
 * One socket's subscription to one conversation, covering the reconnect hand-over:
 *
 *   1. The socket joins the live room first; live events arriving now are buffered.
 *   2. Missed messages (seq > lastSeq) are loaded from Postgres and sent in order.
 *   3. Buffered live events are sent, skipping any message already sent by the replay.
 *   4. From then on, live events go straight through.
 *
 * Joining before querying means nothing published in between can be missed; the seq check
 * means nothing that is both replayed and live is sent twice.
 */
export class ConversationSubscription {
  private replaying = true;
  private buffer: RealtimeEvent[] = [];
  private lastSentSeq: number;

  constructor(
    readonly conversationId: string,
    lastSeq: number,
    private readonly send: (event: ServerEvent) => void,
  ) {
    this.lastSentSeq = lastSeq;
  }

  /** A live event from Redis for this conversation. */
  onLive = (event: RealtimeEvent): void => {
    if (this.replaying) this.buffer.push(event);
    else this.deliver(event);
  };

  /**
   * Sends the missed messages, then the buffered live events, then switches to live.
   * `truncated` means there were more missed messages than the replay limit: none are sent,
   * and the client is told to page through REST instead.
   */
  finishReplay(missed: MessageView[], truncated: boolean, latestSeq: number): void {
    if (truncated) {
      this.send({
        type: 'replay.truncated',
        conversationId: this.conversationId,
        fromSeq: this.lastSentSeq,
        latestSeq,
      });
      this.lastSentSeq = latestSeq;
    } else {
      for (const message of missed) this.deliver({ type: 'message.created', message });
    }
    this.send({
      type: 'replay.done',
      conversationId: this.conversationId,
      lastSeq: this.lastSentSeq,
    });

    for (const event of this.buffer) this.deliver(event);
    this.buffer = [];
    this.replaying = false;
  }

  private deliver(event: RealtimeEvent): void {
    if (event.type === 'message.created') {
      if (event.message.seq <= this.lastSentSeq) return; // already sent
      this.lastSentSeq = event.message.seq;
    }
    this.send(event);
  }
}
