import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { DepartmentService } from './department.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';

@Controller('departments')
export class DepartmentController {
  constructor(private readonly deptService: DepartmentService) {}

  /** 部门树列表；登录用户可读，写操作分别按按钮权限控制。 */
  @Get()
  @Roles()
  async findAll(@Query('keyword') keyword?: string) {
    return this.deptService.findAll(keyword);
  }

  /** 启用部门下拉（所有登录用户可用） */
  @Get('all')
  @Roles()
  async findAllEnabled() {
    return this.deptService.findAllEnabled();
  }

  @Post()
  @RequirePermission('departments:create')
  async create(@Body() dto: any) {
    return this.deptService.create(dto);
  }

  @Put(':id')
  @RequirePermission('departments:update')
  async update(@Param('id') id: string, @Body() dto: any) {
    return this.deptService.update(parseInt(id, 10), dto);
  }

  @Delete(':id')
  @RequirePermission('departments:delete')
  async delete(@Param('id') id: string) {
    return this.deptService.delete(parseInt(id, 10));
  }
}
