import * as XLSX from 'xlsx-js-style';
import { dataToExcel, type ColumnDef } from '../../common/utils/excel-helper';
import type { ExampleImportRow } from './example-import-row.entity';

export interface ErrorFileRow {
  /** 标准导入列的值（按 ColumnDef.key） */
  values: Record<string, any>;
  /** 需要标红的列 key → 原因文字 */
  errors: Record<string, string>;
  /** 附加列（报告用，如原始行号/状态）；错误文件不放业务列 */
  meta?: Record<string, any>;
}

/**
 * 生成「失败/未处理行修正文件」：标准导入列＋标红错误单元格＋文末原因列；
 * 由服务端已解析内容重建（aoa_to_sheet），公式样内容按文本输出。
 * 与 common 层 errorFileToExcel 的区别：此处含 example 模块的字段映射与错误定位。
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

/** 导入会话状态→中文标签（模块内业务词汇；common 层不承载）。 */
const IMPORT_ROW_STATUS_LABELS: Record<string, string> = {
  success: '成功',
  invalid: '校验失败',
  infrastructure_error: '写入失败（可重试）',
  pending: '未处理',
};

/** 生成「完整结果核对报告」：原始行号/状态/原因/成功单据编号，仅供核对。 */
export async function importReportToExcel(
  rows: Array<Pick<ExampleImportRow, 'rowNumber' | 'status' | 'errorMessage' | 'createdDocNo' | 'data'>>,
): Promise<Buffer> {
  const header = ['原始行号', '标题', '状态', '原因', '成功单据编号'];
  const dataRows = rows.map(row => [
    row.rowNumber,
    (row.data as any)?.title ?? '',
    IMPORT_ROW_STATUS_LABELS[row.status] ?? row.status,
    row.errorMessage ?? '',
    row.createdDocNo ?? '',
  ]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
  ws['!cols'] = [{ wch: 10 }, { wch: 24 }, { wch: 14 }, { wch: 50 }, { wch: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '核对报告');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** 导入标准列（修正文件用）：与导入映射同源，不另列清单。 */
export function importColumnsOf(
  excelImportMap: Record<string, string[]> | undefined,
  excelColumns: Array<{ key: string; header: string; width?: number }> | undefined,
): Array<{ header: string; key: string; width: number }> {
  return (excelImportMap ? Object.keys(excelImportMap) : []).map(key => {
    const column = excelColumns?.find((c) => c.key === key);
    return { header: column?.header ?? key, key, width: column?.width ?? 18 };
  });
}

// re-export for backward compat within module
export { dataToExcel };
