#!/usr/bin/env node
// F38 性能基线：对运行中的后端在指定数据规模下测量列表/筛选/详情/导出时延，
// 并留存代表性查询的执行计划与实际索引。只测量，不修改任何功能代码。
//
// 前置：后端已以一次性库启动（development 模式 synchronize 建表 + 种子）。
// 用法：
//   node scripts/perf-baseline.mjs [--scale 10000] [--base http://localhost:3030/api/v1] [--runs 10] [--out <目录>]
// 输出：<out>/perf-api.json 与 <out>/perf-api.md（规模、场景时延、执行计划、索引清单）。
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const scale = Number(option('scale', 10000));
const runs = Math.max(4, Number(option('runs', 10)));
const base = option('base', 'http://localhost:3030/api/v1');
const outDir = option('out', 'docs/performance');
try { process.loadEnvFile(resolve(process.cwd(), 'backend/.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

let cookie = '';
async function api(path, options = {}) {
  const headers = { Cookie: cookie, ...(options.headers || {}) };
  if (options.json !== undefined) { headers['Content-Type'] = 'application/json'; options = { ...options, body: JSON.stringify(options.json) }; }
  const started = performance.now();
  const res = await fetch(base + path, { ...options, headers });
  const elapsed = Math.round(performance.now() - started);
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  let body = null;
  const type = res.headers.get('content-type') || '';
  body = type.includes('json') ? await res.json().catch(() => null) : await res.arrayBuffer();
  return { status: res.status, elapsed, bytes: type.includes('json') ? JSON.stringify(body).length : body.byteLength, body };
}

/** 场景时延：预热 2 次后按 runs 次统计 median/p95/min/max */
async function measure(name, path, options = {}) {
  for (let i = 0; i < 2; i += 1) await api(path, options);
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const { status, elapsed } = await api(path, options);
    if (status !== 200) throw new Error(`场景 ${name} 返回 ${status}`);
    samples.push(elapsed);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const row = { scenario: name, path, runs: samples.length, median: percentile(sorted, 50), p95: percentile(sorted, 95), min: sorted[0], max: sorted[sorted.length - 1] };
  console.log(`  ${name}: median=${row.median}ms p95=${row.p95}ms min=${row.min}ms max=${row.max}ms`);
  return row;
}

async function main() {
  if (!Number.isInteger(scale) || scale < 100) throw new Error('--scale 需为 ≥100 的整数');
  // 守卫：播种会 TRUNCATE example_items。仅允许一次性命名的一次性库；否则必须显式 --allow-truncate 自担风险。
  const database = process.env.DB_DATABASE || 'app_starter';
  const oneOff = /^base_template_(b\d+(_ui)?|test)_\d+$/.test(database);
  if (!oneOff && !args.includes('--allow-truncate')) {
    throw new Error(`DB_DATABASE=${database} 不是一次性测试库命名（base_template_b…/base_template_test_<数字>）。播种会清空其 example_items；请改用一次性库，或确认可清空后加 --allow-truncate。`);
  }
  console.log(`目标库: ${database}（将 TRUNCATE example_items 后播种 ${scale} 行）`);
  const mysql = await import('../backend/node_modules/mysql2/promise.js');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE,
    multipleStatements: false,
  });

  // 1) 数据规模：清空示例表后批量插入（绕过 API，模拟历史存量；created_at/updated_at 分布在近 90 天）
  console.log(`播种 ${scale} 行 example_items …`);
  await connection.query('SET FOREIGN_KEY_CHECKS = 0');
  await connection.query('TRUNCATE TABLE example_items');
  await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  const statuses = ['pending', 'processing', 'done', 'archived'];
  const keywords = ['巡检', '台账', '月度盘点', '工单', '合同评审'];
  const chunk = 500;
  for (let offset = 0; offset < scale; offset += chunk) {
    const values = [];
    const params = [];
    for (let i = offset; i < Math.min(offset + chunk, scale); i += 1) {
      const daysAgo = (i * 97) % 90; // 分散到近 90 天
      const created = new Date(Date.now() - daysAgo * 86400000 - (i % 86400) * 1000);
      const updated = new Date(created.getTime() + (i % 3600) * 1000);
      const status = statuses[i % statuses.length];
      const title = `${keywords[i % keywords.length]}事项 ${String(i + 1).padStart(5, '0')}`;
      const description = i % 7 === 0 ? `长文本说明：${'运维记录片段。'.repeat(12)}` : `说明 ${i + 1}`;
      values.push('(?, ?, ?, ?, 1, 1, ?, ?)');
      params.push(created, updated, title, description, status, i % 5 === 0 ? 'category-a' : null);
    }
    await connection.query(
      `INSERT INTO example_items (created_at, updated_at, title, description, created_by, updated_by, status, category) VALUES ${values.join(',')}`,
      params,
    );
  }

  // 2) 实际索引（以数据库为准，不从实体推断）
  const [indexes] = await connection.query('SHOW INDEX FROM example_items');
  const indexSummary = [...new Set(indexes.map((row) => `${row.Key_name}(${row.Column_name})${row.Non_unique ? '' : ' [unique]'}`))];
  console.log('实际索引:', indexSummary.join(', '));

  // 3) 代表性查询的执行计划（与列表接口的 WHERE/ORDER 组合对应）
  const plans = [];
  const explain = (label, sql) => connection.query(`EXPLAIN ${sql}`).then(([rows]) => {
    plans.push({ label, sql, plan: rows.map((row) => ({ selectType: row.select_type, table: row.table, type: row.type, key: row.key, rows: row.rows, extra: row.Extra })) });
    console.log(`  EXPLAIN ${label}: type=${rows[0]?.type} key=${rows[0]?.key ?? '-'} rows≈${rows[0]?.rows}`);
  });
  console.log('执行计划：');
  await explain('默认列表（按更新时间倒序第一页）', "SELECT * FROM example_items WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 10 OFFSET 0");
  await explain('深分页（第 1000 页）', "SELECT * FROM example_items WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 10 OFFSET 9990");
  await explain('状态筛选', "SELECT * FROM example_items WHERE deleted_at IS NULL AND status = 'pending' ORDER BY updated_at DESC LIMIT 10");
  await explain('关键词模糊匹配', "SELECT * FROM example_items WHERE deleted_at IS NULL AND (title LIKE '%巡检%' OR description LIKE '%巡检%') ORDER BY updated_at DESC LIMIT 10");
  await explain('创建时间区间', "SELECT * FROM example_items WHERE deleted_at IS NULL AND created_at >= '2026-10-01' AND created_at < '2026-10-23' ORDER BY updated_at DESC LIMIT 10");
  await explain('计数', "SELECT COUNT(*) FROM example_items WHERE deleted_at IS NULL");

  // 4) API 时延（登录 → 各场景）
  const login = await api('/auth/login', { method: 'POST', json: { loginid: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_DEFAULT_PASSWORD } });
  if (login.status !== 200 && login.status !== 201) throw new Error('管理员登录失败：' + login.status);
  console.log('API 时延：');
  const scenarios = [];
  scenarios.push(await measure('列表默认第一页', '/examples/items?page=1&pageSize=10'));
  scenarios.push(await measure('深分页第1000页', '/examples/items?page=1000&pageSize=10'));
  scenarios.push(await measure('关键词筛选', '/examples/items?page=1&pageSize=10&keyword=' + encodeURIComponent('巡检')));
  scenarios.push(await measure('状态筛选', '/examples/items?page=1&pageSize=10&status=pending'));
  scenarios.push(await measure('组合筛选+排序', '/examples/items?page=1&pageSize=10&status=pending&createdAtFrom=2026-10-01&createdAtTo=2026-10-23'));
  const detailTarget = scale; // 最后插入行的 id 附近
  scenarios.push(await measure('单条详情', `/examples/items/${detailTarget}`));
  const exportOnce = await api('/examples/items/export?status=pending');
  const exportRow = { scenario: '筛选导出(全量匹配行, 单次)', path: '/examples/items/export', runs: 1, median: exportOnce.elapsed, p95: exportOnce.elapsed, min: exportOnce.elapsed, max: exportOnce.elapsed, bytes: exportOnce.bytes, status: exportOnce.status };
  console.log(`  筛选导出: ${exportOnce.elapsed}ms, ${Math.round(exportOnce.bytes / 1024)}KB`);
  scenarios.push(exportRow);

  const report = {
    generatedAt: new Date().toISOString(),
    base, scale, runs,
    environment: { node: process.version, database: process.env.DB_DATABASE, note: '本机隔离库；网络为 localhost 回环' },
    indexes: indexSummary,
    scenarios,
    plans,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'perf-api.json'), JSON.stringify(report, null, 2));
  const markdown = [
    `# API 性能基线（${new Date().toLocaleDateString('zh-CN')}）`,
    '',
    `- 数据规模：example_items ${scale} 行；每场景预热 2 次后测 ${runs} 次（导出单次）。环境：${process.version}，localhost。`,
    `- 实际索引：${indexSummary.join('、')}`,
    '',
    '| 场景 | median | p95 | min | max |',
    '|---|---|---|---|---|',
    ...scenarios.map((row) => `| ${row.scenario} | ${row.median}ms | ${row.p95}ms | ${row.min}ms | ${row.max}ms |`),
    '',
    '## 执行计划摘要',
    '',
    ...plans.map((plan) => `- ${plan.label}: type=${plan.plan[0]?.type} key=${plan.plan[0]?.key ?? '-'} rows≈${plan.plan[0]?.rows} ${plan.plan[0]?.extra ? `(${plan.plan[0].extra})` : ''}`),
  ].join('\n');
  writeFileSync(resolve(outDir, 'perf-api.md'), markdown);
  console.log(`\n已写入 ${resolve(outDir, 'perf-api.json')} 与 perf-api.md`);
  await connection.end();
}

main().catch((error) => { console.error('PERF-BASELINE-ERROR', error.message); process.exitCode = 1; });
