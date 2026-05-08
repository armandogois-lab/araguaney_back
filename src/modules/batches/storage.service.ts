import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { EnvConfig } from '../../config/env.config';

const BUCKET = 'excel-uploads';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Injectable()
export class StorageService {
  private readonly client: SupabaseClient;

  constructor(config: ConfigService<EnvConfig, true>) {
    const url = config.get('SUPABASE_URL', { infer: true });
    const key = config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true });
    this.client = createClient(url, key, { auth: { persistSession: false } });
  }

  /** Indirection so tests can replace the storage client without faking createClient. */
  protected storageFrom(bucket: string): ReturnType<SupabaseClient['storage']['from']> {
    return this.client.storage.from(bucket);
  }

  /**
   * Uploads an xlsx buffer at the given path inside the `excel-uploads` bucket.
   * Returns the stored path on success; throws on failure.
   */
  async uploadExcel(buffer: Buffer, path: string): Promise<string> {
    const { data, error } = await this.storageFrom(BUCKET).upload(path, buffer, {
      contentType: XLSX_MIME,
      upsert: false,
    });
    if (error || !data) {
      throw new Error(`storage upload failed: ${error?.message ?? 'unknown'}`);
    }
    return path;
  }

  /**
   * Mints a one-time URL the browser can PUT directly to. Bypasses the
   * Vercel/Railway request body to avoid the 4.5 MB Server Action limit
   * for large Cashea exports.
   */
  async createSignedUploadUrl(
    path: string,
  ): Promise<{ signedUrl: string; token: string; path: string }> {
    const { data, error } = await this.storageFrom(BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      throw new Error(`signed upload URL failed: ${error?.message ?? 'unknown'}`);
    }
    return { signedUrl: data.signedUrl, token: data.token, path: data.path };
  }

  /**
   * Reads back a previously uploaded xlsx as a Buffer for parsing/ingestion.
   */
  async downloadExcel(path: string): Promise<Buffer> {
    const { data, error } = await this.storageFrom(BUCKET).download(path);
    if (error || !data) {
      throw new Error(`storage download failed: ${error?.message ?? 'unknown'}`);
    }
    const ab = await data.arrayBuffer();
    return Buffer.from(ab);
  }
}
