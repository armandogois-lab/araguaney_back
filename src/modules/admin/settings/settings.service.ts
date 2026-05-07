import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { toSettings, type SettingsRow } from './responses/settings.mapper';
import type { SettingsUpdate } from './settings.dto';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get() {
    const row = await this.prisma.setting.findUnique({
      where: { id: 1 },
      include: { updated_by: true },
    });
    if (!row) throw new NotFoundException('Configuración del sistema no encontrada');
    return toSettings(row as unknown as SettingsRow);
  }

  async update(input: SettingsUpdate, actorId: string) {
    return await this.prisma.$transaction(async (tx) => {
      const existing = await tx.setting.findUnique({
        where: { id: 1 },
        include: { updated_by: true },
      });
      if (!existing) throw new NotFoundException('Configuración del sistema no encontrada');

      const editableFields: Array<keyof SettingsUpdate> = [
        'default_sweep_rate',
        'shortfall_warning_threshold',
        'concentration_warning_threshold',
      ];

      const changed: Record<string, { from: string; to: string }> = {};
      const data: Prisma.SettingUncheckedUpdateInput = {};
      for (const k of editableFields) {
        if (!(k in input)) continue;
        const next = new Prisma.Decimal(input[k] as number);
        const prev = (existing as Record<string, unknown>)[k] as Prisma.Decimal;
        if (!prev.equals(next)) {
          changed[k] = { from: prev.toFixed(6), to: next.toFixed(6) };
          (data as Record<string, unknown>)[k] = next;
        }
      }

      if (Object.keys(changed).length === 0) {
        return toSettings(existing as unknown as SettingsRow);
      }

      const updated = await tx.setting.update({
        where: { id: 1 },
        data: {
          ...data,
          updated_at: new Date(),
          updated_by_id: actorId,
        },
        include: { updated_by: true },
      });

      await this.audit.recordChange({
        entityType: 'setting',
        entityId: '1',
        action: 'update',
        actorId,
        payload: { changed },
        tx,
      });

      return toSettings(updated as unknown as SettingsRow);
    });
  }
}
