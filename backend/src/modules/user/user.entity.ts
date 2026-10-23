import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { Role } from '../role/role.entity';
import { Department } from '../department/department.entity';

@Entity('users')
export class User extends BaseEntity {
  @Column({ type: 'varchar', length: 50, unique: true, comment: '用户名' })
  username: string;

  @Column({ type: 'varchar', length: 255, select: false, comment: 'bcrypt密码哈希' })
  password: string;

  @Column({ name: 'display_name', type: 'varchar', length: 50, nullable: true, comment: '显示名称' })
  displayName: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true, comment: '邮箱' })
  email: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true, comment: '手机号' })
  phone: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '头像URL' })
  avatar: string | null;

  @Column({ type: 'tinyint', default: 1, comment: '1=启用 0=禁用' })
  status: number;

  @Column({ name: 'token_version', type: 'int', default: 1, comment: 'Token版本号，递增可使旧Token失效' })
  tokenVersion: number;

  @Column({ name: 'role_id', type: 'int', nullable: true, comment: '角色ID' })
  roleId: number | null;

  @ManyToOne(() => Role, { nullable: true })
  @JoinColumn({ name: 'role_id' })
  role: Role | null;

  @Column({ name: 'dept_id', type: 'int', nullable: true, comment: '部门ID（数据隔离口径）' })
  deptId: number | null;

  @ManyToOne(() => Department, { nullable: true })
  @JoinColumn({ name: 'dept_id' })
  dept: Department | null;

  /** 组织汇报关系，不附带业务审批规则。 */
  @Column({ name: 'leader_id', type: 'int', nullable: true, comment: '直属上级用户ID' })
  leaderId: number | null;
}
