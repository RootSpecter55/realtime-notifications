import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import jwt, { type SignOptions } from 'jsonwebtoken';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/** Issues and verifies HS256 JWTs. The same token works for HTTP and WebSocket connections. */
export class TokenService {
  constructor(
    private readonly secret: string,
    private readonly expiresIn: string,
  ) {}

  issue(user: { id: string; email: string }): string {
    const options = { subject: user.id, expiresIn: this.expiresIn, algorithm: 'HS256' };
    return jwt.sign({ email: user.email }, this.secret, options as SignOptions);
  }

  /** Returns the user id and email from a valid token; throws otherwise. */
  verify(token: string): { userId: string; email: string } {
    const payload = jwt.verify(token, this.secret, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || !payload.sub || typeof payload.email !== 'string') {
      throw new Error('Token is missing required claims');
    }
    return { userId: payload.sub, email: payload.email };
  }
}

/** scrypt is built into Node, so there are no native dependencies to compile. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return ['scrypt', salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}
