import { SetMetadata } from '@nestjs/common';

export const CRUD_PERM_PREFIX_KEY = 'crudPermPrefix';

/** 标准 CRUD 端点按方法名映射到权限动作；自定义方法使用 @RequirePermission。 */
export const CrudPermPrefix = (prefix: string) => SetMetadata(CRUD_PERM_PREFIX_KEY, prefix);

/** CrudBaseController 方法名 → 权限动作（方法名由基类固定，映射唯一） */
export const CRUD_PERM_ACTION_MAP: Record<string, string> = {
  list: 'view',
  findOne: 'view',
  distinctValues: 'view',
  create: 'create',
  update: 'update',
  remove: 'delete',
  importExcel: 'import',
  exportExcel: 'export',
};

/** 按前缀 + 方法名解析标准端点权限码；非标准端点返回 undefined */
export function resolveCrudPermCode(prefix: string, handlerName: string): string | undefined {
  const action = CRUD_PERM_ACTION_MAP[handlerName];
  return action ? `${prefix}:${action}` : undefined;
}
