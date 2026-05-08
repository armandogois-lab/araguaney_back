import { ConflictException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { IngestionService } from './ingestion.service';
import { StorageService } from './storage.service';
import { generateExternalCode } from './external-code-generator';

export type UploadInput = {
  fileBuffer: Buffer;
  filename: string;
  mimeType: string;
  actorId: string;
  externalCode: string | undefined;
};

export type UploadResponse = {
  batch_id: string;
  external_code: string;
  excel_upload_id: string;
  status: 'imported' | 'rejected';
  rows_imported: number;
  rows_rejected: number;
  total_orders_amount: string;
  total_installments_amount: string;
  imported_at: string | null;
  rejection_reason: string | null;
  decimal_separator_detected: 'dot' | 'comma' | null;
  errors_preview: Array<{
    sheet_name: string;
    row_number: number;
    field_name: string | null;
    error_code: string;
    error_message: string;
  }>;
  errors_total: number;
};

@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: IngestionService,
    private readonly storage: StorageService,
  ) {}

  async upload(input: UploadInput): Promise<UploadResponse> {
    const storagePath = `${randomUUID()}.xlsx`;
    await this.storage.uploadExcel(input.fileBuffer, storagePath);
    return this.persistAndIngest({
      fileBuffer: input.fileBuffer,
      filename: input.filename,
      mimeType: input.mimeType,
      actorId: input.actorId,
      externalCode: input.externalCode,
      storagePath,
    });
  }

  /**
   * Mints a signed URL the browser can PUT directly to. Sidesteps the 4.5 MB
   * body cap on Vercel Server Actions / Railway request body. The browser
   * later calls processFromStorage with the same storage_path.
   */
  async createUploadSlot(): Promise<{
    storage_path: string;
    signed_upload_url: string;
    signed_upload_token: string;
  }> {
    const storagePath = `${randomUUID()}.xlsx`;
    const { signedUrl, token } = await this.storage.createSignedUploadUrl(storagePath);
    return {
      storage_path: storagePath,
      signed_upload_url: signedUrl,
      signed_upload_token: token,
    };
  }

  /**
   * Picks up where createUploadSlot left off: fetch the bytes the browser put
   * into Storage, then run the same dedup + persist + ingest pipeline as the
   * legacy multipart path.
   */
  async processFromStorage(input: {
    storagePath: string;
    filename: string;
    actorId: string;
    externalCode: string | undefined;
  }): Promise<UploadResponse> {
    const fileBuffer = await this.storage.downloadExcel(input.storagePath);
    return this.persistAndIngest({
      fileBuffer,
      filename: input.filename,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      actorId: input.actorId,
      externalCode: input.externalCode,
      storagePath: input.storagePath,
    });
  }

  private async persistAndIngest(input: {
    fileBuffer: Buffer;
    filename: string;
    mimeType: string;
    actorId: string;
    externalCode: string | undefined;
    storagePath: string;
  }): Promise<UploadResponse> {
    const contentHash = createHash('sha256').update(input.fileBuffer).digest('hex');

    const existing = await this.prisma.excelUpload.findFirst({
      where: { content_hash: contentHash },
      include: { batch: true },
    });
    if (existing) {
      throw new ConflictException({
        message: 'Archivo ya fue subido',
        existing_batch_id: existing.batch?.id ?? null,
        existing_excel_upload_id: existing.id,
      });
    }

    const upload = await this.prisma.excelUpload.create({
      data: {
        filename: input.filename,
        storage_path: input.storagePath,
        storage_bucket: 'excel-uploads',
        content_hash: contentHash,
        file_size_bytes: BigInt(input.fileBuffer.byteLength),
        mime_type: input.mimeType,
        uploaded_by_id: input.actorId,
      },
    });

    const externalCode = input.externalCode ?? generateExternalCode();

    const batch = await this.prisma.batch.create({
      data: {
        external_code: externalCode,
        excel_upload_id: upload.id,
        status: 'uploaded',
      },
    });

    const ingestionResult = await this.ingestion.parseAndImport({
      batchId: batch.id,
      fileBuffer: input.fileBuffer,
      actorId: input.actorId,
    });

    return {
      batch_id: batch.id,
      external_code: externalCode,
      excel_upload_id: upload.id,
      status: ingestionResult.status,
      rows_imported: ingestionResult.rowsImported,
      rows_rejected: ingestionResult.rowsRejected,
      total_orders_amount: ingestionResult.totalOrdersAmount,
      total_installments_amount: ingestionResult.totalInstallmentsAmount,
      imported_at: new Date().toISOString(),
      rejection_reason: ingestionResult.rejectionReason,
      decimal_separator_detected: ingestionResult.decimalSeparatorDetected,
      errors_preview: ingestionResult.errorsPreview.map((e) => ({
        sheet_name: e.sheetName,
        row_number: e.rowNumber,
        field_name: e.fieldName,
        error_code: e.errorCode,
        error_message: e.errorMessage,
      })),
      errors_total: ingestionResult.errorsTotal,
    };
  }
}
