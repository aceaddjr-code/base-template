import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { configureApplication } from '../src/app.setup';
import { ExampleController } from '../src/modules/example/example.controller';
import { ExampleService } from '../src/modules/example/example.service';
import { PermissionGuard } from '../src/modules/auth/guards/permission.guard';
import { AuthService } from '../src/modules/auth/auth.service';

/** 只替换身份和存储，验证真实控制器、权限元数据和请求验证。 */
describe('示例事项 HTTP 权限与验证', () => {
  let app: NestExpressApplication;
  let codes: string[] = [];
  const service = { list:jest.fn().mockResolvedValue({list:[],total:0}), create:jest.fn().mockResolvedValue({id:1}), update:jest.fn(), changeOwner:jest.fn().mockResolvedValue({id:1,ownerId:2}), batchRemove:jest.fn().mockResolvedValue({successCount:1,total:1,failures:[]}), exportExcel:jest.fn().mockResolvedValue({buffer:Buffer.from('test'),filename:'示例.xlsx'}) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers:[ExampleController],
      providers:[
        {provide:ExampleService,useValue:service},
        {provide:AuthService,useValue:{getUserAccessCodes:async () => codes}},
        {provide:APP_GUARD,useClass:PermissionGuard},
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({bodyParser:false});
    app.use((req:any,_res:any,next:() => void) => { req.user={sub:1,roleCode:'user'}; next(); });
    configureApplication(app,new ConfigService());
    await app.init();
  });
  beforeEach(() => { codes=[]; jest.clearAllMocks(); });
  afterAll(async () => { await app?.close(); });

  it('有登录身份但没有 view 权限时，列表返回 403', async () => {
    await request(app.getHttpServer()).get('/api/v1/examples/items').expect(403);
    expect(service.list).not.toHaveBeenCalled();
  });

  it('授予 view 后可访问列表，且身份传入服务层', async () => {
    codes=['example-items:view'];
    await request(app.getHttpServer()).get('/api/v1/examples/items').expect(200);
    expect(service.list).toHaveBeenCalledWith(expect.any(Object),expect.objectContaining({sub:1}));
  });

  it('创建 DTO 阻止空标题和系统字段注入', async () => {
    codes=['example-items:create'];
    await request(app.getHttpServer()).post('/api/v1/examples/items').send({title:'   '}).expect(400);
    await request(app.getHttpServer()).post('/api/v1/examples/items').send({title:'事项',ownerId:99}).expect(400);
    await request(app.getHttpServer()).post('/api/v1/examples/items').send({title:'事项',docNo:'EX-20261102-999'}).expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('变更负责人走独立权限码，编辑权限不能替代', async () => {
    codes=['example-items:update'];
    await request(app.getHttpServer()).post('/api/v1/examples/items/1/owner').send({ownerId:2}).expect(403);
    expect(service.changeOwner).not.toHaveBeenCalled();
    codes=['example-items:owner'];
    await request(app.getHttpServer()).post('/api/v1/examples/items/1/owner').send({ownerId:2}).expect(201);
    expect(service.changeOwner).toHaveBeenCalledWith(1,2,expect.objectContaining({sub:1}),expect.anything());
  });

  it('变更负责人 DTO 拒绝缺失、非整数和越界 ID', async () => {
    codes=['example-items:owner'];
    for (const body of [{}, {ownerId:0}, {ownerId:'x'}, {ownerId:1.5}]) {
      await request(app.getHttpServer()).post('/api/v1/examples/items/1/owner').send(body).expect(400);
    }
    expect(service.changeOwner).not.toHaveBeenCalled();
  });

  it('非法记录 ID 在调用存储前被拒绝', async () => {
    codes=['example-items:update'];
    await request(app.getHttpServer()).put('/api/v1/examples/items/invalid').send({title:'事项'}).expect(400);
    expect(service.update).not.toHaveBeenCalled();
  });
  it('字段错误保留原响应契约、请求号，不回传被拒绝的值', async () => {
    codes=['example-items:create'];
    const response = await request(app.getHttpServer()).post('/api/v1/examples/items').set('X-Request-ID', 'field-contract-123')
      .send({ title: ' ', status: 'private-rejected-value' }).expect(400);
    expect(response.body).toMatchObject({ code: 400, data: null, requestId: 'field-contract-123', message: expect.any(String) });
    expect(response.body.fieldErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'title', code: 'isNotEmpty' }), expect.objectContaining({ path: 'status', code: 'isIn' }),
    ]));
    expect(JSON.stringify(response.body)).not.toContain('private-rejected-value');
    expect(response.headers['x-request-id']).toBe('field-contract-123');
  });

  it('批量删除复用单删权限；只拥有其他权限不能调用', async () => {
    codes=['example-items:view','example-items:export'];
    await request(app.getHttpServer()).post('/api/v1/examples/items/batch/remove').send({ids:[1]}).expect(403);
    expect(service.batchRemove).not.toHaveBeenCalled();
    codes=['example-items:delete'];
    await request(app.getHttpServer()).post('/api/v1/examples/items/batch/remove').send({ids:[1]}).expect(201);
    expect(service.batchRemove).toHaveBeenCalledWith([1],expect.objectContaining({sub:1}),expect.any(String));
  });

  it('批量 DTO 拒绝空、负数、字符串和超限 ID', async () => {
    codes=['example-items:delete'];
    for (const ids of [[],[0],['1'],Array(501).fill(1)]) {
      await request(app.getHttpServer()).post('/api/v1/examples/items/batch/remove').send({ids}).expect(400);
    }
    expect(service.batchRemove).not.toHaveBeenCalled();
  });

  it('导出路由保留权限，且向服务传递相同筛选及列参数', async () => {
    await request(app.getHttpServer()).get('/api/v1/examples/items/export?ids=1').expect(403);
    codes=['example-items:export'];
    const response=await request(app.getHttpServer()).get('/api/v1/examples/items/export?keyword=hello&status=doing&ids=1,2&cols=description,title').expect(200);
    expect(response.headers['content-disposition']).toContain("filename*=UTF-8''");
    expect(service.exportExcel).toHaveBeenCalledWith(expect.objectContaining({sub:1}),expect.objectContaining({keyword:'hello',filters:{status:'doing'},ids:[1,2],cols:['description','title']}));
    service.exportExcel.mockClear();
    await request(app.getHttpServer()).get('/api/v1/examples/items/export?ids=x').expect(400);
    expect(service.exportExcel).not.toHaveBeenCalled();
  });
});
