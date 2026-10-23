import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { RoleService } from './role.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AssignMenusDto } from './dto/assign-menus.dto';
import type { JwtPayload } from '../auth/jwt.strategy';

@Controller('roles')
@Roles('admin')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize || '10', 10) || 10));
    return this.roleService.findAll(p, ps);
  }

  @Get('all')
  async findAllEnabled(@CurrentUser() caller: JwtPayload) {
    return this.roleService.findAllEnabled();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.roleService.findById(parseInt(id, 10));
  }

  @Get(':id/menus')
  async getMenuIds(@Param('id') id: string) {
    return this.roleService.getMenuIds(parseInt(id, 10));
  }

  @Post()
  async create(@Body() dto: CreateRoleDto) {
    return this.roleService.create(dto);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.roleService.update(parseInt(id, 10), dto);
  }

  @Post(':id/menus')
  async assignMenus(@Param('id') id: string, @Body() dto: AssignMenusDto) {
    return this.roleService.assignMenus(parseInt(id, 10), dto.menuIds);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.roleService.delete(parseInt(id, 10));
  }
}
