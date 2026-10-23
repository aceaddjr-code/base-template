#!/usr/bin/env node
// F29 OpenAPI 契约检查：拉取运行中后端的 /api/docs-json，校验本项目的接口约定。
// 用法：OPENAPI_URL=http://localhost:3010 node scripts/check-openapi.mjs
// 前置：后端以 API_DOCS_ENABLED=true 启动（development 默认开启）。生产默认关闭，不暴露文档。
const OPENAPI_URL = process.env.OPENAPI_URL || 'http://localhost:3010/api/docs-json';

/** 契约要点：与 app.setup.ts 的文档声明和统一响应/错误/分页约定保持一致。 */
const REQUIRED_PATHS = [
  '/api/v1/auth/login',
  '/api/v1/auth/profile',
  '/api/v1/examples/items',
];
const REQUIRED_SCHEMA_HINTS = ['LoginDto', 'CreateExampleDto'];

const results = { url: OPENAPI_URL, checks: [], startedAt: new Date().toISOString() };
function check(name, ok, detail) {
  results.checks.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
}

async function main() {
  const res = await fetch(OPENAPI_URL);
  check('docs-json-200', res.status === 200, res.status);
  if (res.status !== 200) throw new Error('无法获取接口描述，确认后端以 API_DOCS_ENABLED=true 启动');
  const doc = await res.json();

  check('openapi-3', typeof doc.openapi === 'string' && doc.openapi.startsWith('3.'), doc.openapi);
  check('info-version', !!doc.info?.version, doc.info?.version);
  check('conventions-documented', typeof doc.info?.description === 'string'
    && doc.info.description.includes('统一包装')
    && doc.info.description.includes('fieldErrors')
    && doc.info.description.includes('page'), '响应/错误/分页约定已声明');
  const schemes = Object.values(doc.components?.securitySchemes || {});
  check('cookie-auth-scheme', schemes.some((scheme) => scheme.type === 'apiKey' && scheme.in === 'cookie' && scheme.name === 'access_token'), doc.components?.securitySchemes);
  check('paths-use-global-prefix', Object.keys(doc.paths).length > 0
    && Object.keys(doc.paths).every((path) => path === '/api/v1' || path.startsWith('/api/v1/')), Object.keys(doc.paths).length + ' 条路径');
  for (const path of REQUIRED_PATHS) check(`path-exists:${path}`, !!doc.paths?.[path]);
  const schemas = doc.components?.schemas ? Object.keys(doc.components.schemas) : [];
  check('dto-schemas-derived', schemas.length > 0
    && REQUIRED_SCHEMA_HINTS.some((hint) => schemas.some((name) => name.includes(hint))), { total: schemas.length });
  const loginBody = doc.paths?.['/api/v1/auth/login']?.post?.requestBody?.content?.['application/json']?.schema;
  check('login-body-schema', !!loginBody, loginBody);

  results.allPassed = results.checks.every((item) => item.ok);
  results.finishedAt = new Date().toISOString();
  const fs = await import('node:fs');
  const outDir = process.env.OPENAPI_REPORT_DIR;
  if (outDir) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(`${outDir}/openapi-contract.json`, JSON.stringify(results, null, 2)); }
  console.log('ALL-PASSED=' + results.allPassed);
  if (!results.allPassed) process.exitCode = 1;
}

main().catch((error) => { console.error('CONTRACT-CHECK-ERROR', error.message); process.exitCode = 1; });
