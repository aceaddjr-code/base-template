import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExampleItem } from './example-item.entity';
import { ExampleController } from './example.controller';
import { ExampleService } from './example.service';

@Module({
  imports: [TypeOrmModule.forFeature([ExampleItem])],
  controllers: [ExampleController],
  providers: [ExampleService],
})
export class ExampleModule {}
