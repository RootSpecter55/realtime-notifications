import { ConversationSubscription } from '../../src/realtime/conversation-subscription';
import type { MessageView, ServerEvent } from '../../src/realtime/protocol';

const CONV = 'conv-1';

function message(seq: number, body = `m${seq}`): MessageView {
  return {
    id: `id-${seq}`,
    conversationId: CONV,
    seq,
    senderId: 'u1',
    body,
    editedAt: null,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}
const live = (seq: number) => ({ type: 'message.created' as const, message: message(seq) });

function setup(lastSeq = 0) {
  const sent: ServerEvent[] = [];
  const subscription = new ConversationSubscription(CONV, lastSeq, (e) => sent.push(e));
  const seqs = () => sent.flatMap((e) => (e.type === 'message.created' ? [e.message.seq] : []));
  return { subscription, sent, seqs };
}

describe('ConversationSubscription', () => {
  it('holds live events back until the replay has been sent', () => {
    const { subscription, sent } = setup(0);
    subscription.onLive(live(3));
    expect(sent).toEqual([]);

    subscription.finishReplay([message(1), message(2)], false, 0);
    expect(sent.map((e) => e.type)).toEqual([
      'message.created',
      'message.created',
      'replay.done',
      'message.created',
    ]);
  });

  it('drops a buffered event that the replay already included (no duplicates)', () => {
    const { subscription, seqs } = setup(0);
    // Message 2 was committed before the replay query AND published after the room join.
    subscription.onLive(live(2));
    subscription.onLive(live(3));
    subscription.finishReplay([message(1), message(2)], false, 0);
    expect(seqs()).toEqual([1, 2, 3]);
  });

  it('ignores messages at or below the seq the client already has', () => {
    const { subscription, seqs } = setup(5);
    subscription.finishReplay([], false, 5);
    subscription.onLive(live(5));
    subscription.onLive(live(6));
    expect(seqs()).toEqual([6]);
  });

  it('reports the last seq in replay.done', () => {
    const { subscription, sent } = setup(2);
    subscription.finishReplay([message(3), message(4)], false, 2);
    expect(sent.find((e) => e.type === 'replay.done')).toEqual({
      type: 'replay.done',
      conversationId: CONV,
      lastSeq: 4,
    });
  });

  it('tells the client to page through REST when there are too many missed messages', () => {
    const { subscription, sent, seqs } = setup(10);
    subscription.onLive(live(900)); // older than the latest seq at replay time: client pages it
    subscription.onLive(live(1001));
    subscription.finishReplay([message(11), message(12)], true, 1000);

    expect(sent[0]).toEqual({
      type: 'replay.truncated',
      conversationId: CONV,
      fromSeq: 10,
      latestSeq: 1000,
    });
    expect(seqs()).toEqual([1001]);
  });

  it('passes edits and deletions through even for already-sent messages', () => {
    const { subscription, sent } = setup(3);
    subscription.finishReplay([], false, 3);
    subscription.onLive({ type: 'message.updated', message: message(2, 'edited') });
    expect(sent.at(-1)).toMatchObject({ type: 'message.updated', message: { seq: 2 } });
  });
});
