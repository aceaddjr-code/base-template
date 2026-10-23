import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { User } from '../user/user.entity';
import type { UserScopeEntry } from '../../common/utils/data-scope';

export interface JwtPayload {
  sub: number; // 用户 ID
  username: string; // 登录账号
  roleCode: string; // 主角色编码（兼容旧逻辑）
  roles?: string[];
  roleIds?: number[];
  deptId?: number | null; // 用户部门 ID
  dataScopes?: UserScopeEntry[];
  tokenVersion: number; // Token 版本号（用户禁用/删除后递增，旧 Token 自动失效）
}

/** 从 Cookie 或 Authorization Header 中提取 JWT */
function cookieExtractor(req: Request): string | null {
  if (req.cookies?.access_token) {
    return req.cookies.access_token as string;
  }
  return null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET 未配置！请检查 .env 文件');
    }
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    // 校验 Token 版本号：用户被禁用或删除后，tokenVersion 已递增，旧 Token 失效
    const user = await this.userRepo.findOne({
      where: { id: payload.sub },
      select: { id: true, status: true, tokenVersion: true },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    if (user.status !== 1) {
      throw new UnauthorizedException('账号已被禁用');
    }

    if (user.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException('Token 已失效，请重新登录');
    }

    return {
      sub: payload.sub,
      username: payload.username,
      roleCode: payload.roleCode,
      roles: payload.roles,
      roleIds: payload.roleIds,
      deptId: payload.deptId,
      dataScopes: payload.dataScopes,
      tokenVersion: payload.tokenVersion,
    };
  }
}
