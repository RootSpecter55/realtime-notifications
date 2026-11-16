import type { Request, Response } from 'express';
import { currentUser } from '../../common/auth-middleware';
import { sendData, sendPage } from '../../common/response';
import type {
  ListUsersQuery,
  LoginInput,
  RegisterInput,
  UpdateMeInput,
  UserParams,
} from './users.schemas';
import type { UsersService } from './users.service';

export class UsersController {
  constructor(private readonly service: UsersService) {}

  register = async (req: Request, res: Response) => {
    sendData(res, await this.service.register(req.validated.body as RegisterInput), 201);
  };

  login = async (req: Request, res: Response) => {
    sendData(res, await this.service.login(req.validated.body as LoginInput));
  };

  me = async (req: Request, res: Response) => {
    sendData(res, await this.service.get(currentUser(req).id));
  };

  updateMe = async (req: Request, res: Response) => {
    const input = req.validated.body as UpdateMeInput;
    sendData(res, await this.service.updateMe(currentUser(req).id, input));
  };

  deleteMe = async (req: Request, res: Response) => {
    await this.service.deleteMe(currentUser(req).id);
    res.status(204).end();
  };

  list = async (req: Request, res: Response) => {
    sendPage(res, await this.service.list(req.validated.query as ListUsersQuery));
  };

  get = async (req: Request, res: Response) => {
    sendData(res, await this.service.get((req.validated.params as UserParams).id));
  };

  presence = async (req: Request, res: Response) => {
    sendData(res, await this.service.presence((req.validated.params as UserParams).id));
  };
}
