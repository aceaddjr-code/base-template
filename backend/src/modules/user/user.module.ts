import { Module, forwardRef } from '@nestjs/common';
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
import { AuthModule } from '../auth/auth.module';

@Module({
  // AuthModule 与 UserModule 互为依赖（AuthService 需要 UserDataScopeService，
  // UserController 需要解释服务）；forwardRef 解开实例化环，不改变运行时行为。
  imports: [TypeOrmModule.forFeature([User, Role, Department, UserRole, UserDataScope, UserDataScopeTarget]), forwardRef(() => AuthModule)],
  controllers: [UserController],
  providers: [UserService, UserDataScopeService],
  exports: [UserService, UserDataScopeService],
})
export class UserModule {}
