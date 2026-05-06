import { describe, it, expect, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InvestorsService } from './investors.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

function makePrisma() {
  return {
    investor: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    certificate: {
      groupBy: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { investor_capital: null } }),
      count: vi.fn().mockResolvedValue(0),
    },
  } as unknown as PrismaService;
}

function makeAudit() {
  return { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

describe('InvestorsService.list', () => {
  it('returns paginated mapped investors with active_cert_count and total_invested', async () => {
    const prisma = makePrisma();
    (prisma.investor.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'i-1',
        legal_name: 'Inversora Alpha',
        rif: 'J-12345678-9',
        kind: 'juridica',
        status: 'active',
        email: null,
        phone: null,
        notes: null,
        created_at: new Date('2026-04-15'),
        updated_at: new Date('2026-04-15'),
        updated_by: null,
      },
    ]);
    (prisma.investor.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    (prisma.certificate.groupBy as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { investor_id: 'i-1', _count: { _all: 2 } },
    ]);
    (prisma.certificate.aggregate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      _sum: { investor_capital: new Prisma.Decimal('285000.00') },
    });

    const svc = new InvestorsService(prisma, makeAudit());
    const r = await svc.list({ limit: 50, offset: 0, sort: 'name_asc' });
    expect(r.total).toBe(1);
    expect(r.data[0]!.active_cert_count).toBe(2);
    expect(r.data[0]!.total_invested).toBe('285000.0000');
  });

  it('passes q-search across legal_name and rif (case-insensitive)', async () => {
    const prisma = makePrisma();
    const svc = new InvestorsService(prisma, makeAudit());
    await svc.list({ limit: 50, offset: 0, sort: 'name_asc', q: 'Alpha' });
    const call = (prisma.investor.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where.OR).toEqual([
      { legal_name: { contains: 'Alpha', mode: 'insensitive' } },
      { rif: { contains: 'Alpha', mode: 'insensitive' } },
    ]);
  });
});

describe('InvestorsService.detail', () => {
  it('returns mapped investor', async () => {
    const prisma = makePrisma();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'i-1',
      legal_name: 'Inversora Alpha',
      rif: 'J-12345678-9',
      kind: 'juridica',
      status: 'active',
      email: null,
      phone: null,
      notes: null,
      created_at: new Date('2026-04-15'),
      updated_at: new Date('2026-04-15'),
      updated_by: null,
    });
    (prisma.certificate.aggregate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      _sum: { investor_capital: new Prisma.Decimal('100000.00') },
    });

    const svc = new InvestorsService(prisma, makeAudit());
    const r = await svc.detail('i-1');
    expect(r.legal_name).toBe('Inversora Alpha');
    expect(r.total_invested).toBe('100000.0000');
  });

  it('throws NotFoundException when investor missing', async () => {
    const prisma = makePrisma();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const svc = new InvestorsService(prisma, makeAudit());
    await expect(svc.detail('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('InvestorsService.create', () => {
  it('normalizes RIF, persists, records audit', async () => {
    const prisma = makePrisma();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (prisma.investor.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'i-2',
      legal_name: 'Nueva Inversora',
      rif: 'J-30123456-7',
      kind: 'juridica',
      status: 'active',
      email: null,
      phone: null,
      notes: null,
      created_at: new Date(),
      updated_at: new Date(),
      updated_by: null,
    });
    const audit = makeAudit();
    const svc = new InvestorsService(prisma, audit);

    const r = await svc.create({
      input: { legal_name: 'Nueva Inversora', rif: 'j-30123456-7', kind: 'juridica' },
      actorId: 'a-1',
    });
    expect(r.rif).toBe('J-30123456-7');
    const createCall = (prisma.investor.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createCall.data.rif).toBe('J-30123456-7');
    expect(audit.recordChange).toHaveBeenCalledOnce();
  });

  it('throws ConflictException when RIF already exists', async () => {
    const prisma = makePrisma();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'existing-1',
    });
    const svc = new InvestorsService(prisma, makeAudit());
    await expect(
      svc.create({
        input: { legal_name: 'X', rif: 'J-12345678-9', kind: 'juridica' },
        actorId: 'a-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
