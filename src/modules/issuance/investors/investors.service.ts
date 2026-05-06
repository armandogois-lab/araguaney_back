import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { normalizeRif } from '../../batches/rif-normalizer';
import { toInvestorSummary, type InvestorSummaryRow } from './responses/investor-summary.mapper';
import { toInvestorDetail } from './responses/investor-detail.mapper';
import type { InvestorsListQuery, InvestorCreate, InvestorUpdate } from './investors.dto';

const SORT_MAP = {
  name_asc: [{ legal_name: 'asc' as const }],
  name_desc: [{ legal_name: 'desc' as const }],
  created_desc: [{ created_at: 'desc' as const }],
};

@Injectable()
export class InvestorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: InvestorsListQuery) {
    const where: Prisma.InvestorWhereInput = {};
    if (query.q) {
      where.OR = [
        { legal_name: { contains: query.q, mode: 'insensitive' } },
        { rif: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.kind) where.kind = query.kind;
    if (query.status) where.status = query.status;

    const [rows, total] = await Promise.all([
      this.prisma.investor.findMany({
        where,
        include: { updated_by: true },
        orderBy: SORT_MAP[query.sort],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.investor.count({ where }),
    ]);

    if (rows.length === 0) {
      return { data: [], total, limit: query.limit, offset: query.offset };
    }

    const ids = rows.map((r) => r.id);
    const counts = await this.prisma.certificate.groupBy({
      by: ['investor_id'],
      where: { investor_id: { in: ids }, status: { in: ['issued', 'matured'] }, deleted_at: null },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.investor_id, c._count._all]));

    const enriched = await Promise.all(
      rows.map(async (r) => {
        const agg = await this.prisma.certificate.aggregate({
          where: { investor_id: r.id, status: { in: ['issued', 'matured'] }, deleted_at: null },
          _sum: { investor_capital: true },
        });
        return toInvestorSummary({
          ...(r as unknown as InvestorSummaryRow),
          active_cert_count: countMap.get(r.id) ?? 0,
          total_invested: agg._sum.investor_capital ?? new Prisma.Decimal(0),
        });
      }),
    );

    return { data: enriched, total, limit: query.limit, offset: query.offset };
  }

  async detail(id: string) {
    const i = await this.prisma.investor.findUnique({
      where: { id },
      include: { updated_by: true },
    });
    if (!i) throw new NotFoundException('Inversor no encontrado');

    const [count, agg] = await Promise.all([
      this.prisma.certificate.count({
        where: { investor_id: id, status: { in: ['issued', 'matured'] }, deleted_at: null },
      }),
      this.prisma.certificate.aggregate({
        where: { investor_id: id, status: { in: ['issued', 'matured'] }, deleted_at: null },
        _sum: { investor_capital: true },
      }),
    ]);

    return toInvestorDetail({
      ...(i as unknown as InvestorSummaryRow),
      active_cert_count: count,
      total_invested: agg._sum.investor_capital ?? new Prisma.Decimal(0),
    });
  }

  async create(opts: { input: InvestorCreate; actorId: string }) {
    const canonicalRif = normalizeRif(opts.input.rif);
    if (!canonicalRif) {
      throw new BadRequestException('RIF inválido');
    }

    const existing = await this.prisma.investor.findUnique({ where: { rif: canonicalRif } });
    if (existing) {
      throw new ConflictException({
        message: 'Inversor con ese RIF ya existe',
        existing_id: existing.id,
      });
    }

    const created = await this.prisma.investor.create({
      data: {
        legal_name: opts.input.legal_name,
        rif: canonicalRif,
        kind: opts.input.kind,
        status: 'active',
        email: opts.input.email ?? null,
        phone: opts.input.phone ?? null,
        notes: opts.input.notes ?? null,
        created_by_id: opts.actorId,
      },
      include: { updated_by: true },
    });

    await this.audit.recordChange({
      entityType: 'investor',
      entityId: created.id,
      action: 'create',
      actorId: opts.actorId,
      payload: {
        legal_name: created.legal_name,
        rif: created.rif,
        kind: created.kind,
        email: created.email,
        phone: created.phone,
      },
    });

    return toInvestorSummary({
      ...(created as unknown as InvestorSummaryRow),
      active_cert_count: 0,
      total_invested: new Prisma.Decimal(0),
    });
  }

  async update(id: string, input: InvestorUpdate, actorId: string) {
    return await this.prisma.$transaction(async (tx) => {
      const existing = await tx.investor.findUnique({
        where: { id },
        include: { updated_by: true },
      });
      if (!existing) throw new NotFoundException('Inversor no encontrado');

      if (
        existing.kind === 'internal' &&
        input.status !== undefined &&
        input.status !== existing.status
      ) {
        throw new ConflictException({
          message: 'El inversor interno no puede cambiar de estado',
          kind: 'internal',
        });
      }

      const editableFields: Array<keyof InvestorUpdate> = [
        'legal_name',
        'email',
        'phone',
        'notes',
        'status',
      ];

      const changed: Record<string, { from: unknown; to: unknown }> = {};
      const data: Prisma.InvestorUncheckedUpdateInput = {};
      for (const k of editableFields) {
        if (!(k in input)) continue;
        const next = input[k] ?? null;
        const prev = (existing as Record<string, unknown>)[k] ?? null;
        if (prev !== next) {
          changed[k] = { from: prev, to: next };
          (data as Record<string, unknown>)[k] = next;
        }
      }

      if (Object.keys(changed).length === 0) {
        return this.assembleSummary(tx, existing);
      }

      const updated = await tx.investor.update({
        where: { id },
        data: {
          ...data,
          updated_at: new Date(),
          updated_by_id: actorId,
        },
        include: { updated_by: true },
      });

      await this.audit.recordChange({
        entityType: 'investor',
        entityId: id,
        action: 'update',
        actorId,
        payload: { changed },
        tx,
      });

      return this.assembleSummary(tx, updated);
    });
  }

  private async assembleSummary(
    tx: Prisma.TransactionClient,
    row: { id: string } & Record<string, unknown>,
  ) {
    const [count, agg] = await Promise.all([
      tx.certificate.count({
        where: { investor_id: row.id, status: { in: ['issued', 'matured'] }, deleted_at: null },
      }),
      tx.certificate.aggregate({
        where: { investor_id: row.id, status: { in: ['issued', 'matured'] }, deleted_at: null },
        _sum: { investor_capital: true },
      }),
    ]);
    return toInvestorSummary({
      ...(row as unknown as InvestorSummaryRow),
      active_cert_count: count,
      total_invested: agg._sum.investor_capital ?? new Prisma.Decimal(0),
    });
  }
}
