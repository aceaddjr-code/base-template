import { validateEnvironment } from './environment';

const valid = () => ({ NODE_ENV: 'development', DB_USERNAME: 'test', DB_PASSWORD: '', JWT_SECRET: 'x'.repeat(64) });
describe('启动配置校验', () => {
  it('保留开发默认与最短 3 位密码，生产同步默认关闭', () => {
    expect(validateEnvironment({ ...valid(), ADMIN_DEFAULT_PASSWORD: 'abc' })).toMatchObject({ PORT: 3010, DB_PORT: 3306, DB_SYNCHRONIZE: 'true', COOKIE_SECURE: 'false' });
    expect(validateEnvironment({ ...valid(), NODE_ENV: 'production' }).DB_SYNCHRONIZE).toBe('false');
    expect(validateEnvironment({ ...valid() }).API_DOCS_ENABLED).toBe('true');
    expect(validateEnvironment({ ...valid(), NODE_ENV: 'production' }).API_DOCS_ENABLED).toBe('false');
  });
  it.each([
    ['PORT', '3010oops'], ['DB_PORT', '0'], ['TRUST_PROXY_HOPS', '-1'], ['COOKIE_SECURE', 'yes'],
    ['JWT_EXPIRES_IN', '120'], ['CORS_ORIGIN', '*'], ['CORS_ORIGIN', 'http://host/path'],
    ['CORS_ORIGIN', 'http://host,'], ['BODY_LIMIT', '0mb'], ['ADMIN_DEFAULT_PASSWORD', 'ab'],
    ['BACKUP_TIMEOUT_MS', 'NaN'], ['KEEP_DAYS', '-1'], ['BACKUP_DIR', ''], ['API_DOCS_ENABLED', 'on'],
  ])('%s 非法值在连库前被拒绝', (key, value) => {
    expect(() => validateEnvironment({ ...valid(), [key]: value })).toThrow(key);
  });
  it('拒绝生产同步、示例密钥和缺失数据库身份，不泄露值', () => {
    const bad = { NODE_ENV: 'production', DB_SYNCHRONIZE: 'true', JWT_SECRET: 'private-secret-value', DB_PASSWORD: 'sensitive-db-password' };
    try { validateEnvironment(bad); throw new Error('expected validation'); }
    catch (error) {
      expect((error as Error).message).toContain('DB_USERNAME');
      expect((error as Error).message).toContain('DB_SYNCHRONIZE');
      expect((error as Error).message).not.toContain('private-secret-value');
      expect((error as Error).message).not.toContain('sensitive-db-password');
    }
  });
});
