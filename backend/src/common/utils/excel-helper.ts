

import * as XLSX from 'xlsx-js-style';

export interface ColumnDef {
  /** Excel 表头列名 */
  header: string;
  /** 对象属性名 */
  key: string;
  /** 导出时的列宽（字符数），默认 15 */
  width?: number;
}

/**
 * 将数据数组导出为 Excel Buffer
 *
 * @param data      数据数组
 * @param columns   列定义（header → 列名, key → 字段名）
 * @param sheetName 工作表名称
 * @returns Excel 文件的 Buffer
 */
export async function dataToExcel(
  data: Record<string, any>[],
  columns: ColumnDef[],
  sheetName: string = 'Sheet1',
): Promise<Buffer> {
  // 表头行
  const headerRow = columns.map((c) => c.header);

  // 数据行
  const dataRows = data.map((row) =>
    columns.map((c) => {
      const val = row[c.key];
      return val !== null && val !== undefined ? val : '';
    }),
  );

  const rows = [headerRow, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true, dateNF: 'yyyy-mm-dd hh:mm:ss' });

  // 设置列宽
  ws['!cols'] = columns.map((c) => ({ wch: c.width || 15 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * 从 Excel Buffer 解析数据
 *
 * @param buffer    Excel 文件 Buffer
 * @param colMap    { 对象属性名: Excel表头名[] }  —— 用于列名匹配
 * @param maxRows   数据行数上限（可选）：预检只解析表头 + maxRows 行，
 *                  超限直接抛错提示分批导入——避免上百万行整表解析卡死/内存溢出
 * @returns 解析后的数据数组
 */
export async function excelToData(
  buffer: Buffer,
  colMap: Record<string, string[]>,
  maxRows?: number,
  /** 表头所在行（0 起；导入文件常在首行有「单据名」标题行，此时需传 1） */
  headerRow = 0,

  dateHeaderPattern: RegExp = /日期|时间/,
): Promise<Record<string, any>[]> {
  if (maxRows && maxRows > 0) {
    // 预检：sheetRows 限制解析行数，只读到 表头 + maxRows + 1 行；
    // 若探测到第 maxRows+1 条数据行（末行非空）→ 行数超限，整表拒绝
    const probe = XLSX.read(buffer, { type: 'buffer', sheetRows: maxRows + 2 });
    const probeSheet = probe.Sheets[probe.SheetNames[0]];
    const probeRows: any[][] = XLSX.utils.sheet_to_json(probeSheet, { header: 1 });
    const last = probeRows[probeRows.length - 1];
    const lastHasData = Array.isArray(last) && last.some((c) => c !== undefined && c !== null && c !== '');
    if (probeRows.length - 1 > maxRows && lastHasData) {
      throw new Error(`数据行数超过上限 ${maxRows} 行，请分批导入`);
    }
  }
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  if (rows.length < headerRow + 2) return [];

  const header = rows[headerRow] as string[];

  // 匹配列索引（记录匹配到的 Excel 表头名，供日期列识别）
  const idxMap: Record<string, { idx: number; header: string }> = {};
  for (const [key, names] of Object.entries(colMap)) {
    for (const name of names) {
      const idx = header.findIndex((h) => h?.toString().trim() === name);
      if (idx >= 0) { idxMap[key] = { idx, header: name }; break; }
    }
  }

  if (Object.keys(idxMap).length === 0) {
    throw new Error('Excel 列名不匹配，请检查表头是否包含正确的列名');
  }

  // 小数部分直接按秒数算时分秒（不经过 Date 构造——Windows 对 1899 年日期套用历史时区 +8:05:43，
  // 本地换算会偏移 5 分 43 秒，整数序列号会掉到前一天 23:54）
  function excelDateToStr(raw: any): string {
    const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(num) || num < 1 || num > 100000) return String(raw ?? '').trim();
    const whole = Math.floor(num);
    const d = new Date(Date.UTC(1899, 11, 30) + whole * 86400000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const frac = num - whole;
    if (frac > 0) {
      const totalSec = Math.round(frac * 86400);
      return `${date} ${pad(Math.floor(totalSec / 3600))}:${pad(Math.floor((totalSec % 3600) / 60))}:${pad(totalSec % 60)}`;
    }
    return date;
  }

  // 解析数据行
  const result: Record<string, any>[] = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c: any) => c === undefined || c === null || c === '')) continue;

    const record: Record<string, any> = {};
    for (const [key, { idx, header }] of Object.entries(idxMap)) {
      const raw = row[idx];
      let val = raw?.toString()?.trim();
      // 日期类列：数字序列号 → 日期字符串；Date 对象 → 日期字符串
      // （修复 code-review #4：「交期」等不含"日期/时间"的业务表头由调用方经 dateHeaderPattern 传入——
      //   否则 日期数字序列号（如 46240）原样入库，DATE 列拒收导致整行丢弃）
      if (dateHeaderPattern.test(header)) {
        if (typeof raw === 'number' || /^\d+(\.\d+)?$/.test(String(raw ?? '').trim())) {
          val = excelDateToStr(raw);
        } else if (raw instanceof Date && !isNaN(raw.getTime())) {
          const d = raw;
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          val = `${d.getFullYear()}-${m}-${day}`;
        }
      }
      record[key] = val !== undefined && val !== '' ? val : null;
    }
    result.push(record);
  }

  return result;
}

