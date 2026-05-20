import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { computePricing } from '../certificates/pricing/pricing';
import { computePayloadHash, buildHashPayload } from '../certificates/payload-hash/payload-hash';
import { isoWeek } from '../certificates/helpers/iso-week';
import { toSweepSimulationResult } from './responses/sweep-simulation-result.mapper';
import type { SweepSimulate, SweepIssue } from './sweep.dto';

const D = Prisma.Decimal;
const TOP_N = 5;
const MS_PER_DAY = 86_400_000;
const FRIDAY_DAY_NUM = 5;

type EligibleSweepOrder = {
  id: string;
  external_order_id: string;
  installments_sum: Prisma.Decimal;
  merchant_id: string;
  num_installments: number;
  max_due_date: Date;
  purchase_date: Date;
};

@Injectable()
export class SweepService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async simulateSweep(input: SweepSimulate) {
    const investor = await this.prisma.investor.findFirst({ where: { kind: 'internal' } });
    if (!investor) throw new BadRequestException('Inversor interno no configurado');
    if (investor.status !== 'active') {
      throw new BadRequestException('Inversor interno inactivo');
    }

    const settings = await this.prisma.setting.findUnique({ where: { id: 1 } });
    if (!settings) throw new BadRequestException('Configuración del sistema no encontrada');

    const rateSource: 'settings_default' | 'override' =
      input.rate === undefined ? 'settings_default' : 'override';
    const rate = input.rate === undefined ? new D(settings.default_sweep_rate) : new D(input.rate);

    const maturityDate = new Date(input.issue_date);
    maturityDate.setUTCDate(maturityDate.getUTCDate() + input.term_days);

    const eligible = (await this.prisma.order.findMany({
      where: { status: 'available', max_due_date: { lte: maturityDate } },
      select: {
        id: true,
        external_order_id: true,
        installments_sum: true,
        merchant_id: true,
        num_installments: true,
        max_due_date: true,
        purchase_date: true,
      },
    })) as EligibleSweepOrder[];

    if (eligible.length === 0) {
      throw new UnprocessableEntityException('No hay stock disponible para barrido');
    }

    const selected = [...eligible].sort((a, b) => {
      const cmp = b.installments_sum.comparedTo(a.installments_sum);
      return cmp !== 0 ? cmp : a.external_order_id.localeCompare(b.external_order_id);
    });

    const nominalActual = selected.reduce((acc, o) => acc.plus(o.installments_sum), new D(0));

    // Reuse computePricing for `price`; nominalTarget is discarded (sweep sets target = actual).
    const { price } = computePricing({
      capital: nominalActual,
      rate,
      termDays: input.term_days,
    });

    const investorCapital = nominalActual.mul(price).toDecimalPlaces(4, D.ROUND_HALF_UP);
    const nominalTarget = nominalActual; // sweep invariant
    const investorPaid = investorCapital;
    const investorReturned = new D(0);
    const investorYield = nominalActual.minus(investorCapital);
    const shortfallPct = new D(0);

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

