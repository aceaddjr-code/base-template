import { mkdirSync } from 'fs';
import { extname, resolve } from 'path';
import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';

export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

/** multer 文件过滤器：仅图片（拒绝时抛 BadRequestException → 400 友好提示，而非 500） */
export function imageFileFilter(
  _req: any,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) {
  const ext = extname(file.originalname).toLowerCase();
  if (!IMAGE_MIMES.includes(file.mimetype) || !IMAGE_EXTS.includes(ext)) {
    cb(new BadRequestException('仅支持 jpg/png/webp/gif 图片'), false);
    return;
  }
  cb(null, true);
}

const FILE_EXTS = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.xlsm', '.ppt', '.pptx',
  '.zip', '.rar', '.7z', '.txt', '.csv',
  '.dwg', '.dxf', '.step', '.stp', '.igs', '.iges', '.stl', '.3dm', '.vsd', '.vsdx',
];

/** multer 文件过滤器：通用文档（扩展名白名单；拒绝时 400 友好提示） */
export function fileFileFilter(
  _req: any,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) {
  const ext = extname(file.originalname).toLowerCase();
  if (!FILE_EXTS.includes(ext)) {
    cb(new BadRequestException('仅支持 pdf/doc/docx/xls/xlsx/xlsm/ppt/pptx/zip/rar/7z/txt/csv/dwg/dxf/step/stp/igs/iges/stl/3dm/vsd/vsdx 文件'), false);
    return;
  }
  cb(null, true);
}

/** 月份子目录（uploads/2026/08） */
export function monthPath(now: Date = new Date()): string {
  return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * diskStorage 目标目录工厂：<根目录>/YYYY/MM/（首传 mkdirSync recursive 自建，生产无需预建）。
 * 注意：FileInterceptor 装饰器在类实例化前求值，不能用 this.config/注入的 ConfigService——
 * 直接读 process.env（ConfigService 底层即 process.env，值一致；生产 .env 里配 UPLOAD_DIR）。
 * dirEnv/fallback 指定根目录的环境变量与默认值（如附件的私有根目录）。
 */
export function uploadDestinationFactory(dirEnv = 'UPLOAD_DIR', fallback = 'uploads') {
  return (_req: any, _file: Express.Multer.File, cb: (err: Error | null, dest: string) => void) => {
    const dir = resolve(process.cwd(), process.env[dirEnv] ?? fallback, monthPath());
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  };
}

/** diskStorage 文件名工厂：时间戳-UUID+小写扩展名（防覆盖/防路径注入） */
export function uploadFilenameFactory(
  _req: any,
  file: Express.Multer.File,
  cb: (err: Error | null, name: string) => void,
) {
  cb(null, `${Date.now()}-${randomUUID()}${extname(file.originalname).toLowerCase()}`);
}