/** Excel 文件上传过滤器 */
export function excelFileFilter(
  _req: any,
  file: Express.Multer.File,
  cb: (error: Error | null, accept: boolean) => void,
) {
  const allowed = /\.(xlsx|xls)$/i;
  if (allowed.test(file.originalname)) {
    cb(null, true);
  } else {
    cb(new Error('仅支持 .xlsx 或 .xls 格式的 Excel 文件'), false);
  }
}

/** 统一发送 Excel 文件响应（避免 8 处重复设置 Content-Type + Content-Disposition） */
export function sendExcel(res: any, buffer: Buffer, filename: string) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buffer);
}

// ===== 第四批：带原始坐标的解析（导入专用；导出等旧调用方继续用 excelToData） =====

export interface ParsedCellMeta { row: number; column: number; header: string }
export interface ParsedRowMeta {
  rowNumber: number;
  cells: Record<string, ParsedCellMeta>;
  data: Record<string, any>;
}
export interface ParseResultWithMeta {
  sheetName: string;
  headerRowNumber: number;
  rows: ParsedRowMeta[];
  otherDataSheets: string[];
  parseVersion: 1;
}

/**
 * 解析导入文件并保留原始行列坐标：
 * - 前 3 行内探测表头（命中 colMap 任一表头名），兼容单据名标题行；
 * - 空行跳过但不影响后续原始行号；日期翻译逻辑与 excelToData 一致；
 * - 除首个数据工作表外存在任何非空单元格的工作表 → 拒绝（指名，防静默遗漏）；
 * - 数据行数上限 maxRows（默认 1000）：探测到超限整表拒绝。
 */
export async function excelToDataWithMeta(
  buffer: Buffer,
  colMap: Record<string, string[]>,
  maxRows = 1000,
  dateHeaderPattern: RegExp = /日期|时间/,
): Promise<ParseResultWithMeta> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  if (!workbook.SheetNames.length) throw new Error('文件中没有工作表');
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // 其他含数据工作表：任何一个非空单元格即视为含数据
  const otherDataSheets: string[] = [];
  for (const name of workbook.SheetNames.slice(1)) {
    const other = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 }) as any[][];
    if (other.some(r => Array.isArray(r) && r.some(c => c !== undefined && c !== null && c !== ''))) {
      otherDataSheets.push(name);
    }
  }
  if (otherDataSheets.length) {
    throw new Error(`文件包含多个数据工作表（${otherDataSheets.join('、')}），仅支持导入首个工作表，请拆分后重试`);
  }

  // 表头探测：前 3 行内找命中 colMap 至少 1 列的行
  let headerRowIdx = -1;
  let header: string[] = [];
  for (let i = 0; i < Math.min(3, rows.length); i++) {
    const candidate = rows[i] as string[];
    const hits = Object.values(colMap).some(names => names.some(name => candidate?.some(h => h?.toString().trim() === name)));
    if (hits) { headerRowIdx = i; header = candidate; break; }
  }
  if (headerRowIdx < 0) {
    throw new Error('前 3 行内未找到有效表头，请使用标准导入模板');
  }

  // 列匹配（重复表头取首个命中）
  const idxMap: Record<string, { idx: number; header: string }> = {};
  for (const [key, names] of Object.entries(colMap)) {
    for (const name of names) {
      const idx = header.findIndex(h => h?.toString().trim() === name);
      if (idx >= 0) { idxMap[key] = { idx, header: name }; break; }
    }
  }
  if (Object.keys(idxMap).length === 0) {
    throw new Error('Excel 列名不匹配，请检查表头是否包含正确的列名');
  }

  function excelDateToStr(raw: any): string {
    const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(num) || num < 1 || num > 100000) return String(raw ?? '').trim();
    const whole = Math.floor(num);
    const d = new Date(Date.UTC(1899, 11, 30) + whole * 86400000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const frac = num - whole;
    if (frac > 0) {
      const totalSec = Math.round(frac * 86400);
      return `${date} ${pad(Math.floor(totalSec / 3600))}:${pad(Math.floor((totalSec % 3600) / 60))}:${pad(totalSec % 60)}`;
    }
    return date;
  }

  const result: ParsedRowMeta[] = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c: any) => c === undefined || c === null || c === '')) continue;
    if (result.length >= maxRows) {
      throw new Error(`数据行数超过上限 ${maxRows} 行，请分批导入`);
    }
    const record: Record<string, any> = {};
    const cells: Record<string, ParsedCellMeta> = {};
    for (const [key, { idx, header: headerName }] of Object.entries(idxMap)) {
      const raw = row[idx];
      if (raw !== undefined && raw !== null && raw !== '') {
        cells[key] = { row: i + 1, column: idx + 1, header: headerName };
      }
      let val = raw?.toString()?.trim();
      if (dateHeaderPattern.test(headerName)) {
        if (typeof raw === 'number' || /^\d+(\.\d+)?$/.test(String(raw ?? '').trim())) {
          val = excelDateToStr(raw);
        } else if (raw instanceof Date && !isNaN(raw.getTime())) {
          const d = raw;
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          val = `${d.getFullYear()}-${m}-${day}`;
        }
      }
      if (val !== undefined && val !== '') record[key] = val;
    }
    result.push({ rowNumber: i + 1, cells, data: record });
  }
  return { sheetName, headerRowNumber: headerRowIdx + 1, rows: result, otherDataSheets: [], parseVersion: 1 };
}

