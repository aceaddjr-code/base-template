import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { SeedService } from './seed.service';
import { User } from '../user/user.entity';
import { UserRole } from '../user/user-role.entity';
import { UserDataScope } from '../user/user-data-scope.entity';
import { UserDataScopeTarget } from '../user/user-data-scope-target.entity';
import { Role } from '../role/role.entity';
import { Menu } from '../menu/menu.entity';
import { Department } from '../department/department.entity';
import { SysDictType } from '../system/entities/sys-dict-type.entity';
import { SysDictItem } from '../system/entities/sys-dict-item.entity';

@Module({
  imports: [
    PassportModule,
    TypeOrmModule.forFeature([User, Role, Menu, Department, UserRole, UserDataScope, UserDataScopeTarget, SysDictType, SysDictItem]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, SeedService],
  exports: [AuthService],
})
export class AuthModule {}
