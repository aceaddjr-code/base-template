import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../user/user.entity';
import type { JwtPayload } from '../auth/jwt.strategy';

/**
 * SSE 会话复核（第五批 03）：与 HTTP 鉴权同一数据源——账号状态、tokenVersion、
 * 第一批待改密门禁。SSE 不是撤销会话的安全保障，HTTP 鉴权仍独立执行；
 * 这里只保证已失效会话的连接被尽快关闭（推送前/心跳前复核）。
 */
@Injectable()
export class SseSessionService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async revalidate(payload: JwtPayload): Promise<{ valid: true } | { valid: false; reason: 'disabled' | 'revoked' | 'must-change-password' }> {
    const user = await this.userRepo.findOne({
      where: { id: payload.sub },
      select: { id: true, status: true, tokenVersion: true, mustChangePassword: true, temporaryPasswordExpiresAt: true },
    });
    if (!user || user.status !== 1) return { valid: false, reason: 'disabled' };
    if (user.tokenVersion !== payload.tokenVersion) return { valid: false, reason: 'revoked' };
    if (Number(user.mustChangePassword) === 1) {
      const expiresAt = user.temporaryPasswordExpiresAt;
      if (!expiresAt || expiresAt.getTime() <= Date.now()) return { valid: false, reason: 'must-change-password' };
    }
    return { valid: true };
  }
}
