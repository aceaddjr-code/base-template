import { BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { ATTACHMENT_ALLOWED_EXTS, ATTACHMENT_MAX_SIZE } from './attachment.service';
import { uploadDestinationFactory, uploadFilenameFactory } from '../../common/uploads/upload.service';

/** 附件管理与业务单据共用上传限制和私有存储；操作权限由各自的控制器裁决。 */
export const AttachmentUploadInterceptor = FileInterceptor('file', {
  storage: diskStorage({
    destination: uploadDestinationFactory('ATTACHMENT_PRIVATE_DIR', 'uploads-private'),
    filename: uploadFilenameFactory,
  }),
  limits: { fileSize: ATTACHMENT_MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    // 浏览器 multipart filename 使用 UTF-8；Multer 默认按 Latin-1 读取。
    if ([...file.originalname].every(char => char.charCodeAt(0) <= 255)) {
      try { file.originalname = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(file.originalname, 'latin1')); }
      catch { /* 已是合法的单字节文件名，保留原值。 */ }
    }
    if (!ATTACHMENT_ALLOWED_EXTS.includes(extname(file.originalname).toLowerCase())) {
      cb(new BadRequestException('不支持的文件类型'), false);
      return;
    }
    cb(null, true);
  },
});
