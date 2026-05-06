import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { computePricing, computePayouts } from './pricing/pricing';
import { fillPool, type EligibleOrder } from './pool-builder/pool-builder';
import { computePayloadHash } from './payload-hash/payload-hash';
import { isoWeek } from './helpers/iso-week';
import { toSimulationResult } from './responses/simulation-result.mapper';
import { toCertificateSummary, type CertificateSummaryRow } from './responses/certificate-summary.mapper';
import { toCertificateDetail, type CertificateDetailRow } from './responses/certificate-detail.mapper';
import type { CertificateSimulate, CertificateIssue, CertificatesListQuery } from './certificates.dto';

const D = Prisma.Decimal;
const TOP_N = 5;
const MS_PER_DAY = 86_400_000;

@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async simulate(input: CertificateSimulate) {
    const investor = await this.prisma.investor.findUnique({ where: { id: input.investor_id } });
    if (!investor) throw new NotFoundException('Inversor no encontrado');
    if (investor.kind === 'internal') {
      throw new BadRequestException('Inversor interno reservado para certificados sweep');
    }
    if (investor.status !== 'active') {
      throw new BadRequestException('Inversor inactivo');
    }

    const capital = new D(input.capital);
    const rate = new D(input.rate);
    const { price, nominalTarget } = computePricing({ capital, rate, termDays: input.term_days });

    const maturityDate = new Date(input.issue_date);
    maturityDate.setUTCDate(maturityDate.getUTCDate() + input.term_days);

    const eligible = await this.prisma.order.findMany({
      where: { status: 'available', max_due_date: { lte: maturityDate } },
      select: {
        id: true, external_order_id: true, installments_sum: true,
        merchant_id: true, num_installments: true, max_due_date: true,
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
      byMerchantSum.set(o.merchant_id, (byMerchantSum.get(o.merchant_id) ?? new D(0)).plus(o.installments_sum));
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
          pct: nominalActual.isZero() ? new D(0) : amount.div(nominalActual).toDecimalPlaces(6, D.ROUND_HALF_UP),
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
    const payload_hash = computePayloadHash({
      inputs: {
        capital: capital.toFixed(4),
        rate: rate.toFixed(6),
        term_days: input.term_days,
        issue_date: input.issue_date.toISOString().slice(0, 10),
        investor_id: input.investor_id,
      },
      outputs: {
        price: price.toFixed(6),
        nominal_target: nominalTarget.toFixed(4),
        nominal_actual: nominalActual.toFixed(4),
        investor_paid: payouts.investorPaid.toFixed(4),
        investor_returned: payouts.investorReturned.toFixed(4),
        investor_yield: payouts.investorYield.toFixed(4),
        shortfall_pct: payouts.shortfallPct.toFixed(6),
      },
      order_ids: selected.map((o) => o.id),
    });

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
        if (investor.kind === 'internal') {
          throw new BadRequestException('Inversor interno reservado para certificados sweep');
        }
        if (investor.status !== 'active') {
          throw new BadRequestException('Inversor inactivo');
        }

        const capital = new D(input.capital);
        const rate = new D(input.rate);
        const { price, nominalTarget } = computePricing({ capital, rate, termDays: input.term_days });
        const maturityDate = new Date(input.issue_date);
        maturityDate.setUTCDate(maturityDate.getUTCDate() + input.term_days);

        const lockedOrders = await tx.$queryRaw<
          Array<{
            id: string;
            external_order_id: string;
            installments_sum: Prisma.Decimal;
            max_due_date: Date;
            merchant_id: string;
            status: string;
          }>
        >(
          Prisma.sql`SELECT id, external_order_id, installments_sum, max_due_date, merchant_id, status
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

        const recomputedHash = computePayloadHash({
          inputs: {
            capital: capital.toFixed(4),
            rate: rate.toFixed(6),
            term_days: input.term_days,
            issue_date: input.issue_date.toISOString().slice(0, 10),
            investor_id: input.investor_id,
          },
          outputs: {
            price: price.toFixed(6),
            nominal_target: nominalTarget.toFixed(4),
            nominal_actual: nominalActual.toFixed(4),
            investor_paid: payouts.investorPaid.toFixed(4),
            investor_returned: payouts.investorReturned.toFixed(4),
            investor_yield: payouts.investorYield.toFixed(4),
            shortfall_pct: payouts.shortfallPct.toFixed(6),
          },
          order_ids: selected.map((o) => o.id),
        });

        if (recomputedHash !== input.expected_payload_hash) {
          throw new UnprocessableEntityException('Payload mismatch — re-corra /simulate');
        }

        const cycleWeek = isoWeek(input.issue_date);
        const codeRows = await tx.$queryRaw<Array<{ code: string }>>(
          Prisma.sql`SELECT cfb.next_certificate_code() AS code`,
        );
        const certificate_code = codeRows[0]!.code;

        const cert = await tx.certificate.create({
          data: {
            certificate_code,
            certificate_type: 'standard',
            status: 'issued',
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
          data: { status: 'assigned' },
        });

        await tx.certificateEvent.create({
          data: {
            certificate_id: cert.id,
            event_type: 'created',
            payload: {
              certificate_code,
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
          action: 'create',
          actorId,
          payload: {
            certificate_code,
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

        return { id: cert.id, certificate_code };
      },
      { timeout: 30_000 },
    );
  }
  async list(_query: CertificatesListQuery): Promise<unknown> {
    throw new Error('not implemented');
  }
  async detail(_id: string): Promise<unknown> {
    throw new Error('not implemented');
  }
}