    // Due-date distribution
    const installments = await this.prisma.installment.findMany({
      where: { order_id: { in: selected.map((o) => o.id) } },
      select: { order_id: true, amount: true, due_date: true },
    });
    const byDate = new Map<string, Prisma.Decimal>();
    for (const i of installments) {
      const k = i.due_date.toISOString().slice(0, 10);
      byDate.set(k, (byDate.get(k) ?? new D(0)).plus(i.amount));
    }
    const dueDateDistribution = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, amount]) => ({ date: new Date(`${k}T00:00:00Z`), amount }));

    const payloadHash = computePayloadHash(
      buildHashPayload({
        capital: investorCapital,
        rate,
        termDays: input.term_days,
        issueDate: input.issue_date,
        investorId: investor.id,
        price,
        nominalTarget,
        nominalActual,
        payouts: { investorPaid, investorReturned, investorYield, shortfallPct },
        selectedOrderIds: selected.map((o) => o.id),
      }),
    );

    const warnings: string[] = [];
    if (input.issue_date.getUTCDay() !== FRIDAY_DAY_NUM) warnings.push('not_friday');

    return toSweepSimulationResult({
      investor: { id: investor.id, legal_name: investor.legal_name, rif: investor.rif },
      rate,
      rate_source: rateSource,
      term_days: input.term_days,
      issue_date: input.issue_date,
      maturity_date: maturityDate,
      cycle_week: isoWeek(input.issue_date),
      price,
      nominal_actual: nominalActual,
      investor_capital: investorCapital,
      investor_paid: investorPaid,
      investor_returned: investorReturned,
      investor_yield: investorYield,
      shortfall_pct: shortfallPct,
      selected_orders: selected.map((s) => ({
        id: s.id,
        installments_sum: s.installments_sum,
        merchant_id: s.merchant_id,
        num_installments: s.num_installments,
        max_due_date: s.max_due_date,
      })),
      installment_plazo_days: { min: minPlazo, max: maxPlazo },
      concentration_top: concentrationTop,
      total_distinct_merchants: new Set(selected.map((o) => o.merchant_id)).size,
      due_date_distribution: dueDateDistribution,
      payload_hash: payloadHash,
      warnings,
    });
  }

  async issueSweep(input: SweepIssue, actorId: string) {
    return await this.prisma.$transaction(
      async (tx) => {
        const investor = await tx.investor.findFirst({ where: { kind: 'internal' } });
        if (!investor) throw new BadRequestException('Inversor interno no configurado');
        if (investor.status !== 'active') {
          throw new BadRequestException('Inversor interno inactivo');
        }

        const settings = await tx.setting.findUnique({ where: { id: 1 } });
        if (!settings) throw new BadRequestException('Configuración del sistema no encontrada');

        const rate =
          input.rate === undefined ? new D(settings.default_sweep_rate) : new D(input.rate);

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

        // Defense-in-depth: compare locked claim vs current eligible set.
        const eligibleNow = (await tx.order.findMany({
          where: { status: 'available', max_due_date: { lte: maturityDate } },
          select: {
            id: true,
            external_order_id: true,
            installments_sum: true,
            merchant_id: true,
            num_installments: true,
            max_due_date: true,
            purchase_date: true,
          },
        })) as EligibleSweepOrder[];

        const eligibleIds = new Set(eligibleNow.map((o) => o.id));
        const claimedIds = new Set(input.order_ids);
        if (
          eligibleIds.size !== claimedIds.size ||
          ![...eligibleIds].every((id) => claimedIds.has(id))
        ) {
          throw new UnprocessableEntityException(
            'Pool inválido — el conjunto elegible cambió. Re-corra /simulate',
          );
        }

        // Deterministic sort matching simulate
        const selected = [...eligibleNow].sort((a, b) => {
          const cmp = b.installments_sum.comparedTo(a.installments_sum);
          return cmp !== 0 ? cmp : a.external_order_id.localeCompare(b.external_order_id);
        });

        const nominalActual = selected.reduce((acc, o) => acc.plus(o.installments_sum), new D(0));
        const { price } = computePricing({
          capital: nominalActual,
          rate,
          termDays: input.term_days,
        });
        const investorCapital = nominalActual.mul(price).toDecimalPlaces(4, D.ROUND_HALF_UP);
        const nominalTarget = nominalActual;
        const investorPaid = investorCapital;
        const investorReturned = new D(0);
        const investorYield = nominalActual.minus(investorCapital);
        const shortfallPct = new D(0);

        const recomputedHash = computePayloadHash(
          buildHashPayload({
            capital: investorCapital,
            rate,
            termDays: input.term_days,
            issueDate: input.issue_date,
            investorId: investor.id,
            price,
            nominalTarget,
            nominalActual,
            payouts: { investorPaid, investorReturned, investorYield, shortfallPct },
            selectedOrderIds: selected.map((o) => o.id),
          }),
        );

        if (recomputedHash !== input.expected_payload_hash) {
          throw new UnprocessableEntityException('Payload mismatch — re-corra /simulate');
        }

        const cycleWeek = isoWeek(input.issue_date);

        try {
          const cert = await tx.certificate.create({
            data: {
              certificate_code: null,
              certificate_type: 'sweep',
              status: 'draft',
              investor_id: investor.id,
              investor_capital: investorCapital,
              annual_rate: rate,
              rate_basis: 'ACT/360',
              term_days: input.term_days,
              price,
              nominal_target: nominalTarget,
              nominal_actual: nominalActual,
              investor_paid: investorPaid,
              investor_returned: investorReturned,
              investor_yield: investorYield,
              shortfall_pct: shortfallPct,
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
                certificate_type: 'sweep',
                cycle_week: cycleWeek,
                order_count: selected.length,
                nominal_actual: nominalActual.toFixed(4),
                investor_capital: investorCapital.toFixed(4),
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
              certificate_type: 'sweep',
              cycle_week: cycleWeek,
              inputs: {
                rate: rate.toFixed(6),
                term_days: input.term_days,
                issue_date: input.issue_date.toISOString().slice(0, 10),
                investor_id: investor.id,
              },
              order_count: selected.length,
              payload_hash: recomputedHash,
            },
            tx,
          });

          return { id: cert.id, status: 'draft' as const };
        } catch (e) {
          if (
            e instanceof Prisma.PrismaClientKnownRequestError &&
            e.code === 'P2002' &&
            Array.isArray(e.meta?.target) &&
            (e.meta.target as string[]).includes('cycle_week')
          ) {
            throw new ConflictException({
              message: 'Ya existe un sweep para esta semana',
              cycle_week: cycleWeek,
            });
          }
          throw e;
        }
      },
      { timeout: 30_000 },
    );
  }
}
