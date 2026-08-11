import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

export type Role = 'viewer' | 'analyst';

export interface AuthClaims {
  sub: number;
  email: string;
  role: Role;
}

const TOKEN_TTL = '8h';

export function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

export function signToken(claims: AuthClaims): string {
  return jwt.sign(claims, jwtSecret(), { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): AuthClaims {
  const decoded = jwt.verify(token, jwtSecret());
  if (typeof decoded !== 'object' || decoded === null) throw new Error('bad token payload');
  const { sub, email, role } = decoded as Record<string, unknown>;
  if (typeof email !== 'string' || (role !== 'viewer' && role !== 'analyst')) {
    throw new Error('bad token payload');
  }
  return { sub: Number(sub), email, role };
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthClaims;
  }
}

/** Attaches req.auth when a valid bearer token is present; anonymous otherwise. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      req.auth = verifyToken(header.slice('Bearer '.length));
    } catch {
      // invalid token = anonymous; role guards below decide what that may do
    }
  }
  next();
}

/** Route guard: require a signed-in user with one of the given roles. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (!roles.includes(req.auth.role)) {
      res.status(403).json({ error: `requires role: ${roles.join(' or ')}` });
      return;
    }
    next();
  };
}
