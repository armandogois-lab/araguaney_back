import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { JwtService } from './jwt.service';
import { UserLookupService } from './user-lookup.service';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UserLookupService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const auth = req.headers['authorization'];
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }
    const token = auth.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }

    const claims = await this.jwt.verify(token);
    if (!claims.sub) {
      throw new UnauthorizedException('Token missing subject');
    }

    const result = await this.users.findByAuthId(claims.sub);
    switch (result.kind) {
      case 'not_registered':
        throw new ForbiddenException('User not registered in the system');
      case 'deactivated':
        throw new ForbiddenException('User account is deactivated');
      case 'found':
        req.user = result.user;
        return true;
    }
  }
}
