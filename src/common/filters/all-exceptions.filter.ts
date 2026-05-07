import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import * as Sentry from '@sentry/node';
import type { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      this.logger.log(
        {
          method: request.method,
          url: request.url,
          status,
          body: typeof body === 'string' ? { message: body } : body,
        },
        'business exception',
      );
      response
        .status(status)
        .json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }

    const err = exception instanceof Error ? exception : new Error(String(exception));
    Sentry.captureException(err);
    this.logger.error(
      {
        method: request.method,
        url: request.url,
        err: { name: err.name, message: err.message, stack: err.stack },
      },
      'unhandled exception',
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Ocurrió un error inesperado',
    });
  }
}
