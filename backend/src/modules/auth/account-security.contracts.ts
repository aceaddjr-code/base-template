import { createHash } from 'node:crypto';

/**
 * 账号安全闭环（第一批）跨任务共享契约：稳定业务码、临时密码常量、
 * 限流桶键口径和一次性凭据/受限会话的响应类型。
 *
 * 端点实现分布在任务 02（限流）、03（临时密码/门禁）、04（撤销会话）；
 * 本文件只声明类型与纯函数，不注册任何路由。
 */

/**
 * 稳定业务码：走异常响应的 reason 字段（http-exception.filter 透传，
 * 与 409 乐观锁同一通道），前端按码分派、不匹配文案。code 字段保持
 * HTTP 状态数字语义不变。
 */
export const ACCOUNT_SECURITY_REASONS = {
  /** 429 登录限流；响应另带 Retry-After 头（秒）。 */
  LOGIN_RATE_LIMITED: 'LOGIN_RATE_LIMITED',
  /** 403 待改密受限会话访问了白名单之外的受保护接口。 */
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  /** 401 临时密码已到期（登录时或受限会话期间）。 */
  TEMPORARY_PASSWORD_EXPIRED: 'TEMPORARY_PASSWORD_EXPIRED',
} as const;

export type AccountSecurityReason =
  (typeof ACCOUNT_SECURITY_REASONS)[keyof typeof ACCOUNT_SECURITY_REASONS];

/** 临时密码有效期（小时）；种子 admin、新建、重置共用。规格默认 24。 */
export const TEMPORARY_PASSWORD_TTL_HOURS = 24;

/** 临时密码字符集与长度：后端密码学随机源、可复制 ASCII，不含易混淆字符。 */
export const TEMPORARY_PASSWORD_LENGTH = 20;

/**
 * 一次性凭据响应：仅创建/重置成功响应返回一次，界面提供主动复制；
 * 响应头 Cache-Control: no-store，任何日志/列表/详情不落明文。
 */
export interface TemporaryCredential {
  temporaryPassword: string;
  /** ISO UTC 字符串。 */
  expiresAt: string;
}

/** 已存在账号按稳定用户 ID 归并（与登录查询同一等价类，实测排序规则 utf8mb4_unicode_ci）。 */
export function accountBucketKey(userId: number): string {
  return `acct:${userId}`;
}

/**
 * 不存在账号的不可逆键：规范化（NFKC + 小写 + 去首尾空白）后 SHA-256。
 * 只依赖输入本身、不查库即可构造；比数据库排序规则更宽的合并是保守方向
 * （只会多合并、不会拆分逃逸）。不落明文账号。
 */
export function pendingAccountBucketKey(loginid: string): string {
  const normalized = loginid.trim().toLowerCase().normalize('NFKC');
  return `acct:pending:${createHash('sha256').update(normalized, 'utf8').digest('hex')}`;
}

/** IP 维度桶键；req.ip 必须来自可信代理配置（TRUST_PROXY_HOPS）之后。 */
export function ipBucketKey(clientIp: string): string {
  return `ip:${clientIp}`;
}
