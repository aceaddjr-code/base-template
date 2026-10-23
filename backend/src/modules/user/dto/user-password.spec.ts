import { validateSync } from 'class-validator';
import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';

describe('用户密码长度校验', () => {
  describe.each([
    ['新增', (password: string) => Object.assign(new CreateUserDto(), { loginid: 'length-test', displayName: '长度测试', password })],
    ['重设', (password: string) => Object.assign(new UpdateUserDto(), { password })],
  ] as const)('%s', (_name, dto) => {
    it.each([3, 4, 72])('接受 3 至 72 位密码（长度 %i）', length => {
      expect(validateSync(dto('x'.repeat(length)))).toEqual([]);
    });

    it.each([0, 1, 2, 73])('拒绝不符合长度要求的密码（长度 %i）', length => {
      expect(validateSync(dto('x'.repeat(length))).some(error => error.property === 'password')).toBe(true);
    });
  });

  it('不提交重设密码时允许保留原密码', () => {
    expect(validateSync(new UpdateUserDto())).toEqual([]);
  });
});
