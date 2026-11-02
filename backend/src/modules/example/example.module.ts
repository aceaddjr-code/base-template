import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExampleItem } from './example-item.entity';
import { ExampleController } from './example.controller';
import { ExampleService } from './example.service';
import { ExampleEvent, ExampleChange } from './example-event.entity';
import { Attachment } from '../attachment/attachment.entity';
import { AttachmentModule } from '../attachment/attachment.module';

@Module({
  imports: [TypeOrmModule.forFeature([ExampleItem, ExampleEvent, ExampleChange, Attachment]), AttachmentModule],
  controllers: [ExampleController],
  providers: [ExampleService],
})
export class ExampleModule {}
