import { createInterface } from 'node:readline/promises';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { UserService } from './modules/user/user.service';

/**
 * 管理员账号恢复命令（账号安全第一批规格 3.2）：仅在受信任服务器本机运行，
 * 不开放任何 HTTP 接口。显式指定已存在的管理员账号，复用用户服务的重置逻辑
 * 与同事务审计；临时密码经交互确认后在本机一次性输出，不放入命令参数。
 *
 * 用法（在 backend 目录或经 pnpm -C backend）：
 *   pnpm -C backend recovery:reset-admin <管理员账号>
 * 恢复后该管理员仍处于待改密状态，首次登录必须修改密码。
 */
async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error('用法：pnpm -C backend recovery:reset-admin <管理员账号>');
    process.exitCode = 2;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const dataSource = app.get(DataSource);
    const [target] = await dataSource.query(
      'SELECT u.id, u.username, u.display_name AS displayName, u.status FROM users u WHERE u.username = ? AND u.deleted_at IS NULL LIMIT 1',
      [username],
    ) as Array<{ id: number; username: string; displayName: string | null; status: number }>;
    if (!target) {
      console.error(`管理员账号不存在：${username}（仅允许指定已存在的管理员）`);
      process.exitCode = 1;
      return;
    }
    const [adminRole] = await dataSource.query(
      `SELECT COUNT(*) AS n FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id AND r.code = 'admin' AND r.deleted_at IS NULL AND r.status = 1
       WHERE ur.user_id = ? AND ur.deleted_at IS NULL`,
      [target.id],
    ) as Array<{ n: number }>;
    const [mainRole] = await dataSource.query(
      `SELECT r.code FROM roles r JOIN users u ON u.role_id = r.id WHERE u.id = ? AND r.deleted_at IS NULL`,
      [target.id],
    ) as Array<{ code: string | null }>;
    if (Number(adminRole?.n ?? 0) === 0 && mainRole?.code !== 'admin') {
      console.error(`账号 ${username} 不是管理员；恢复命令仅面向管理员账号。`);
      process.exitCode = 1;
      return;
    }
    if (Number(target.status) !== 1) {
      console.error(`管理员 ${username} 处于禁用状态，请先由数据库运维启用后再执行恢复。`);
      process.exitCode = 1;
      return;
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `将重置管理员「${target.displayName || target.username}」的密码并使其全部会话失效，确认继续？(y/N) `,
    );
    rl.close();
    if (!['y', 'Y', 'yes', 'YES'].includes(answer.trim())) {
      console.log('已取消，未做任何修改。');
      return;
    }

    const users = app.get(UserService);
    const result = await users.resetPassword(
      target.id,
      { sub: target.id, username: target.username } as never,
      { via: 'recovery-cli', allowSelf: true },
    );
    console.log('\n临时密码（仅本次显示，丢失请重新执行本命令）：');
    console.log(`  ${result.temporaryPassword}`);
    console.log(`有效期至：${result.expiresAt}`);
    console.log('首次登录后必须修改密码；审计已记录 via=recovery-cli。\n');
  } finally {
    await app.close();
  }
}

void main().catch((error) => {
  console.error(`恢复命令执行失败：${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
