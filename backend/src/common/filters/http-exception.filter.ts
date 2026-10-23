import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ensureRequestId } from '../utils/request-context';
import { publicFieldErrors, type FieldError } from '../utils/validation-errors';

/**
 * 全局异常过滤器
 * 将所有异常转换为统一响应格式 { code, message, data }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = ensureRequestId(request, response);

    let status: number;
    let message: string;
    let fieldErrors: FieldError[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // HttpException 的响应可能是字符串或对象
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        // 处理 ValidationPipe 的错误（包含 message 数组）
        const resp = exceptionResponse as { message?: string | string[]; fieldErrors?: unknown };
        if (status >= 400 && status < 500) fieldErrors = publicFieldErrors(resp.fieldErrors);
        if (Array.isArray(resp.message)) {
          message = resp.message.join('; ');
        } else {
          message = resp.message ?? exception.message;
        }
      } else {
        message = exception.message;
      }
    } else {
      // 非 HTTP 异常（如代码错误），返回 500
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = '服务器内部错误';
      this.logger.error(
        `服务器内部错误 requestId=${requestId} ${request.method} ${request.path}`,
        exception instanceof Error ? `${exception.name}: ${exception.stack?.split('\n').slice(1).join('\n') ?? ''}` : '',
      );
    }

    response.status(status).json({
      code: status,
      message,
      data: null,
      requestId,
      ...(fieldErrors?.length ? { fieldErrors } : {}),
    });
  }
}
