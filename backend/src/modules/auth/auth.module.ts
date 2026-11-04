import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { SeedService } from './seed.service';
import { UserModule } from '../user/user.module';
import { User } from '../user/user.entity';
import { UserRole } from '../user/user-role.entity';
import { Role } from '../role/role.entity';
import { Menu } from '../menu/menu.entity';
import { Department } from '../department/department.entity';
import { SysDictType } from '../system/entities/sys-dict-type.entity';
import { SysDictItem } from '../system/entities/sys-dict-item.entity';
import { LoginAttemptCounter } from './login-attempt-counter.entity';

@Module({
  imports: [
    PassportModule,
    UserModule,
    TypeOrmModule.forFeature([User, Role, Menu, Department, UserRole, SysDictType, SysDictItem, LoginAttemptCounter]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, SeedService],
  exports: [AuthService],
})
export class AuthModule {}
