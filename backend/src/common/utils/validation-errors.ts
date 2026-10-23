import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
export interface FieldError { path: string; code: string; message: string }

/** 不复制 target/value，避免把密码等提交内容带入错误响应。 */
export function validationException(errors: ValidationError[]) {
  const fields: FieldError[] = [];
  function visit(nodes: ValidationError[], parent = '', depth = 0) {
    if (depth > 10) return;
    for (const error of nodes) {
      if (fields.length >= 100) break;
      const path = parent ? `${parent}.${error.property}` : error.property;
      if (!/^[\w.-]{1,240}$/.test(path)) continue;
      for (const [code, message] of Object.entries(error.constraints ?? {})) {
        if (fields.length >= 100) break;
        fields.push({ path, code, message: String(message).slice(0, 500) });
      }
      visit(error.children ?? [], path, depth + 1);
    }
  }
  visit(errors);
  return new BadRequestException({ message: fields.map(field => field.message).join('; ') || '提交内容校验失败', fieldErrors: fields });
}
export function publicFieldErrors(value: unknown): FieldError[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, 100).filter((item): item is FieldError => item && typeof item.path === 'string' && /^[\w.-]{1,240}$/.test(item.path)
    && typeof item.code === 'string' && /^[\w.-]{1,80}$/.test(item.code) && typeof item.message === 'string')
    .map(item => ({ path: item.path, code: item.code, message: item.message.slice(0, 500) }));
}
