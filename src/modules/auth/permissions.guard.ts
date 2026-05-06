import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { REQUIRE_PERMISSION_KEY } from './decorators/require-permission.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      REQUIRE_PERMISSION_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const user = req.user;
    if (!user) {
      throw new UnauthorizedException('Not authenticated');
    }

    const granted = await this.prisma.rolePermission.findMany({
      where: {
        role: user.role,
        permission: { key: { in: required } },
      },
      select: { permission: { select: { key: true } } },
    });
    const grantedKeys = new Set(granted.map((g) => g.permission.key));
    const missing = required.filter((k) => !grantedKeys.has(k));
    if (missing.length > 0) {
      throw new ForbiddenException(`Permission denied: ${missing.join(', ')}`);
    }
    return true;
  }
}
