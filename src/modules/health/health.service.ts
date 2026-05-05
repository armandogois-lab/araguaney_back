import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface DatabaseStatus {
  status: 'ok' | 'down';
  latencyMs: number;
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async checkDatabase(): Promise<DatabaseStatus> {
    const t = process.hrtime.bigint();
    await this.prisma.$queryRaw`SELECT 1`;
    const dtNs = process.hrtime.bigint() - t;
    return { status: 'ok', latencyMs: Number(dtNs) / 1_000_000 };
  }
}
