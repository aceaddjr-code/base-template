import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UserDataScopeService } from './user-data-scope.service';
import { User } from './user.entity';
import { Role } from '../role/role.entity';
import { Department } from '../department/department.entity';
import { UserRole } from './user-role.entity';
import { UserDataScope } from './user-data-scope.entity';
import { UserDataScopeTarget } from './user-data-scope-target.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Role, Department, UserRole, UserDataScope, UserDataScopeTarget])],
  controllers: [UserController],
  providers: [UserService, UserDataScopeService],
  exports: [UserService, UserDataScopeService],
})
export class UserModule {}
