import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { Readable } from 'node:stream';
import request from 'supertest';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { AuthService } from '../auth/auth.service';
import { MANAGEMENT_PERMISSION_CODES } from '../auth/seed.service';
import { AnnouncementController } from './announcement.controller';
import { AnnouncementService } from './announcement.service';
import { DictController } from './dict.controller';
import { DictService } from './dict.service';
import { SystemLogController } from './system-log.controller';
import { SystemLogService } from './system-log.service';
import { AttachmentController } from '../attachment/attachment.controller';
import { AttachmentService } from '../attachment/attachment.service';
import { AttachmentUploadInterceptor } from '../attachment/attachment-upload.interceptor';
import { ExampleController } from '../example/example.controller';
import { ExampleService } from '../example/example.service';

describe('管理权限 HTTP 边界（真实控制器、角色守卫与权限守卫）', () => {
  let app: INestApplication;
  let codes: string[];
  let role: string;
  const announcement = {
    findPage: jest.fn(), readDetail: jest.fn(), findPublishedPage: jest.fn(),
    create: jest.fn(), update: jest.fn(), publish: jest.fn(), withdraw: jest.fn(), remove: jest.fn(),
  };
  const dict = {
    findTypes: jest.fn(), findItemsByTypeId: jest.fn(), createType: jest.fn(), updateType: jest.fn(), deleteType: jest.fn(),
    createItem: jest.fn(), updateItem: jest.fn(), deleteItem: jest.fn(), findByCode: jest.fn(), getAllItemsByCode: jest.fn(),
  };
  const logs = { findAll: jest.fn() };
  const attachment = {
    findPage: jest.fn(), saveFile: jest.fn(), remove: jest.fn(), sweepDeletedFiles: jest.fn(),
    resolveForDownload: jest.fn(), openDownload: jest.fn(),
  };
  const example = { uploadAttachment: jest.fn() };
  const upload = jest.fn((context, next) => {
    context.switchToHttp().getRequest().file = { filename: 'fixture.pdf' };
    return next.handle();
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AnnouncementController, DictController, SystemLogController, AttachmentController, ExampleController],
      providers: [
        { provide: AnnouncementService, useValue: announcement }, { provide: DictService, useValue: dict },
        { provide: SystemLogService, useValue: logs }, { provide: AttachmentService, useValue: attachment },
        { provide: ExampleService, useValue: example }, { provide: ConfigService, useValue: new ConfigService() },
        { provide: AuthService, useValue: { getUserAccessCodes: async () => codes } },
        { provide: APP_GUARD, useClass: RolesGuard }, { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    }).overrideInterceptor(AttachmentUploadInterceptor).useValue({ intercept: upload }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.user = { sub: 7, roleCode: role, roles: [role] }; next();
    });
    await app.init();
  });
  beforeEach(() => {
    codes = []; role = 'business-maintainer'; jest.clearAllMocks();
    attachment.resolveForDownload.mockResolvedValue({ row: { mimeType: 'application/pdf', size: 2 } });
    attachment.openDownload.mockImplementation(() => ({ contentDisposition: 'attachment', stream: Readable.from('ok') }));
  });
  afterAll(async () => { await app?.close(); });

  const cases = [
    ['get', '/system/announcements', 'announcements:view', announcement.findPage],
    ['get', '/system/announcements/manage/1', 'announcements:view', announcement.readDetail],
    ['post', '/system/announcements', 'announcements:create', announcement.create],
    ['put', '/system/announcements/1', 'announcements:update', announcement.update],
    ['post', '/system/announcements/1/publish', 'announcements:publish', announcement.publish],
    ['post', '/system/announcements/1/withdraw', 'announcements:withdraw', announcement.withdraw],
    ['delete', '/system/announcements/1', 'announcements:delete', announcement.remove],
    ['get', '/system/dicts/types', 'dicts:view', dict.findTypes],
    ['get', '/system/dicts/types/1/items', 'dicts:view', dict.findItemsByTypeId],
    ['post', '/system/dicts/types', 'dicts:create', dict.createType],
    ['post', '/system/dicts/types/1/items', 'dicts:create', dict.createItem],
    ['put', '/system/dicts/types/1', 'dicts:update', dict.updateType],
    ['put', '/system/dicts/items/1', 'dicts:update', dict.updateItem],
    ['delete', '/system/dicts/types/1', 'dicts:delete', dict.deleteType],
    ['delete', '/system/dicts/items/1', 'dicts:delete', dict.deleteItem],
    ['get', '/system/logs', 'system-logs:view', logs.findAll],
    ['get', '/attachments', 'attachments:view', attachment.findPage],
    ['post', '/attachments', 'attachments:upload', attachment.saveFile],
    ['get', '/attachments/1/download', 'attachments:download', attachment.resolveForDownload],
    ['delete', '/attachments/1', 'attachments:delete', attachment.remove],
    ['post', '/attachments/cleanup', 'attachments:cleanup', attachment.sweepDeletedFiles],
    ['post', '/examples/items/attachments/upload', 'example-items:update', example.uploadAttachment],
  ] as const;
  const send = (method: string, path: string) => (request(app.getHttpServer()) as any)[method](path).send({});

  /** 账号安全第一批：权限码已随任务 01 注册（种子＋补丁），端点由任务 03/04 实现；
   *  实现后把用例加入 cases 并删除本豁免，恢复全覆盖守护。 */
  const pendingEndpointCodes = new Set(['users:reset-password', 'users:revoke-sessions']);

  it('用例覆盖种子声明的全部管理权限码，无遗漏也无拼写漂移', () => {
    const caseCodes = new Set<string>(cases.map(([, , code]) => code as string));
    expect(new Set(MANAGEMENT_PERMISSION_CODES).size).toBe(MANAGEMENT_PERMISSION_CODES.length);
    for (const code of MANAGEMENT_PERMISSION_CODES) expect(caseCodes.has(code) || pendingEndpointCodes.has(code)).toBe(true);
  });

  it.each(cases)('%s %s：无权限和错误权限均拒绝，精确授权后普通角色可用', async (method, path, code, handler) => {
    await send(method, path).expect(403);
    codes = ['unrelated:view'];
    await send(method, path).expect(403);
    expect(handler).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    codes = [code];
    await send(method, path).expect(method === 'post' ? 201 : 200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('只有编辑公告权限不能发布或撤回；只有附件查看权限不能下载或清理', async () => {
    codes = ['announcements:view', 'announcements:update', 'attachments:view'];
    for (const path of ['/system/announcements/1/publish', '/system/announcements/1/withdraw', '/attachments/cleanup']) {
      await send('post', path).expect(403);
    }
    await send('get', '/attachments/1/download').expect(403);
  });

  it('单据编辑权限只允许单据上传入口，不能使用附件管理接口', async () => {
    codes = ['example-items:update'];
    await send('post', '/attachments').expect(403);
    await send('post', '/examples/items/attachments/upload').expect(201);
    expect(attachment.saveFile).not.toHaveBeenCalled();
    expect(example.uploadAttachment).toHaveBeenCalledTimes(1);
  });

  it('管理详情按查看权限访问，普通阅读接口保留发布状态裁决', async () => {
    codes = ['announcements:view'];
    await send('get', '/system/announcements/manage/1').expect(200);
    expect(announcement.readDetail).toHaveBeenLastCalledWith(1, true);
    codes = [];
    await send('get', '/system/announcements/1').expect(200);
    expect(announcement.readDetail).toHaveBeenLastCalledWith(1, false);
  });

  it('阅读公告和按编码读取字典仍是登录后的基础能力', async () => {
    for (const path of ['/system/announcements/published', '/system/dicts/item_category', '/system/dicts/item_category/all']) {
      await send('get', path).expect(200);
    }
    expect(announcement.findPublishedPage).toHaveBeenCalled();
    expect(dict.findByCode).toHaveBeenCalledWith('item_category');
    expect(dict.getAllItemsByCode).toHaveBeenCalledWith('item_category');
  });

  it('admin 保留系统管理例外', async () => {
    role = 'admin';
    await send('get', '/system/logs').expect(200);
    await send('post', '/attachments/cleanup').expect(201);
  });
});
