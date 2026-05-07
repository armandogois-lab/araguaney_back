import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('returns { status: "ok" } without touching the database', () => {
    const result = controller.health();
    expect(result).toEqual({ status: 'ok' });
  });
});
