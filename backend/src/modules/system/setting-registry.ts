/**
 * 系统参数注册表：参数键的唯一事实来源。
 * 只有在这里登记的键才能被列表展示和修改；新增参数先改这里（含默认值与说明），
 * 再为已有库执行菜单/字典无关的取值补丁（取值行可由首次修改懒创建，无结构变更）。
 * 数据库密码、JWT 密钥等部署配置不得登记到这里。
 */

export interface SettingDefinition {
  key: string;
  name: string;
  /** string=单行文本 text=多行文本；新类型出现真实需求再扩展 */
  type: 'string' | 'text';
  defaultValue: string;
  /** true=通过 /public 接口下发给所有登录用户 */
  public: boolean;
  maxLength: number;
  /** true=不允许清空（清空后无法回退默认值语义） */
  required?: boolean;
  description: string;
}

export const SETTING_REGISTRY: SettingDefinition[] = [
  {
    key: 'site.name',
    name: '系统名称',
    type: 'string',
    defaultValue: '企业管理系统',
    public: true,
    maxLength: 50,
    required: true,
    description: '登录后顶栏品牌与浏览器标题显示的名称；登录页与部署配置（VITE_APP_NAME）不受影响',
  },
  {
    key: 'help.contact',
    name: '帮助联系方式',
    type: 'text',
    defaultValue: '',
    public: true,
    maxLength: 200,
    description: '账号菜单展示的帮助与问题反馈联系方式，如管理员邮箱或电话；留空则不展示',
  },
];

export function findSettingDefinition(key: string): SettingDefinition | undefined {
  return SETTING_REGISTRY.find((item) => item.key === key);
}
