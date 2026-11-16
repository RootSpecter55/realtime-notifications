import type { Request, Response } from 'express';
import { currentUser } from '../../common/auth-middleware';
import { sendData, sendPage } from '../../common/response';
import type {
  AddParticipantInput,
  ConversationParams,
  CreateConversationInput,
  ListConversationsQuery,
  MarkReadInput,
  UpdateConversationInput,
} from './conversations.schemas';
import type { ConversationsService } from './conversations.service';

export class ConversationsController {
  constructor(private readonly service: ConversationsService) {}

  private id(req: Request) {
    return (req.validated.params as ConversationParams).id;
  }

  create = async (req: Request, res: Response) => {
    const input = req.validated.body as CreateConversationInput;
    sendData(res, await this.service.create(currentUser(req).id, input), 201);
  };

  list = async (req: Request, res: Response) => {
    const query = req.validated.query as ListConversationsQuery;
    sendPage(res, await this.service.list(currentUser(req).id, query));
  };

  get = async (req: Request, res: Response) => {
    sendData(res, await this.service.get(currentUser(req).id, this.id(req)));
  };

  update = async (req: Request, res: Response) => {
    const input = req.validated.body as UpdateConversationInput;
    sendData(res, await this.service.update(currentUser(req).id, this.id(req), input));
  };

  addParticipant = async (req: Request, res: Response) => {
    const { userId } = req.validated.body as AddParticipantInput;
    sendData(
      res,
      await this.service.addParticipant(currentUser(req).id, this.id(req), userId),
      201,
    );
  };

  leave = async (req: Request, res: Response) => {
    await this.service.leave(currentUser(req).id, this.id(req));
    res.status(204).end();
  };

  markRead = async (req: Request, res: Response) => {
    const { seq } = req.validated.body as MarkReadInput;
    sendData(res, await this.service.markRead(currentUser(req).id, this.id(req), seq));
  };

  presence = async (req: Request, res: Response) => {
    sendData(res, await this.service.presence(currentUser(req).id, this.id(req)));
  };
}
