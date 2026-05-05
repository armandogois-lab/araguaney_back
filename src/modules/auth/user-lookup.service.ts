import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { LookupResult } from './types';

@Injectable()
export class UserLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async findByAuthId(authUserId: string): Promise<LookupResult> {
    const row = await this.prisma.user.findUnique({
      where: { auth_user_id: authUserId },
      select: {
        id: true,
        email: true,
        full_name: true,
        role: true,
        is_active: true,
      },
    });
    if (!row) return { kind: 'not_registered' };
    if (!row.is_active) return { kind: 'deactivated' };
    return { kind: 'found', user: row };
  }
}
