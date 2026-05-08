import { describe, it, expect, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';
import type { EnvConfig } from '../../config/env.config';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ storage: { from: vi.fn() } })),
}));

function makeConfig(): ConfigService<EnvConfig, true> {
  return {
    get: (key: string) => {
      switch (key) {
        case 'SUPABASE_URL':
          return 'https://test.supabase.co';
        case 'SUPABASE_SERVICE_ROLE_KEY':
          return 'test-service-key';
        default:
          return undefined;
      }
    },
  } as unknown as ConfigService<EnvConfig, true>;
}

describe('StorageService.uploadExcel', () => {
  it('uploads a buffer to excel-uploads bucket and returns the path', async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'xyz.xlsx' }, error: null });
    const svc = new StorageService(makeConfig());
    (svc as unknown as { storageFrom: (b: string) => { upload: typeof upload } }).storageFrom =
      () => ({ upload });

    const path = await svc.uploadExcel(Buffer.from('contents'), 'abc.xlsx');
    expect(path).toBe('abc.xlsx');
    expect(upload).toHaveBeenCalledWith('abc.xlsx', expect.any(Buffer), {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: false,
    });
  });

  it('throws when upload returns error', async () => {
    const upload = vi.fn().mockResolvedValue({ data: null, error: { message: 'Bucket missing' } });
    const svc = new StorageService(makeConfig());
    (svc as unknown as { storageFrom: (b: string) => { upload: typeof upload } }).storageFrom =
      () => ({ upload });

    await expect(svc.uploadExcel(Buffer.from('x'), 'a.xlsx')).rejects.toThrow(
      /storage upload failed.*Bucket missing/i,
    );
  });

  it('uses configured bucket name', async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'p.xlsx' }, error: null });
    const fromCalls: string[] = [];
    const svc = new StorageService(makeConfig());
    (svc as unknown as { storageFrom: (b: string) => { upload: typeof upload } }).storageFrom = (
      b: string,
    ) => {
      fromCalls.push(b);
      return { upload };
    };
    await svc.uploadExcel(Buffer.from('x'), 'p.xlsx');
    expect(fromCalls).toEqual(['excel-uploads']);
  });
});

describe('StorageService.createSignedUploadUrl', () => {
  it('returns the signed url + token from supabase', async () => {
    const createSignedUploadUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://signed.example/abc', token: 't0k', path: 'abc.xlsx' },
      error: null,
    });
    const svc = new StorageService(makeConfig());
    (
      svc as unknown as {
        storageFrom: (b: string) => { createSignedUploadUrl: typeof createSignedUploadUrl };
      }
    ).storageFrom = () => ({ createSignedUploadUrl });

    const result = await svc.createSignedUploadUrl('abc.xlsx');
    expect(result).toEqual({
      signedUrl: 'https://signed.example/abc',
      token: 't0k',
      path: 'abc.xlsx',
    });
    expect(createSignedUploadUrl).toHaveBeenCalledWith('abc.xlsx');
  });

  it('throws when supabase returns an error', async () => {
    const createSignedUploadUrl = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'denied' } });
    const svc = new StorageService(makeConfig());
    (
      svc as unknown as {
        storageFrom: (b: string) => { createSignedUploadUrl: typeof createSignedUploadUrl };
      }
    ).storageFrom = () => ({ createSignedUploadUrl });
    await expect(svc.createSignedUploadUrl('x.xlsx')).rejects.toThrow(
      /signed upload URL failed.*denied/i,
    );
  });
});

describe('StorageService.downloadExcel', () => {
  it('returns the file as a Buffer', async () => {
    const arrayBuffer = vi.fn().mockResolvedValue(new TextEncoder().encode('hello').buffer);
    const download = vi.fn().mockResolvedValue({ data: { arrayBuffer }, error: null });
    const svc = new StorageService(makeConfig());
    (svc as unknown as { storageFrom: (b: string) => { download: typeof download } }).storageFrom =
      () => ({ download });

    const buf = await svc.downloadExcel('p.xlsx');
    expect(buf.toString()).toBe('hello');
    expect(download).toHaveBeenCalledWith('p.xlsx');
  });

  it('throws when supabase returns an error', async () => {
    const download = vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } });
    const svc = new StorageService(makeConfig());
    (svc as unknown as { storageFrom: (b: string) => { download: typeof download } }).storageFrom =
      () => ({ download });
    await expect(svc.downloadExcel('p.xlsx')).rejects.toThrow(
      /storage download failed.*not found/i,
    );
  });
});
