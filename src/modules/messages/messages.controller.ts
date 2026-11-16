import type { Request, Response } from 'express';
import { currentUser } from '../../common/auth-middleware';
import { sendData, sendPage } from '../../common/response';
import type {
  ConversationMessagesParams,
  EditMessageInput,
  ListMessagesQuery,
  MessageParams,
  SendMessageInput,
} from './messages.schemas';
import type { MessagesService } from './messages.service';

export class MessagesController {
  constructor(private readonly service: MessagesService) {}

  send = async (req: Request, res: Response) => {
    const { id } = req.validated.params as ConversationMessagesParams;
    const { body } = req.validated.body as SendMessageInput;
    sendData(res, await this.service.send(currentUser(req).id, id, body), 201);
  };

  list = async (req: Request, res: Response) => {
    const { id } = req.validated.params as ConversationMessagesParams;
    const query = req.validated.query as ListMessagesQuery;
    sendPage(res, await this.service.list(currentUser(req).id, id, query));
  };

  edit = async (req: Request, res: Response) => {
    const { id } = req.validated.params as MessageParams;
    const { body } = req.validated.body as EditMessageInput;
    sendData(res, await this.service.edit(currentUser(req).id, id, body));
  };

  delete = async (req: Request, res: Response) => {
    const { id } = req.validated.params as MessageParams;
    await this.service.delete(currentUser(req).id, id);
    res.status(204).end();
  };
}
