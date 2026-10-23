import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

/** 公告状态：草稿 → 已发布 ⇄ 已撤回（撤回后可重新发布并刷新发布时间） */
export type AnnouncementStatus = 'draft' | 'published' | 'withdrawn';

/** 系统公告：管理员维护，登录用户阅读已发布内容；首版纯文本展示，富文本待受控渲染方案 */
@Entity('announcements')
@Index('idx_announcement_status_time', ['status', 'publishedAt'])
export class Announcement extends BaseEntity {
  @Column({ type: 'varchar', length: 100, comment: '公告标题' })
  title: string;

  @Column({ type: 'text', comment: '公告正文（纯文本，换行保留展示）' })
  content: string;

  @Column({ type: 'varchar', length: 20, default: 'draft', comment: 'draft=草稿 published=已发布 withdrawn=已撤回' })
  status: AnnouncementStatus;

  @Column({ name: 'published_at', type: 'datetime', nullable: true, comment: '最近一次发布时间' })
  publishedAt: Date | null;

  @Column({ name: 'published_by', type: 'int', nullable: true, comment: '最近一次发布人ID' })
  publishedBy: number | null;
}
