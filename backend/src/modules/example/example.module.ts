import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExampleImportSession } from './example-import-session.entity';
import { ExampleImportService } from './example-import.service';
import { NotificationOutboxService, NOTIFICATION_OUTBOX } from '../system/notification-outbox.service';
import { ExampleImportRow } from './example-import-row.entity';
import { ExampleItem } from './example-item.entity';
import { ExampleController } from './example.controller';
import { ExampleService } from './example.service';
import { ExampleEvent, ExampleChange } from './example-event.entity';
import { Attachment } from '../attachment/attachment.entity';
import { AttachmentModule } from '../attachment/attachment.module';
import { UserModule } from '../user/user.module';
import { ExampleRecycle, ExampleReservedNumber } from './example-recycle.entity';
import { ExampleRecycleService } from './example-recycle.service';
import { ExampleRecycleController } from './example-recycle.controller';
import { AttachmentRecycleService } from './attachment-recycle.service';
import { ExampleItemMember } from './example-member.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ExampleItem, ExampleEvent, ExampleChange, Attachment, ExampleRecycle, ExampleReservedNumber, ExampleImportSession, ExampleImportRow, ExampleItemMember]), AttachmentModule, UserModule],
  controllers: [ExampleController, ExampleRecycleController],
  providers: [ExampleService, ExampleRecycleService, AttachmentRecycleService, ExampleImportService, { provide: NOTIFICATION_OUTBOX, useExisting: NotificationOutboxService }],
})
export class ExampleModule {}