// ===== 第四批 03：错误文件与核对报告（安全 xlsx：纯数据＋标红，不传播宏/公式/外链） =====

export interface ErrorFileRow {
  /** 标准导入列的值（按 ColumnDef.key） */
  values: Record<string, any>;
  /** 需要标红的列 key → 原因文字 */
  errors: Record<string, string>;
  /** 附加列（报告用，如原始行号/状态）；错误文件不放业务列 */
  meta?: Record<string, any>;
}

/**
 * 生成「失败/未处理行修正文件」：标准导入列＋标红错误单元格＋文末错误说明列；
 * 由服务端已解析内容重建（aoa_to_sheet），公式样内容按文本输出。
 */
export async function errorFileToExcel(
  rows: ErrorFileRow[],
  columns: ColumnDef[],
  options: { errorColumnHeader: string; metaColumns?: Array<{ header: string; key: string }> },
): Promise<Buffer> {
  const metaColumns = options.metaColumns ?? [];
  const headerRow = [...columns.map(c => c.header), ...metaColumns.map(c => c.header), options.errorColumnHeader];
  const dataRows = rows.map(row => [
    ...columns.map(c => row.values[c.key] ?? ''),
    ...metaColumns.map(c => row.meta?.[c.key] ?? ''),
    Object.values(row.errors).join('；') || '',
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows], { cellDates: true });
  // 标红错误单元格（xlsx-js-style：填充浅红＋深红文字）
  rows.forEach((row, rowIndex) => {
    for (const [key, reason] of Object.entries(row.errors)) {
      if (!reason) continue;
      const colIdx = columns.findIndex(c => c.key === key);
      if (colIdx < 0) continue;
      const address = XLSX.utils.encode_cell({ r: rowIndex + 1, c: colIdx });
      const cell = ws[address];
      if (cell) {
        cell.s = { fill: { fgColor: { rgb: 'FFC7CE' } }, font: { color: { rgb: '9C0006' } } };
      }
    }
  });
  ws['!cols'] = [...columns.map(c => ({ wch: c.width || 15 })), ...metaColumns.map(() => ({ wch: 12 })), { wch: 50 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '修正数据');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true }) as Buffer;
}

/** 生成「完整结果核对报告」：原始行号/状态/原因/成功单据编号，仅供核对（页面明示不可作模板）。 */
export async function reportToExcel(
  rows: Array<{ rowNumber: number; status: string; error?: string | null; createdDocNo?: string | null; title?: string | null }>,
): Promise<Buffer> {
  const header = ['原始行号', '标题', '状态', '原因', '成功单据编号'];
  const statusText = (s: string) => s === 'success' ? '成功' : s === 'invalid' ? '校验失败' : s === 'infrastructure_error' ? '写入失败（可重试）' : '未处理';
  const dataRows = rows.map(row => [row.rowNumber, row.title ?? '', statusText(row.status), row.error ?? '', row.createdDocNo ?? '']);
  const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
  ws['!cols'] = [{ wch: 10 }, { wch: 24 }, { wch: 14 }, { wch: 50 }, { wch: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '核对报告');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
