import { ForbiddenError, NotFoundError } from '../../src/common/errors';
import type { Message, PrismaClient } from '../../src/generated/prisma/client';
import type { ParticipantRepository } from '../../src/modules/conversations/conversations.repository';
import type { ConversationsService } from '../../src/modules/conversations/conversations.service';
import type { MessageRepository } from '../../src/modules/messages/messages.repository';
import { MessagesService } from '../../src/modules/messages/messages.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { EventPublisher } from '../../src/realtime/publisher';
import { mockOf } from './fakes';

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    seq: 7,
    senderId: 'alice',
    body: 'hello',
    editedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('MessagesService', () => {
  let messages: jest.Mocked<MessageRepository>;
  let participants: jest.Mocked<ParticipantRepository>;
  let conversations: jest.Mocked<ConversationsService>;
  let notifications: jest.Mocked<NotificationsService>;
  let publisher: jest.Mocked<EventPublisher>;
  let service: MessagesService;
  const order: string[] = [];

  beforeEach(() => {
    order.length = 0;
    messages = mockOf<MessageRepository>('append', 'findById', 'update');
    participants = mockOf<ParticipantRepository>('listUserIds');
    conversations = mockOf<ConversationsService>('requireParticipant', 'isParticipant');
    notifications = mockOf<NotificationsService>('notifyNewMessage');
    publisher = mockOf<EventPublisher>('toConversation', 'toUser');
    service = new MessagesService(
      {} as PrismaClient,
      messages,
      participants,
      conversations,
      notifications,
      publisher,
    );

    messages.append.mockImplementation(async () => {
      order.push('saved');
      return message();
    });
    publisher.toConversation.mockImplementation(async () => {
      order.push('published');
    });
    participants.listUserIds.mockResolvedValue(['alice', 'bob', 'carol']);
  });

  it('saves first, then publishes, then notifies everyone except the sender', async () => {
    conversations.requireParticipant.mockResolvedValue({} as never);

    const view = await service.send('alice', 'conv-1', 'hello');

    expect(order).toEqual(['saved', 'published']);
    expect(publisher.toConversation).toHaveBeenCalledWith('conv-1', {
      type: 'message.created',
      message: view,
    });
    expect(notifications.notifyNewMessage).toHaveBeenCalledWith(['bob', 'carol'], message());
  });

  it('does not save a message from a non-participant', async () => {
    conversations.requireParticipant.mockRejectedValue(new NotFoundError('Conversation'));
    await expect(service.send('mallory', 'conv-1', 'hi')).rejects.toBeInstanceOf(NotFoundError);
    expect(messages.append).not.toHaveBeenCalled();
  });

  it("refuses to edit someone else's message", async () => {
    messages.findById.mockResolvedValue(message({ senderId: 'alice' }));
    conversations.isParticipant.mockResolvedValue(true);
    await expect(service.edit('bob', 'msg-1', 'x')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('hides the body of a deleted message but keeps its seq', async () => {
    messages.findById.mockResolvedValue(message());
    conversations.isParticipant.mockResolvedValue(true);
    messages.update.mockResolvedValue(message({ deletedAt: new Date() }));

    await service.delete('alice', 'msg-1');

    expect(publisher.toConversation).toHaveBeenCalledWith('conv-1', {
      type: 'message.deleted',
      message: expect.objectContaining({ seq: 7, body: null }),
    });
  });
});
