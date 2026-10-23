import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { MenuService } from './menu.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateMenuDto } from './dto/create-menu.dto';
import { UpdateMenuDto } from './dto/update-menu.dto';

@Controller('menus')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  /** 菜单树（管理用，含禁用） */
  @Get()
  @Roles('admin')
  async findAll() {
    return this.menuService.findAll();
  }

  /** 启用的菜单树（所有登录用户可访问，用于渲染侧边栏） */
  @Get('tree')
  async findTree() {
    return this.menuService.findTree();
  }

  @Get(':id')
  @Roles('admin')
  async findById(@Param('id') id: string) {
    return this.menuService.findById(parseInt(id, 10));
  }

  @Post()
  @Roles('admin')
  async create(@Body() dto: CreateMenuDto) {
    return this.menuService.create(dto);
  }

  @Put(':id')
  @Roles('admin')
  async update(@Param('id') id: string, @Body() dto: UpdateMenuDto) {
    return this.menuService.update(parseInt(id, 10), dto);
  }

  @Delete(':id')
  @Roles('admin')
  async delete(@Param('id') id: string) {
    return this.menuService.delete(parseInt(id, 10));
  }
}
