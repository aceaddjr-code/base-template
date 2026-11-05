import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemLog } from './entities/system-log.entity';
import { SysDictType } from './entities/sys-dict-type.entity';
import { SysDictItem } from './entities/sys-dict-item.entity';
import { Notification } from './entities/notification.entity';
import { NotificationOutbox } from './entities/notification-outbox.entity';
import { SysSetting } from './entities/sys-setting.entity';
import { Announcement } from './entities/announcement.entity';
import { User } from '../user/user.entity';
import { NotificationService } from './notification.service';
import { NotificationOutboxService } from './notification-outbox.service';
import { NotificationController } from './notification.controller';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';
import { SystemLogService } from './system-log.service';
import { SystemLogController } from './system-log.controller';
import { DictService } from './dict.service';
import { DictController } from './dict.controller';
import { SettingService } from './setting.service';
import { SettingController } from './setting.controller';
import { AnnouncementService } from './announcement.service';
import { AnnouncementController } from './announcement.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([
    SystemLog, SysDictType, SysDictItem, Notification, NotificationOutbox, SysSetting, Announcement, User,
  ])],
  controllers: [
    DictController, SystemLogController,
    NotificationController, BackupController, SettingController, AnnouncementController,
  ],
  providers: [
    SystemLogService, DictService, NotificationService, NotificationOutboxService, BackupService, SettingService, AnnouncementService,
  ],
  exports: [SystemLogService, DictService, NotificationService, NotificationOutboxService, SettingService],
})
export class SystemModule {}
