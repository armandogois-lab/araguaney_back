import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import type { AuthUser } from '../auth/types';
import { BatchesService } from './batches.service';
import { BatchListQuerySchema, type BatchListQuery } from './dto/batch-list-query.dto';
import { BatchErrorsQuerySchema, type BatchErrorsQuery } from './dto/batch-errors-query.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { toBatchSummary } from './responses/batch-summary.mapper';
import { toImportError } from './responses/import-error.mapper';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_FILE_BYTES = 32 * 1024 * 1024;

@ApiTags('batches')
@ApiBearerAuth()
@Controller('batches')
export class BatchesController {
  constructor(
    private readonly batches: BatchesService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('batch.upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        external_code: { type: 'string', maxLength: 20 },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      // No fileSize limit here — multer would return 413 which we can't intercept cleanly.
      // Manual size check below returns 400 per API contract.
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('external_code') externalCode: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) {
      throw new BadRequestException('Archivo requerido');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new BadRequestException('Archivo excede 32 MB');
    }

    const hasXlsExt = /\.xls$/i.test(file.originalname ?? '');
    const isXlsxMime = file.mimetype === XLSX_MIME;
    const hasXlsxExt = /\.xlsx$/i.test(file.originalname ?? '');

    if (hasXlsExt) {
      throw new BadRequestException('Formato .xls no soportado, usar .xlsx');
    }
    if (!isXlsxMime && !hasXlsxExt) {
      throw new BadRequestException('Tipo de archivo no soportado, se requiere .xlsx');
    }
    if (externalCode !== undefined && !/^[A-Z0-9-]{1,20}$/.test(externalCode)) {
      throw new BadRequestException('external_code inválido');
    }

    return await this.batches.upload({
      fileBuffer: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype || XLSX_MIME,
      actorId: user.id,
      externalCode,
    });
  }

  @Get()
  @RequirePermission('batch.read')
  async list(@Query(new ZodValidationPipe(BatchListQuerySchema)) query: BatchListQuery) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.imported_at = {};
      if (query.from) (where.imported_at as Record<string, Date>).gte = query.from;
      if (query.to) (where.imported_at as Record<string, Date>).lte = query.to;
    }
    if (query.uploaded_by_id) {
      where.excel_uploads = { uploaded_by_id: query.uploaded_by_id };
    }

    const [data, total] = await Promise.all([
      this.prisma.batch.findMany({
        where,
        include: {
          excel_upload: {
            include: { uploaded_by: true },
          },
        },
        orderBy: [{ imported_at: { sort: 'desc', nulls: 'last' } }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.batch.count({ where }),
    ]);

    return {
      data: data.map((b) => toBatchSummary(b as never)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  @Get(':id')
  @RequirePermission('batch.read')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const batch = await this.prisma.batch.findUnique({
      where: { id },
      include: { excel_upload: { include: { uploaded_by: true } } },
    });
    if (!batch) throw new NotFoundException('Batch no encontrado');
    const errors_total = await this.prisma.importError.count({ where: { batch_id: id } });
    return { ...toBatchSummary(batch as never), errors_total };
  }

  @Get(':id/errors')
  @RequirePermission('batch.read')
  async errors(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(BatchErrorsQuerySchema)) query: BatchErrorsQuery,
  ) {
    const batch = await this.prisma.batch.findUnique({ where: { id }, select: { id: true } });
    if (!batch) throw new NotFoundException('Batch no encontrado');
    const where: Record<string, unknown> = { batch_id: id };
    if (query.error_code) where.error_code = query.error_code;
    const [data, total] = await Promise.all([
      this.prisma.importError.findMany({
        where,
        orderBy: [{ row_number: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.importError.count({ where }),
    ]);
    return {
      data: data.map((e) => toImportError(e as never)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }
}
