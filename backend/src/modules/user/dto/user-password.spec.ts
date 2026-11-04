import { validateSync } from 'class-validator';
import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';
import { ChangePasswordDto } from '../../auth/dto/change-password.dto';

/**
 * 账号安全第一批后契约：创建/编辑不再接受密码入参（非空由服务层拒绝并指向
 * 重置动作，见 user.service.spec）；长度与字节规则只属于本人改密。
 */
describe('用户密码长度校验', () => {
  describe('本人改密（ChangePasswordDto）', () => {
    const dto = (password: string) => Object.assign(new ChangePasswordDto(), {
      oldPassword: 'old', newPassword: password, confirmPassword: password,
    });
    it.each([3, 4, 72])('接受 3 至 72 位新密码（长度 %i）', length => {
      expect(validateSync(dto('x'.repeat(length)))).toEqual([]);
    });
    it.each([0, 1, 2, 73])('拒绝不符合长度要求的新密码（长度 %i）', length => {
      expect(validateSync(dto('x'.repeat(length))).some(error => error.property === 'newPassword')).toBe(true);
    });
    it('多字节密码按 UTF-8 字节计：25 个汉字（75 字节）拒绝，24 个（72 字节）接受', () => {
      expect(validateSync(dto('密'.repeat(25))).some(error => error.property === 'newPassword')).toBe(true);
      expect(validateSync(dto('密'.repeat(24)))).toEqual([]);
    });
  });

  describe('创建/编辑用户', () => {
    it('不提交密码时校验通过', () => {
      expect(validateSync(Object.assign(new CreateUserDto(), { loginid: 'length-test', displayName: '长度测试' }))).toEqual([]);
      expect(validateSync(new UpdateUserDto())).toEqual([]);
    });
    it('提交任意密码值都不再由 DTO 裁决长度（非空一律由服务层拒绝）', () => {
      expect(validateSync(Object.assign(new CreateUserDto(), { loginid: 'a', displayName: '甲', password: 'x'.repeat(73) }))).toEqual([]);
      expect(validateSync(Object.assign(new UpdateUserDto(), { password: 'x' }))).toEqual([]);
    });
  });
});
