import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { UserService } from './user.service';
import { UserDataScopeService } from './user-data-scope.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SkipRequestAudit } from '../../common/decorators/skip-request-audit.decorator';
import { PermissionExplanationService } from '../auth/permission-explanation.service';
import { SCOPE_FORM_REGISTRY } from './scope-form.registry';
import { safeParseInt } from '../../common/utils/service-helpers';
import { dateRangeBounds } from '../../common/utils/date-range';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import type { JwtPayload } from '../auth/jwt.strategy';

@Controller('users')
@Roles('admin')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly userDataScopeService: UserDataScopeService,
    private readonly permissionExplain: PermissionExplanationService,
  ) {}

  /**
   * 列表筛选字段登记（F01/F04）：keyword(账号/姓名 LIKE)、deptId(含子部门)、
   * status(0/1 逗号分隔多选)、createdAtFrom/createdAtTo(YYYY-MM-DD，结束日次日零点排他)。
   * 不接收任意列名/表达式；新增筛选项先在这里登记再改 service。
   */
  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('deptId') deptId?: string,
    @Query('status') status?: string,
    @Query('createdAtFrom') createdAtFrom?: string,
    @Query('createdAtTo') createdAtTo?: string,
  ) {
    const p = Math.max(1, safeParseInt(page) ?? 1);
    const ps = Math.min(100, safeParseInt(pageSize) ?? 10);
    const dId = safeParseInt(deptId);
    const statuses = (status ?? '')
      .split(',')
      .map((value) => safeParseInt(value))
      .filter((value): value is number => value === 0 || value === 1);
    const range = createdAtFrom || createdAtTo ? dateRangeBounds(createdAtFrom, createdAtTo) : undefined;
    return this.userService.findAll(p, ps, keyword, dId, statuses, range);
  }

  /** 全量用户简表：登录即可读（@Roles() 覆盖类级 admin 限制）。业务单据的负责人候选与创建人/负责人姓名解析依赖它；仅含启用用户的最小字段。 */
  @Get('simple')
  @Roles()
  async findAllSimple() {
    return this.userService.findAllSimple();
  }

  @Get('scope-forms')
  async listScopeForms() {
    return this.userDataScopeService.listScopeForms();
  }

  /** 根据 ID 查用户 */
  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.userService.findById(parseInt(id, 10));
  }

  /** 新增用户 — 响应携带一次性临时密码，禁止缓存 */
  @Post()
  async create(
    @CurrentUser() caller: JwtPayload,
    @Body() dto: CreateUserDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.userService.create(dto, caller);
  }

  /** 管理员重置密码：生成一次性临时密码并要求目标下次登录改密（users:reset-password） */
  @SkipRequestAudit()
  @RequirePermission('users:reset-password')
  @Post(':id/reset-password')
  async resetPassword(
    @CurrentUser() caller: JwtPayload,
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.userService.resetPassword(parseInt(id, 10), caller, { ip: req.ip });
  }

  /** 退出目标账号全部登录：旧凭据立即失效，可重新登录（users:revoke-sessions） */
  @SkipRequestAudit()
  @RequirePermission('users:revoke-sessions')
  @Post(':id/revoke-sessions')
  async revokeSessions(
    @CurrentUser() caller: JwtPayload,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.userService.revokeSessions(parseInt(id, 10), caller, { ip: req.ip });
  }

  /**
   * 权限效果解释（第二批）：按目标当前配置推演重新登录后的效果。
   * 只读诊断：不签发目标 Token、不改 tokenVersion；审计只记目标/表单/是否查询记录。
   */
  @SkipRequestAudit()
  @RequirePermission('users:permission-explain')
  @Get(':id/permission-explanation')
  async explainPermissions(
    @CurrentUser() caller: JwtPayload,
    @Param('id') id: string,
    @Query('scopeKey') scopeKey: string,
    @Query('recordId') recordId: string | undefined,
    @Req() req: Request,
  ) {
    if (!scopeKey || !SCOPE_FORM_REGISTRY.some((item) => item.scopeKey === scopeKey)) {
      throw new BadRequestException('未知业务表单，请从已注册表单中选择');
    }
    let record: number | null = null;
    if (recordId !== undefined && recordId !== '') {
      record = safeParseInt(recordId) ?? NaN;
      if (!Number.isSafeInteger(record) || record <= 0) throw new BadRequestException('记录 ID 必须是正整数');
    }
    return this.permissionExplain.explain(parseInt(id, 10), scopeKey, record, { sub: caller.sub, username: caller.username }, { ip: req.ip });
  }

  /** 编辑用户 */
  @Put(':id')
  async update(
    @CurrentUser() caller: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.userService.update(parseInt(id, 10), dto, caller);
  }

  /** 启用/禁用 */
  @Patch(':id/status')
  async toggleStatus(@CurrentUser() caller: JwtPayload, @Param('id') id: string) {
    return this.userService.toggleStatus(parseInt(id, 10), caller);
  }

  @Get(':id/data-scopes')
  async getDataScopes(@Param('id') id: string) {
    return this.userDataScopeService.getPanelRows(parseInt(id, 10));
  }

  @Put(':id/data-scopes')
  async saveDataScopes(
    @CurrentUser() caller: JwtPayload,
    @Param('id') id: string,
    @Body() dto: { rows?: unknown },
  ) {
    const userId = parseInt(id, 10);
    return this.userDataScopeService.saveRows(userId, dto?.rows as any, caller?.sub ?? userId);
  }

  /** 删除用户 */
  @Delete(':id')
  async delete(@CurrentUser() caller: JwtPayload, @Param('id') id: string) {
    return this.userService.delete(parseInt(id, 10), caller);
  }
}
