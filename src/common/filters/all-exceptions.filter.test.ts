import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { AllExceptionsFilter } from './all-exceptions.filter';

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}));

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let logger: { log: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let response: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  let host: ArgumentsHost;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = { log: vi.fn(), error: vi.fn() };
    const jsonMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    response = { status: statusMock, json: jsonMock };
    const request = { method: 'GET', url: '/api/test' };
    host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;
    filter = new AllExceptionsFilter(logger as never);
  });

  it('does NOT report HttpException to Sentry', () => {
    const exc = new BadRequestException('invalid input');
    filter.catch(exc, host);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports non-HTTP Error to Sentry', () => {
    const exc = new Error('database exploded');
    filter.catch(exc, host);
    expect(Sentry.captureException).toHaveBeenCalledWith(exc);
  });

  it('reports non-Error throws (string, etc.) to Sentry', () => {
    filter.catch('something bad', host);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('still returns 500 to client for unhandled exceptions', () => {
    filter.catch(new Error('boom'), host);
    expect(response.status).toHaveBeenCalledWith(500);
  });
});
