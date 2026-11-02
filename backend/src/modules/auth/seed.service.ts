import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../user/user.entity';
import { UserRole } from '../user/user-role.entity';
import { Role } from '../role/role.entity';
import { Menu } from '../menu/menu.entity';
import { Department } from '../department/department.entity';
import { SysDictType } from '../system/entities/sys-dict-type.entity';
import { SysDictItem } from '../system/entities/sys-dict-item.entity';

/**
 * 管理页操作权限声明（docs/管理功能权限码.md）：新库种子、HTTP 边界测试与升级补丁
 * （docs/sql/20261031-management-permissions.sql）共用同一清单；新增管理权限时四处同步。
 */
export const MANAGEMENT_ACTION_SPEC: Record<string, { prefix: string; actions: Array<[string, string]> }> = {
  announcements: { prefix: 'announcements', actions: [['view', '查看'], ['create', '新增'], ['update', '编辑'], ['publish', '发布'], ['withdraw', '撤回'], ['delete', '删除']] },
  dict: { prefix: 'dicts', actions: [['view', '查看'], ['create', '新增'], ['update', '编辑'], ['delete', '删除']] },
  logs: { prefix: 'system-logs', actions: [['view', '查看']] },
  attachments: { prefix: 'attachments', actions: [['view', '查看'], ['upload', '上传'], ['download', '下载'], ['delete', '删除'], ['cleanup', '回收已删除附件文件']] },
};

/** 全部管理操作权限码（16 项）；测试用它交叉核对种子与补丁不漏项 */
export const MANAGEMENT_PERMISSION_CODES: string[] = Object.values(MANAGEMENT_ACTION_SPEC)
  .flatMap(({ prefix, actions }) => actions.map(([action]) => `${prefix}:${action}`));

/** 仅初始化空库；已有账号、菜单、角色和授权由管理界面维护。 */
@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);
  constructor(private readonly dataSource: DataSource, private readonly config: ConfigService) {}

  async onModuleInit() {
    await this.dataSource.transaction(async manager => {
      if (await manager.count(User, { withDeleted: true })) return;
      if (await manager.count(Role, { withDeleted: true }) || await manager.count(Menu, { withDeleted: true })) {
        this.logger.warn('数据库已有系统配置，跳过初始化；请通过备份恢复管理员账号');
        return;
      }
      const password = this.config.get<string>('ADMIN_DEFAULT_PASSWORD');
      if (!password || password.length < 3) throw new Error('首次初始化必须配置至少 3 位的 ADMIN_DEFAULT_PASSWORD');
      await this.initialize(manager, password);
    });
  }

  private async initialize(manager: EntityManager, password: string) {
    const adminRole = await manager.save(Role, { name:'管理员', code:'admin', description:'系统管理', status:1 });
    const userRole = await manager.save(Role, { name:'普通用户', code:'user', description:'默认业务用户', status:1 });
    const dept = await manager.save(Department, { name:'默认部门', code:'default', parentId:null, status:1, sort:1 });
    const admin = await manager.save(User, {
      username:this.config.get<string>('ADMIN_USERNAME', 'admin'),
      password:await bcrypt.hash(password,10), displayName:'系统管理员', roleId:adminRole.id,
      deptId:dept.id, status:1, tokenVersion:1,
    });
    await manager.save(UserRole, { userId:admin.id, roleId:adminRole.id });
    const menus: Menu[] = [];
    const add = async (data: Partial<Menu>) => {
      const menu = await manager.save(Menu, { name:'', parentId:null, path:null, permission:null, icon:null, type:'menu', status:1, sort:0, ...data });
      menus.push(menu);
      return menu;
    };
    const home = await add({ name:'首页', path:'/home', icon:'HomeOutlined', sort:1 });
    const collaboration = await add({ name:'工作协同', path:'/collaboration', icon:'TeamOutlined', sort:2 });
    const examples = await add({ name:'示例业务', path:'/examples', icon:'AppstoreOutlined', sort:10 });
    const items = await add({ name:'示例事项', path:'/examples/items', parentId:examples.id, sort:11 });
    const actions = [['view','查看'],['create','新增'],['update','编辑'],['owner','变更负责人'],['delete','删除'],['import','导入'],['export','导出']];
    const exampleButtons: Menu[] = [];
    for (const [action,name] of actions) exampleButtons.push(await add({ name, type:'button', permission:`example-items:${action}`, parentId:items.id, sort:exampleButtons.length+1 }));
    const system = await add({ name:'系统管理', path:'/system', icon:'SettingOutlined', sort:90 });
    for (const [parent, pages, baseSort] of [
      [collaboration, [['系统公告','announcements'],['我的通知','notifications'],['附件管理','attachments']], 3],
      [system, [['用户管理','users'],['角色管理','roles'],['菜单管理','menus'],['数据字典','dict'],['操作日志','logs'],['数据备份','backups'],['系统参数','settings']], 91],
    ] as Array<[Menu, Array<[string, string]>, number]>) {
      for (const [index,[name,path]] of pages.entries()) {
        const page = await add({ name, path:`/system/${path}`, parentId:parent.id, sort:baseSort+index });
        const spec = MANAGEMENT_ACTION_SPEC[path];
        for (const [sort, [action, label]] of (spec?.actions ?? []).entries()) {
          await add({ name: label, type: 'button', permission: `${spec.prefix}:${action}`, parentId: page.id, sort: sort + 1 });
        }
      }
    }
    for (const [action,name] of [['create','新增部门'],['update','编辑部门'],['delete','删除部门']]) {
      await add({ name, type:'button', permission:`departments:${action}`, parentId:system.id });
    }
    adminRole.menus = menus;
    userRole.menus = [home, examples, items, ...exampleButtons];
    await manager.save(Role, [adminRole,userRole]);
    const logTypes = [['users','用户管理'],['roles','角色管理'],['menus','菜单管理'],['departments','部门'],
      ['system_dicts','数据字典'],['system_backups','数据备份'],['system_logs','操作日志'],
      ['system_notifications','站内通知'],['system_settings','系统参数'],['system_announcements','系统公告'],['attachments','附件管理'],['examples_items','示例事项'],['auth','登录认证'],
      ['common_upload','文件上传'],['monitor_frontend-error','前端上报']];
    const logActions = [['create','新增'],['update','编辑'],['delete','删除'],['import','导入'],['export','导出'],['login','登录'],['logout','登出'],['publish','发布'],['withdraw','撤回']];
    for (const [code,name,items] of [['log_action','日志操作类型',logActions],['log_entity_type','日志模块',logTypes],['notification_type','通知类型',[['system','系统通知']]]] as const) {
      const type = await manager.save(SysDictType, { code,name,status:1 });
      for (const [sort,[value,label]] of items.entries()) await manager.save(SysDictItem, { typeId:type.id, value,label,sort,status:1 });
    }
    // 示例事项类别（F40）：含一个停用项,演示存量停用值的保留与回显
    const categoryType = await manager.save(SysDictType, { code:'item_category', name:'事项类别', status:1 });
    const categoryItems: Array<[number, string, string, number]> = [
      [0, 'cat-a', '类别甲', 1], [1, 'cat-b', '类别乙', 1], [2, 'cat-old', '旧类别', 0],
    ];
    for (const [sort, value, label, status] of categoryItems) {
      await manager.save(SysDictItem, { typeId:categoryType.id, value, label, sort, status });
    }
    this.logger.log('空库初始化完成');
  }
}
