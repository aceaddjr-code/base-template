import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';

jest.mock('bcryptjs');
describe('本人自助改密', () => {
  const actor = { sub: 7, tokenVersion: 5 } as any;
  function setup() {
    const query: any = { update: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), execute: jest.fn().mockResolvedValue({ affected: 1 }) };
    const users: any = {
      findOne: jest.fn().mockResolvedValue({ id: 7, status: 1, password: 'stored-hash', tokenVersion: 5 }),
      createQueryBuilder: jest.fn(() => query),
      manager: { transaction: jest.fn(async (fn: any) => fn({ createQueryBuilder: () => query })) },
    };
    const logService = { write: jest.fn(), writeInTransaction: jest.fn(async () => undefined) };
    const service = new AuthService({} as any, users, {} as any, {} as any, {} as any, {} as any, {} as any, logService as any);
    return { service, users, query, logService };
  }
  const dto = { oldPassword: 'old', newPassword: 'abc', confirmPassword: 'abc' };
  beforeEach(() => {
    jest.resetAllMocks();
    (bcrypt.compare as jest.Mock).mockImplementation(async value => value === 'old');
    (bcrypt.hash as jest.Mock).mockResolvedValue('new-bcrypt-hash');
  });
  it('三位新密码可提交；密码、待改密状态、临时密码到期与会话版本在同一事务内保存，审计同事务', async () => {
    const { service, users, query, logService } = setup();
    await expect(service.changeMyPassword(actor, dto, { ip: '127.0.0.1' })).resolves.toEqual({ message: '密码已修改，请重新登录' });
    expect(users.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7, status: 1 } }));
    expect(query.where).toHaveBeenCalledWith('id = :id AND password = :hash AND token_version = :version AND status = 1', {
      id: 7, hash: 'stored-hash', version: 5,
    });
    const patch = query.set.mock.calls[0][0];
    expect(patch.password).toBe('new-bcrypt-hash');
    expect(patch.tokenVersion()).toBe('token_version + 1');
    expect(patch.mustChangePassword).toBe(0);
    expect(patch.temporaryPasswordExpiresAt).toBeNull();
    expect(logService.writeInTransaction).toHaveBeenCalledTimes(1);
    expect(logService.writeInTransaction.mock.calls[0][1]).toMatchObject({ userId: 7, ip: '127.0.0.1' });
    expect(bcrypt.hash).toHaveBeenCalledWith('abc', 10);
  });
  it('错误原密码、重复新密码与并发变化均不误报成功', async () => {
    const { service, query } = setup();
    await expect(service.changeMyPassword(actor, { ...dto, oldPassword: 'wrong' })).rejects.toThrow('原密码不正确');
    expect(query.execute).not.toHaveBeenCalled();
    await expect(service.changeMyPassword(actor, { ...dto, newPassword: 'old', confirmPassword: 'old' })).rejects.toThrow('不能与原密码相同');
    query.execute.mockResolvedValueOnce({ affected: 0 });
    await expect(service.changeMyPassword(actor, dto)).rejects.toThrow('账号信息已变化');
  });
  it('旧会话和已停用账号不能改密；不接受客户端指定目标用户', async () => {
    const { service, users, query } = setup();
    await expect(service.changeMyPassword({ ...actor, tokenVersion: 4 }, dto)).rejects.toThrow('登录状态已变化');
    users.findOne.mockResolvedValueOnce(null);
    await expect(service.changeMyPassword(actor, dto)).rejects.toThrow('账号不可用');
    expect(query.execute).not.toHaveBeenCalled();
    const errors = await validate(plainToInstance(ChangePasswordDto, { ...dto, userId: 99 }), { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.some(error => error.property === 'userId')).toBe(true);
  });
  it('确认不一致、少于3位及超过72字节的新密码被拒绝', async () => {
    const { service, users } = setup();
    await expect(service.changeMyPassword(actor, { ...dto, confirmPassword: 'xyz' })).rejects.toThrow('两次新密码不一致');
    await expect(service.changeMyPassword(actor, { ...dto, newPassword: '汉'.repeat(25), confirmPassword: '汉'.repeat(25) })).rejects.toThrow('72 字节');
    const errors = await validate(plainToInstance(ChangePasswordDto, { ...dto, newPassword: 'ab', confirmPassword: 'ab' }));
    expect(errors.some(error => error.property === 'newPassword')).toBe(true);
    expect(users.findOne).not.toHaveBeenCalled();
  });
});
