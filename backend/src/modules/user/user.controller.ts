import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { UserService } from './user.service';
import { UserDataScopeService } from './user-data-scope.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
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

  @Get('simple')
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

  /** 新增用户 */
  @Post()
  async create(@CurrentUser() caller: JwtPayload, @Body() dto: CreateUserDto) {
    return this.userService.create(dto, caller);
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
    return this.userDataScopeService.saveRows(userId, (dto?.rows ?? []) as any, caller?.sub ?? userId);
  }

  /** 删除用户 */
  @Delete(':id')
  async delete(@CurrentUser() caller: JwtPayload, @Param('id') id: string) {
    return this.userService.delete(parseInt(id, 10), caller);
  }
}
