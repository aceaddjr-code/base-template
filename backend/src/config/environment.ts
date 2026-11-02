/** 只报告配置名，不在启动错误中打印配置值或密钥。 */
export function validateEnvironment(input: Record<string, unknown>) {
  const config = { ...input };
  const errors: string[] = [];
  const value = (key: string, fallback = '') => String(config[key] ?? fallback);
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = value(key, String(fallback));
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min || Number(raw) > max) {
      errors.push(`${key} 必须是 ${min}—${max} 范围内的整数`);
    } else config[key] = Number(raw);
  };
  const bool = (key: string, fallback: string) => {
    const raw = value(key, fallback);
    if (!['true', 'false'].includes(raw)) errors.push(`${key} 必须为 true 或 false`);
    else config[key] = raw;
  };
  const env = value('NODE_ENV', 'production');
  if (!['development', 'test', 'production'].includes(env)) errors.push('NODE_ENV 必须为 development、test 或 production');
  config.NODE_ENV = env;
  for (const key of ['DB_USERNAME', 'DB_DATABASE', 'DB_HOST', 'JWT_SECRET']) {
    const fallback = key === 'DB_HOST' ? 'localhost' : key === 'DB_DATABASE' ? 'app_starter' : '';
    const raw = value(key, fallback);
    if (!raw.trim()) errors.push(`${key} 未配置`);
    config[key] = raw;
  }
  if (input.DB_PASSWORD === undefined) errors.push('DB_PASSWORD 未配置（无密码时需显式配置为空）');
  if (value('JWT_SECRET').length < 32 || /^(replace-with|change-me)/i.test(value('JWT_SECRET'))) errors.push('JWT_SECRET 必须配置为至少 32 字符的独立密钥');
  const expires = value('JWT_EXPIRES_IN', '7d');
  if (!/^[1-9]\d*\s*(ms|s|m|h|d|w|y)$/.test(expires)) errors.push('JWT_EXPIRES_IN 必须为带单位的正时长，例如 7d 或 12h');
  config.JWT_EXPIRES_IN = expires;
  integer('PORT', 3010, 1, 65535);
  integer('DB_PORT', 3306, 1, 65535);
  integer('TRUST_PROXY_HOPS', 0, 0, 32);
  integer('BACKUP_TIMEOUT_MS', 120000, 1000, 3600000);
  integer('KEEP_DAYS', 30, 0, 36500);
  integer('AUDIT_RETENTION_DAYS', 0, 0, 36500);
  bool('COOKIE_SECURE', 'false');
  bool('DB_SYNCHRONIZE', env === 'development' ? 'true' : 'false');
  if (env !== 'development' && config.DB_SYNCHRONIZE === 'true') errors.push('DB_SYNCHRONIZE 仅允许在 development 环境启用');
  bool('API_DOCS_ENABLED', env === 'development' ? 'true' : 'false');
  const origins = value('CORS_ORIGIN', 'http://localhost:5174').split(',').map(item => item.trim());
  if (!origins.length || origins.some(origin => {
    try { const url = new URL(origin); return !['http:', 'https:'].includes(url.protocol) || url.origin !== origin; }
    catch { return true; }
  })) errors.push('CORS_ORIGIN 必须是逗号分隔的 HTTP/HTTPS 来源，不支持通配符、路径或空项');
  config.CORS_ORIGIN = origins.join(',');
  const limit = value('BODY_LIMIT', '1mb');
  if (!/^[1-9]\d*(b|kb|mb)$/i.test(limit)) errors.push('BODY_LIMIT 必须为正整数和 b/kb/mb 单位');
  config.BODY_LIMIT = limit;
  if (input.ADMIN_DEFAULT_PASSWORD !== undefined && (value('ADMIN_DEFAULT_PASSWORD').length < 3 || value('ADMIN_DEFAULT_PASSWORD').length > 72)) errors.push('ADMIN_DEFAULT_PASSWORD 长度必须为 3—72 字符');
  for (const key of ['UPLOAD_DIR', 'BACKUP_DIR', 'BACKUP_SCRIPT', 'BACKUP_EXECUTABLE', 'MYSQLDUMP_BIN', 'ATTACHMENT_PRIVATE_DIR']) {
    if (input[key] !== undefined && (!value(key).trim() || value(key).includes('\0'))) errors.push(`${key} 不能是空路径或包含空字符`);
  }
  if (errors.length) throw new Error(`启动配置校验失败：\n- ${[...new Set(errors)].join('\n- ')}`);
  return config;
}
