import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { validationException, publicFieldErrors } from './validation-errors';
import { CreateUserDto } from '../../modules/user/dto/create-user.dto';
describe('结构化字段错误', () => {
  it('返回稳定路径和规则，不返回提交对象或密码值', () => {
    const dto = plainToInstance(CreateUserDto, { loginid: '用户', displayName: '', password: 'ab', email: 'invalid' });
    const response = validationException(validateSync(dto)).getResponse() as any;
    expect(response.fieldErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'displayName', code: 'isNotEmpty' }),
      expect.objectContaining({ path: 'email', code: 'isEmail' }),
    ]));
    // 密码不再是 DTO 校验项（创建不接受密码入参），也不得在任何错误信息中泄露
    expect(response.fieldErrors.some((field: { path: string }) => field.path === 'password')).toBe(false);
    for (const field of response.fieldErrors) expect(Object.keys(field).sort()).toEqual(['code', 'message', 'path']);
    expect(JSON.stringify(response)).not.toContain('"value"');
    expect(JSON.stringify(response)).not.toContain('"target"');
    expect(JSON.stringify(response)).not.toContain('"ab"');
  });
  it('保留嵌套数组路径，转发剥离额外属性并限制体积', () => {
    const response = validationException([{ property: 'rows', children: [{ property: '0', children: [{ property: 'title', constraints: { isNotEmpty: '请填写标题' } }] }] }]).getResponse() as any;
    expect(response.fieldErrors[0]).toEqual({ path: 'rows.0.title', code: 'isNotEmpty', message: '请填写标题' });
    expect(publicFieldErrors([{ path: 'title', code: 'unique', message: '已存在', target: { password: 'secret' }, value: 'secret' }])).toEqual([{ path: 'title', code: 'unique', message: '已存在' }]);
    expect(publicFieldErrors(Array(200).fill({ path: 'a', code: 'error', message: 'x'.repeat(1000) }))).toHaveLength(100);
    expect(publicFieldErrors([{ path: 'a', code: 'error', message: 'x'.repeat(1000) }])![0].message).toHaveLength(500);
  });
  it('新增用户邮箱可省略；密码字节规则属于本人改密 DTO', () => {
    const user = { loginid: 'a', displayName: '用户' };
    expect(validateSync(plainToInstance(CreateUserDto, user))).toEqual([]);
    expect(validateSync(plainToInstance(CreateUserDto, { ...user, email: 'a@example.com' }))).toEqual([]);
    // 创建/编辑不再接受密码入参：任意值通过 DTO，由服务层统一拒绝
    expect(validateSync(plainToInstance(CreateUserDto, { ...user, password: '密'.repeat(25) }))).toEqual([]);
  });
});
