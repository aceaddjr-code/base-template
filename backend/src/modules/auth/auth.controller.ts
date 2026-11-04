import { Controller, Post, Get, Patch, Body, UseGuards, Res, Req, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SystemLogService } from '../system/system-log.service';
import type { JwtPayload } from './jwt.strategy';
import { SkipRequestAudit } from '../../common/decorators/skip-request-audit.decorator';
import { AllowDuringPasswordChange } from './decorators/allow-during-password-change.decorator';

@Controller('auth')
@SkipRequestAudit()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly logService: SystemLogService,
    private readonly jwtService: JwtService,
  ) {}

  /** 登录 — JWT 写入 httpOnly Cookie（外层每 IP 每分钟 20 次；账号/IP 联合限流见服务层） */
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    const result = await this.authService.login(dto.loginid, dto.password, req.ip);
    // httpOnly Cookie：JS 不可读，防 XSS 窃取
    res.cookie('access_token', result.token, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: 'lax',
      maxAge: Math.max(0, this.jwtService.decode(result.token).exp * 1000 - Date.now()),
      path: '/',
    });
    // 登录审计（登录成功才记录，失败不记录——防暴力尝试刷日志）
    try {
      await this.logService.write({
        userId: result.user.id,
        username: result.user.username,
        action: 'login',
        entityType: 'auth',
        entityDesc: result.user.displayName || result.user.username,
        ip: req.ip,
      });
    } catch (e) {
      this.logger.warn(`登录审计写入失败: ${e instanceof Error ? e.message : e}`);
    }
    return { user: result.user };
  }

  @Patch('profile')
  async updateMyProfile(@Body() dto: Record<string, unknown>, @Req() req: Request) {
    return this.authService.updateMyProfile(req.user as JwtPayload, dto);
  }

  /** 本人改密，仅从当前登录身份取 ID；不接受请求指定其他账号。待改密白名单端点。 */
  @AllowDuringPasswordChange()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Patch('password')
  async changeMyPassword(@Body() dto: ChangePasswordDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = req.user as JwtPayload;
    const result = await this.authService.changeMyPassword(user, dto, { ip: req.ip });
    res.clearCookie('access_token', { path: '/' });
    return result;
  }

  /** 登出 — 清除 httpOnly Cookie（登出审计，未登录调用也记录 IP） */
  // @Public 绕过 passport → req.user 恒 undefined，需手动验 token 才能记录登出者身份
  @Public()
  @Post('logout')
  async logout(@Res({ passthrough: true }) res: Response, @Req() req: Request) {
    let user = (req as any).user as JwtPayload | undefined;
    const token = (req as any).cookies?.access_token as string | undefined;
    if (!user && token) {
      try {
        user = this.jwtService.verify(token) as JwtPayload;
      } catch {
        user = undefined; // 过期/伪造 token：只清 cookie，不记录身份
      }
    }
    try {
      await this.logService.write({
        userId: user?.sub ?? null,
        username: user?.username ?? null,
        action: 'logout',
        entityType: 'auth',
        ip: req.ip,
      });
    } catch (e) {
      this.logger.warn(`登出审计写入失败: ${e instanceof Error ? e.message : e}`);
    }
    res.clearCookie('access_token', { path: '/' });
    return { message: '已退出登录' };
  }

  /** 获取当前用户信息；待改密受限会话仅返回最小身份与标志（规格 3.3 白名单）。 */
  @AllowDuringPasswordChange()
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@CurrentUser() user: JwtPayload) {
    return this.authService.getProfile(user);
  }

  @Get('codes')
  async getCodes(@CurrentUser() user: JwtPayload) {
    return this.authService.getUserAccessCodes(user);
  }

}
