import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { ApiErrorResponse } from '../interfaces/api-response.interface';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
};

interface MappedError {
  status: number;
  message: string;
}

/**
 * Translates the Prisma errors a client can legitimately cause into HTTP
 * errors. The database constraint is the real guard against duplicates and
 * dangling references, so these must not surface as a 500. Prisma's own
 * message is never returned — it describes the query.
 */
function mapPrismaError(
  exception: Prisma.PrismaClientKnownRequestError,
): MappedError | null {
  switch (exception.code) {
    case 'P2002': {
      // unique constraint — `meta.target` lists the offending fields
      const target = exception.meta?.target;
      const fields = Array.isArray(target) ? target.join(', ') : null;
      return {
        status: HttpStatus.CONFLICT,
        message: fields
          ? `A record with this ${fields} already exists`
          : 'A record with these values already exists',
      };
    }
    case 'P2025':
      return { status: HttpStatus.NOT_FOUND, message: 'Resource not found' };
    case 'P2003':
      // foreign key constraint
      return {
        status: HttpStatus.CONFLICT,
        message: 'Operation conflicts with a related record',
      };
    default:
      return null;
  }
}

/**
 * Catches every exception and renders the standard error envelope.
 * - HttpExceptions keep their status/message.
 * - class-validator failures (array message) become `errors` + VALIDATION_ERROR.
 * - Prisma constraint errors (P2002 / P2025 / P2003) become 409 / 404 / 409.
 * - Anything else is a 500 with a generic message (details are logged, never leaked).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: ApiErrorResponse['errors'] = null;
    let errorCode = 'INTERNAL_ERROR';

    const prismaError =
      exception instanceof Prisma.PrismaClientKnownRequestError
        ? mapPrismaError(exception)
        : null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else {
        const body = res as { message?: string | string[]; error?: string };
        if (Array.isArray(body.message)) {
          // class-validator: array of constraint messages
          message = 'Validation failed';
          errors = body.message.map((m) => ({ message: m }));
          errorCode = 'VALIDATION_ERROR';
        } else {
          message = body.message ?? exception.message;
        }
      }
      if (errorCode !== 'VALIDATION_ERROR') {
        errorCode = STATUS_CODES[status] ?? 'ERROR';
      }
    } else if (prismaError) {
      status = prismaError.status;
      message = prismaError.message;
      errorCode = STATUS_CODES[status] ?? 'ERROR';
    } else if (exception instanceof Error) {
      // Unexpected error — log full detail, return a safe generic message.
      this.logger.error(exception.message, exception.stack);
    }

    const payload: ApiErrorResponse = {
      success: false,
      statusCode: status,
      message,
      errorCode,
      errors,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
      requestId: request.headers['x-request-id'] as string | undefined,
    };

    response.status(status).json(payload);
  }
}
