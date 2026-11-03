import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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

@Module({
  imports: [TypeOrmModule.forFeature([ExampleItem, ExampleEvent, ExampleChange, Attachment, ExampleRecycle, ExampleReservedNumber]), AttachmentModule, UserModule],
  controllers: [ExampleController, ExampleRecycleController],
  providers: [ExampleService, ExampleRecycleService, AttachmentRecycleService],
})
export class ExampleModule {}
