import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { computePricing, computePayouts } from './pricing/pricing';
import { fillPool, type EligibleOrder } from './pool-builder/pool-builder';
import { computePayloadHash, buildHashPayload } from './payload-hash/payload-hash';
import { isoWeek } from './helpers/iso-week';
import { toSimulationResult } from './responses/simulation-result.mapper';
import {
  toCertificateSummary,
  type CertificateSummaryRow,
} from './responses/certificate-summary.mapper';
import {
  toCertificateDetail,
  type CertificateDetailRow,
} from './responses/certificate-detail.mapper';
import type {
  CertificateSimulate,
  CertificateIssue,
  CertificatesListQuery,
} from './certificates.dto';
import type { AuthUser } from '../../auth/types';

const D = Prisma.Decimal;
const TOP_N = 5;
const MS_PER_DAY = 86_400_000;
const CERTIFICATE_SORT_MAP = {
  issue_date_desc: [{ issue_date: 'desc' as const }],
  issue_date_asc: [{ issue_date: 'asc' as const }],
  code_asc: [{ certificate_code: 'asc' as const }],
};

@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async simulate(input: CertificateSimulate) {
    const investor = await this.prisma.investor.findUnique({ where: { id: input.investor_id } });
    if (!investor) throw new NotFoundException('Inversor no encontrado');
    if (investor.status !== 'active') {
      throw new BadRequestException('Inversor inactivo');
    }

    const capital = new D(input.capital);
    const rate = new D(input.rate);
    const { price, nominalTarget } = computePricing({ capital, rate, termDays: input.term_days });

    const maturityDate = new Date(input.issue_date);
    maturityDate.setUTCDate(maturityDate.getUTCDate() + input.term_days);

    const eligible = await this.prisma.order.findMany({
      where: {
        status: 'available',
        min_due_date: { gte: input.issue_date },
        max_due_date: { lte: maturityDate },
      },
      select: {
        id: true,
        external_order_id: true,
        installments_sum: true,
        merchant_id: true,
        num_installments: true,
        min_due_date: true,
        max_due_date: true,
        purchase_date: true,
      },
    });

    const eligibleForPool: EligibleOrder[] = eligible.map((o) => ({
      id: o.id,
      external_order_id: o.external_order_id,
      installments_sum: o.installments_sum,
      merchant_id: o.merchant_id,
      num_installments: o.num_installments,
      max_due_date: o.max_due_date,
    }));

    const { selected, nominalActual } = fillPool(eligibleForPool, nominalTarget);
    if (selected.length === 0) {
      throw new UnprocessableEntityException('No hay órdenes elegibles para los parámetros');
    }

    const payouts = computePayouts({ capital, price, nominalTarget, nominalActual });

    const merchantIds = [...new Set(selected.map((o) => o.merchant_id))];
    const merchants = await this.prisma.merchant.findMany({
      where: { id: { in: merchantIds } },
      select: { id: true, current_name: true, rif: true },
    });
    const merchantMap = new Map(merchants.map((m) => [m.id, m]));

    // Concentration aggregation
    const byMerchantSum = new Map<string, Prisma.Decimal>();
    for (const o of selected) {
      byMerchantSum.set(
        o.merchant_id,
        (byMerchantSum.get(o.merchant_id) ?? new D(0)).plus(o.installments_sum),
      );
    }
    const concentrationTop = Array.from(byMerchantSum.entries())
      .sort((a, b) => b[1].comparedTo(a[1]))
      .slice(0, TOP_N)
      .map(([merchant_id, amount]) => {
        const m = merchantMap.get(merchant_id)!;
        return {
          merchant_id,
          current_name: m.current_name,
          rif: m.rif,
          amount,
          pct: nominalActual.isZero()
            ? new D(0)
            : amount.div(nominalActual).toDecimalPlaces(6, D.ROUND_HALF_UP),
        };
      });

    // Installment plazo days range
    let minPlazo = Number.MAX_SAFE_INTEGER;
    let maxPlazo = 0;
    const issueTime = input.issue_date.getTime();
    for (const o of selected) {
      const days = Math.round((o.max_due_date.getTime() - issueTime) / MS_PER_DAY);
      if (days < minPlazo) minPlazo = days;
      if (days > maxPlazo) maxPlazo = days;
    }

    // Due-date distribution from installments of selected orders
    const installments = await this.prisma.installment.findMany({
      where: { order_id: { in: selected.map((o) => o.id) } },
      select: { order_id: true, amount: true, due_date: true },
    });
    const byDate = new Map<string, Prisma.Decimal>();
    for (const i of installments) {
      const k = i.due_date.toISOString().slice(0, 10);
      byDate.set(k, (byDate.get(k) ?? new D(0)).plus(i.amount));
    }
    const due_date_distribution = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, amount]) => ({ date: new Date(`${k}T00:00:00Z`), amount }));

    // Payload hash
    const payload_hash = computePayloadHash(
      buildHashPayload({
        capital,
        rate,
        termDays: input.term_days,
        issueDate: input.issue_date,
        investorId: input.investor_id,
        price,
        nominalTarget,
        nominalActual,
        payouts,
        selectedOrderIds: selected.map((o) => o.id),
      }),
    );

    return toSimulationResult({
      investor: { id: investor.id, legal_name: investor.legal_name, rif: investor.rif },
      capital,
      rate,
      term_days: input.term_days,
      issue_date: input.issue_date,
      maturity_date: maturityDate,
      price,
      nominal_target: nominalTarget,
      nominal_actual: nominalActual,
      investor_paid: payouts.investorPaid,
      investor_returned: payouts.investorReturned,
      investor_yield: payouts.investorYield,
      shortfall_pct: payouts.shortfallPct,
      selected_orders: selected.map((s) => ({
        id: s.id,
        installments_sum: s.installments_sum,
        merchant_id: s.merchant_id,
        num_installments: s.num_installments,
        max_due_date: s.max_due_date,
      })),
      total_eligible_merchants: merchantIds.length,
      installment_plazo_days: { min: minPlazo, max: maxPlazo },
      concentration_top: concentrationTop,
      total_distinct_merchants: new Set(selected.map((o) => o.merchant_id)).size,
      due_date_distribution,
      payload_hash,
    });
  }

  async issue(input: CertificateIssue, actorId: string) {
    return await this.prisma.$transaction(
      async (tx) => {
        const investor = await tx.investor.findUnique({ where: { id: input.investor_id } });
        if (!investor) throw new NotFoundException('Inversor no encontrado');
        if (investor.status !== 'active') {
          throw new BadRequestException('Inversor inactivo');
        }

        const capital = new D(input.capital);
        const rate = new D(input.rate);
        const { price, nominalTarget } = computePricing({
          capital,
          rate,
          termDays: input.term_days,
        });
        const maturityDate = new Date(input.issue_date);
        maturityDate.setUTCDate(maturityDate.getUTCDate() + input.term_days);

        const lockedOrders = await tx.$queryRaw<
          Array<{
            id: string;
            external_order_id: string;
            installments_sum: Prisma.Decimal;
            min_due_date: Date;
            max_due_date: Date;
            merchant_id: string;
            status: string;
          }>
        >(
          Prisma.sql`SELECT id, external_order_id, installments_sum, min_due_date, max_due_date, merchant_id, status
                     FROM cfb.orders
                     WHERE id = ANY(${input.order_ids}::uuid[])
                     FOR UPDATE`,
        );

        if (lockedOrders.length !== input.order_ids.length) {
          throw new ConflictException({
            message: 'Una o más órdenes no existen',
            missing_count: input.order_ids.length - lockedOrders.length,
          });
        }

        const conflicting = lockedOrders.filter((o) => o.status !== 'available');
        if (conflicting.length > 0) {
          throw new ConflictException({
            message: 'Orden(es) ya asignada(s) a otro certificado',
            conflicting_order_ids: conflicting.map((o) => o.id),
          });
        }

        const minDue = lockedOrders.reduce(
          (m, o) => (o.min_due_date < m ? o.min_due_date : m),
          new Date(8640000000000000),
        );
        if (minDue < input.issue_date) {
          throw new UnprocessableEntityException(
            'Una orden tiene cuotas que vencen antes de la fecha de emisión del certificado',
          );
        }

        const maxDue = lockedOrders.reduce(
          (m, o) => (o.max_due_date > m ? o.max_due_date : m),
          new Date(0),
        );
        if (maxDue > maturityDate) {
          throw new UnprocessableEntityException(
            'Una orden tiene cuotas que vencen después del vencimiento del certificado',
          );
        }

        const eligibleForPool: EligibleOrder[] = lockedOrders.map((o) => ({
          id: o.id,
          external_order_id: o.external_order_id,
          installments_sum: o.installments_sum,
          merchant_id: o.merchant_id,
          num_installments: 0,
          max_due_date: o.max_due_date,
        }));
        const { selected, nominalActual } = fillPool(eligibleForPool, nominalTarget);

        const recomputedIds = new Set(selected.map((o) => o.id));
        const clientIds = new Set(input.order_ids);
        if (
          recomputedIds.size !== clientIds.size ||
          ![...recomputedIds].every((id) => clientIds.has(id))
        ) {
          throw new UnprocessableEntityException('Pool inválido — re-corra /simulate');
        }

        const payouts = computePayouts({ capital, price, nominalTarget, nominalActual });

        const recomputedHash = computePayloadHash(
          buildHashPayload({
            capital,
            rate,
            termDays: input.term_days,
            issueDate: input.issue_date,
            investorId: input.investor_id,
            price,
            nominalTarget,
            nominalActual,
            payouts,
            selectedOrderIds: selected.map((o) => o.id),
          }),
        );

        if (recomputedHash !== input.expected_payload_hash) {
          throw new UnprocessableEntityException('Payload mismatch — re-corra /simulate');
        }

        const cycleWeek = isoWeek(input.issue_date);

        const cert = await tx.certificate.create({
          data: {
            certificate_code: null,
            certificate_type: 'standard',
            status: 'draft',
            investor_id: input.investor_id,
            investor_capital: capital,
            annual_rate: rate,
            rate_basis: 'ACT/360',
            term_days: input.term_days,
            price,
            nominal_target: nominalTarget,
            nominal_actual: nominalActual,
            investor_paid: payouts.investorPaid,
            investor_returned: payouts.investorReturned,
            investor_yield: payouts.investorYield,
            shortfall_pct: payouts.shortfallPct,
            issue_date: input.issue_date,
            maturity_date: maturityDate,
            cycle_week: cycleWeek,
            payload_hash: recomputedHash,
            issued_by_id: actorId,
          },
        });

        await tx.certificateOrder.createMany({
          data: selected.map((o) => ({
            certificate_id: cert.id,
            order_id: o.id,
            installments_sum_snapshot: o.installments_sum,
            assigned_by_id: actorId,
          })),
        });

        await tx.order.updateMany({
          where: { id: { in: selected.map((o) => o.id) } },
          data: { status: 'reserved' },
        });

        await tx.certificateEvent.create({
          data: {
            certificate_id: cert.id,
            event_type: 'draft_created',
            payload: {
              order_count: selected.length,
              nominal_actual: nominalActual.toFixed(4),
              investor_paid: payouts.investorPaid.toFixed(4),
            } as Prisma.InputJsonValue,
            actor_id: actorId,
          },
        });

        await this.audit.recordChange({
          entityType: 'certificate',
          entityId: cert.id,
          action: 'create_draft',
          actorId,
          payload: {
            inputs: {
              capital: capital.toFixed(4),
              rate: rate.toFixed(6),
              term_days: input.term_days,
              issue_date: input.issue_date.toISOString().slice(0, 10),
              investor_id: input.investor_id,
            },
            order_count: selected.length,
            payload_hash: recomputedHash,
          },
          tx,
        });

        return { id: cert.id, status: 'draft' as const };
      },
      { timeout: 30_000 },
    );
  }
  async list(query: CertificatesListQuery, callerRole: AuthUser['role']) {
    const where: Prisma.CertificateWhereInput = {};
    if (query.include_deleted) {
      const hasReadDeleted = await this.hasReadDeletedPerm(callerRole);
      if (!hasReadDeleted) where.deleted_at = null;
    } else {
      where.deleted_at = null;
    }
    if (query.status) where.status = query.status;
    if (query.certificate_type) where.certificate_type = query.certificate_type;
    if (query.investor_id) where.investor_id = query.investor_id;
    if (query.issue_date_from || query.issue_date_to) {
      where.issue_date = {};
      if (query.issue_date_from)
        (where.issue_date as Record<string, Date>).gte = query.issue_date_from;
      if (query.issue_date_to) (where.issue_date as Record<string, Date>).lte = query.issue_date_to;
    }
    if (query.q) {
      where.certificate_code = { contains: query.q, mode: 'insensitive' };
    }

    const [rows, total] = await Promise.all([
      this.prisma.certificate.findMany({
        where,
        include: { investor: true, issued_by: true },
        orderBy: CERTIFICATE_SORT_MAP[query.sort],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.certificate.count({ where }),
    ]);

    return {
      data: rows.map((c) => toCertificateSummary(c as unknown as CertificateSummaryRow)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async detail(id: string, callerRole: AuthUser['role']) {
    const c = await this.prisma.certificate.findUnique({
      where: { id },
      include: {
        investor: true,
        issued_by: true,
        deleted_by: true,
        certificate_orders: {
          include: {
            order: {
              include: {
                merchant: true,
                installments: { orderBy: { installment_number: 'asc' } },
              },
            },
          },
          orderBy: { assigned_at: 'asc' },
        },
        certificate_events: { orderBy: { occurred_at: 'desc' }, take: 50 },
      },
    });
    if (!c) throw new NotFoundException('Certificado no encontrado');
    if (c.deleted_at !== null) {
      const hasReadDeleted = await this.hasReadDeletedPerm(callerRole);
      if (!hasReadDeleted) {
        throw new NotFoundException('Certificado no encontrado');
      }
    }
    return toCertificateDetail(c as unknown as CertificateDetailRow);
  }

  async cancel(id: string, reason: string | undefined, actorId: string, actorRole: AuthUser['role']) {
    return await this.prisma.$transaction(
      async (tx) => {
        const lockedCertRows = await tx.$queryRaw<
          Array<{
            id: string;
            certificate_code: string;
            status: string;
            certificate_type: string;
            deleted_at: Date | null;
          }>
        >(
          Prisma.sql`SELECT id, certificate_code, status, certificate_type, deleted_at
                     FROM cfb.certificates
                     WHERE id = ${id}::uuid
                     FOR UPDATE`,
        );

        if (lockedCertRows.length === 0 || lockedCertRows[0]!.deleted_at !== null) {
          throw new NotFoundException('Certificado no encontrado');
        }
        const cert = lockedCertRows[0]!;

        if (cert.status !== 'draft' && cert.status !== 'issued') {
          throw new ConflictException({
            message: `Solo se pueden cancelar borradores o certificados emitidos (status actual: ${cert.status})`,
            current_status: cert.status,
          });
        }

        // Draft cancel: creator or admin. Issued cancel: admin with cert.cancel.
        if (cert.status === 'draft') {
          const ownerRow = await tx.$queryRaw<Array<{ issued_by_id: string }>>(
            Prisma.sql`SELECT issued_by_id FROM cfb.certificates WHERE id = ${id}::uuid`,
          );
          const isCreator = ownerRow[0]?.issued_by_id === actorId;
          const isAdmin = actorRole === 'admin';
          if (!isCreator && !isAdmin) {
            throw new ForbiddenException(
              'Solo el creador del borrador o un admin puede cancelarlo',
            );
          }
        } else {
          // status === 'issued': require certificate.cancel grant for actor's role
          const hasCancelPerm = await tx.rolePermission.findFirst({
            where: { role: actorRole, permission: { key: 'certificate.cancel' } },
            select: { id: true },
          });
          if (!hasCancelPerm) {
            throw new ForbiddenException(
              'Solo un usuario con permiso certificate.cancel puede cancelar certificados emitidos',
            );
          }
        }

        const certOrders = await tx.$queryRaw<Array<{ order_id: string }>>(
          Prisma.sql`SELECT order_id
                     FROM cfb.certificate_orders
                     WHERE certificate_id = ${id}::uuid AND released_at IS NULL
                     FOR UPDATE`,
        );

        const now = new Date();

        await tx.certificate.update({
          where: { id },
          data: {
            status: 'cancelled',
            cancelled_at: now,
            cancellation_reason: reason ?? null,
            // For issued certs we also populate the legacy soft-delete columns to
            // preserve symmetry with pre-Slice-13 data. Drafts skip them.
            ...(cert.status === 'issued'
              ? {
                  deleted_at: now,
                  deleted_by_id: actorId,
                  deleted_reason: reason ?? 'cancelled_without_reason',
                }
              : {}),
          },
        });

        await tx.certificateOrder.updateMany({
          where: { certificate_id: id, released_at: null },
          data: { released_at: now, released_reason: `cert_cancelled: ${reason}` },
        });

        const orderIds = certOrders.map((co) => co.order_id);
        if (orderIds.length > 0) {
          await tx.order.updateMany({
            where: { id: { in: orderIds } },
            data: { status: 'available' },
          });
        }

        await tx.certificateEvent.create({
          data: {
            certificate_id: id,
            event_type: 'cancelled',
            payload: {
              reason,
              certificate_type: cert.certificate_type,
              order_count: orderIds.length,
              cancelled_at: now.toISOString(),
            } as Prisma.InputJsonValue,
            actor_id: actorId,
          },
        });

        await this.audit.recordChange({
          entityType: 'certificate',
          entityId: id,
          action: 'cancel',
          actorId,
          payload: {
            from_status: cert.status,
            certificate_code: cert.certificate_code,
            certificate_type: cert.certificate_type,
            reason: reason ?? null,
            order_count: orderIds.length,
            released_order_ids: orderIds,
          },
          tx,
        });

        return {
          id,
          certificate_code: cert.certificate_code,
          status: 'cancelled' as const,
          cancelled_at: now.toISOString(),
          released_order_count: orderIds.length,
        };
      },
      { timeout: 30_000 },
    );
  }

  async approve(id: string, actorId: string) {
    return await this.prisma.$transaction(
      async (tx) => {
        const lockedCertRows = await tx.$queryRaw<
          Array<{
            id: string;
            status: string;
            certificate_code: string | null;
            certificate_type: string;
            deleted_at: Date | null;
          }>
        >(
          Prisma.sql`SELECT id, status, certificate_code, certificate_type, deleted_at
                     FROM cfb.certificates
                     WHERE id = ${id}::uuid
                     FOR UPDATE`,
        );

        if (lockedCertRows.length === 0 || lockedCertRows[0]!.deleted_at !== null) {
          throw new NotFoundException('Certificado no encontrado');
        }
        const cert = lockedCertRows[0]!;

        if (cert.status !== 'draft') {
          throw new ConflictException({
            message: `Solo se pueden aprobar borradores (status actual: ${cert.status})`,
            current_status: cert.status,
          });
        }

        const codeRows = await tx.$queryRaw<Array<{ code: string }>>(
          Prisma.sql`SELECT cfb.next_certificate_code() AS code`,
        );
        const certificate_code = codeRows[0]!.code;
        const now = new Date();

        await tx.certificate.update({
          where: { id },
          data: {
            status: 'issued',
            certificate_code,
            approved_by_id: actorId,
            approved_at: now,
          },
        });

        const certOrders = await tx.certificateOrder.findMany({
          where: { certificate_id: id, released_at: null },
          select: { order_id: true },
        });
        const orderIds = certOrders.map((co) => co.order_id);
        if (orderIds.length > 0) {
          await tx.order.updateMany({
            where: { id: { in: orderIds } },
            data: { status: 'assigned' },
          });
        }

        await tx.certificateEvent.create({
          data: {
            certificate_id: id,
            event_type: 'approved',
            payload: {
              certificate_code,
              order_count: orderIds.length,
              approved_at: now.toISOString(),
            } as Prisma.InputJsonValue,
            actor_id: actorId,
          },
        });

        await this.audit.recordChange({
          entityType: 'certificate',
          entityId: id,
          action: 'approve',
          actorId,
          payload: {
            before: { status: 'draft' },
            after: { status: 'issued', certificate_code },
            certificate_type: cert.certificate_type,
            order_count: orderIds.length,
          },
          tx,
        });

        return {
          id,
          certificate_code,
          status: 'issued' as const,
          approved_at: now.toISOString(),
          assigned_order_count: orderIds.length,
        };
      },
      { timeout: 30_000 },
    );
  }

  private async hasReadDeletedPerm(role: AuthUser['role']): Promise<boolean> {
    const grant = await this.prisma.rolePermission.findFirst({
      where: { role, permission: { key: 'certificate.read_deleted' } },
      select: { id: true },
    });
    return grant !== null;
  }
}
