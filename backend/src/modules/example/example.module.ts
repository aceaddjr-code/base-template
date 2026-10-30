import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExampleItem } from './example-item.entity';
import { ExampleController } from './example.controller';
import { ExampleService } from './example.service';
import { ExampleEvent, ExampleChange } from './example-event.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ExampleItem, ExampleEvent, ExampleChange])],
  controllers: [ExampleController],
  providers: [ExampleService],
})
export class ExampleModule {}
