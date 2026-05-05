import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('HealthController', () => {
  let controller: HealthController;
  let prisma: { $queryRaw: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = { $queryRaw: vi.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('returns 200 with database ok when SELECT 1 succeeds', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const result = await controller.health();
    expect(result.status).toBe('ok');
    expect(result.database.status).toBe('ok');
    expect(typeof result.database.latencyMs).toBe('number');
    expect(result.uptime).toBeGreaterThan(0);
    expect(typeof result.timestamp).toBe('string');
    expect(result.version).toBe('0.1.0');
  });

  it('throws 503 when SELECT 1 rejects', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    await expect(controller.health()).rejects.toMatchObject({ status: 503 });
  });
});
