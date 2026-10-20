import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalExceptionFilter } from './global-exception.filter';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let statusMock: jest.Mock;
  let jsonMock: jest.Mock<void, [unknown]>;

  const hostFor = (): ArgumentsHost => {
    jsonMock = jest.fn<void, [unknown]>();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    return {
      switchToHttp: () => ({
        getResponse: () => ({ status: statusMock }),
        getRequest: () => ({
          originalUrl: '/api/v1/x',
          headers: { 'x-request-id': 'rid-1' },
        }),
      }),
    } as unknown as ArgumentsHost;
  };

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
  });

  it('maps a ConflictException to the error envelope', () => {
    filter.catch(new ConflictException('Email in use'), hostFor());

    expect(statusMock).toHaveBeenCalledWith(409);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: 409,
        message: 'Email in use',
        errorCode: 'CONFLICT',
        errors: null,
        path: '/api/v1/x',
        requestId: 'rid-1',
      }),
    );
  });

  it('turns class-validator array messages into VALIDATION_ERROR + errors[]', () => {
    filter.catch(
      new BadRequestException({
        message: ['email must be an email', 'password too short'],
        error: 'Bad Request',
      }),
      hostFor(),
    );

    const payload = jsonMock.mock.calls[0][0] as {
      errorCode: string;
      errors: Array<{ message: string }>;
    };
    expect(payload.errorCode).toBe('VALIDATION_ERROR');
    expect(payload.errors).toEqual([
      { message: 'email must be an email' },
      { message: 'password too short' },
    ]);
  });

  it('hides details of unexpected (non-HTTP) errors behind a 500', () => {
    filter.catch(new Error('db exploded'), hostFor());

    expect(statusMock).toHaveBeenCalledWith(500);
    const payload = jsonMock.mock.calls[0][0] as {
      message: string;
      errorCode: string;
    };
    expect(payload.message).toBe('Internal server error');
    expect(payload.errorCode).toBe('INTERNAL_ERROR');
  });

  describe('Prisma errors', () => {
    const prismaError = (
      code: string,
      meta?: Record<string, unknown>,
    ): Prisma.PrismaClientKnownRequestError =>
      new Prisma.PrismaClientKnownRequestError('raw query detail', {
        code,
        clientVersion: 'test',
        meta,
      });

    const payloadOf = (): {
      statusCode: number;
      message: string;
      errorCode: string;
    } =>
      jsonMock.mock.calls[0][0] as {
        statusCode: number;
        message: string;
        errorCode: string;
      };

    it('maps P2002 (unique constraint) to 409 naming the field', () => {
      filter.catch(prismaError('P2002', { target: ['code'] }), hostFor());

      expect(statusMock).toHaveBeenCalledWith(409);
      expect(payloadOf()).toMatchObject({
        statusCode: 409,
        errorCode: 'CONFLICT',
        message: 'A record with this code already exists',
      });
    });

    it('maps P2002 without a field list to a generic 409', () => {
      filter.catch(prismaError('P2002'), hostFor());

      expect(payloadOf()).toMatchObject({
        statusCode: 409,
        message: 'A record with these values already exists',
      });
    });

    it('maps P2025 (record not found) to 404', () => {
      filter.catch(prismaError('P2025'), hostFor());

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(payloadOf()).toMatchObject({
        errorCode: 'NOT_FOUND',
        message: 'Resource not found',
      });
    });

    it('maps P2003 (foreign key constraint) to 409', () => {
      filter.catch(prismaError('P2003'), hostFor());

      expect(statusMock).toHaveBeenCalledWith(409);
      expect(payloadOf().errorCode).toBe('CONFLICT');
    });

    it('leaves an unmapped Prisma code as a 500', () => {
      filter.catch(prismaError('P2034'), hostFor());

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(payloadOf()).toMatchObject({
        errorCode: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    });

    it('never returns the raw Prisma message', () => {
      for (const code of ['P2002', 'P2025', 'P2003', 'P2034']) {
        filter.catch(prismaError(code), hostFor());
        expect(payloadOf().message).not.toContain('raw query detail');
      }
    });
  });

  it('maps a generic HttpException status to a code', () => {
    filter.catch(new HttpException('teapot', 418), hostFor());
    const payload = jsonMock.mock.calls[0][0] as { errorCode: string };
    expect(payload.errorCode).toBe('ERROR');
  });
});
