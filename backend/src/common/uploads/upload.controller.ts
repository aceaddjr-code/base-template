import { BadRequestException, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import {
  fileFileFilter,
  imageFileFilter,
  monthPath,
  uploadDestinationFactory,
  uploadFilenameFactory,
} from './upload.service';

@Controller('common/upload')
export class UploadController {
  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: uploadDestinationFactory(),
        filename: uploadFilenameFactory,
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: imageFileFilter,
    }),
  )
  uploadImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file?.filename) throw new BadRequestException('请选择图片文件');
    // 相对路径（/uploads/YYYY/MM/xxx.jpg），前端拼站点根；静态访问由 main.ts express.static 挂载
    return { url: `/uploads/${monthPath()}/${file.filename}` };
  }

  @Post('file')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: uploadDestinationFactory(),
        filename: uploadFilenameFactory,
      }),
      limits: { fileSize: 20 * 1024 * 1024 },
      fileFilter: fileFileFilter,
    }),
  )
  uploadFile(@UploadedFile() file?: Express.Multer.File) {
    if (!file?.filename) throw new BadRequestException('请选择文件');
    return { url: `/uploads/${monthPath()}/${file.filename}` };
  }
}
