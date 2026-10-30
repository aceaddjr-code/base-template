import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { createConnection } from 'mysql2/promise';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ExampleItem } from '../src/modules/example/example-item.entity';
import { ExampleEvent, ExampleChange } from '../src/modules/example/example-event.entity';
import { User } from '../src/modules/user/user.entity';
import { Role } from '../src/modules/role/role.entity';
import { Department } from '../src/modules/department/department.entity';
import { Menu } from '../src/modules/menu/menu.entity';
import { ExampleService } from '../src/modules/example/example.service';
import { ExampleController } from '../src/modules/example/example.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { PermissionGuard } from '../src/modules/auth/guards/permission.guard';
import { AuditInterceptor } from '../src/common/interceptors/audit.interceptor';
import { SystemLogService } from '../src/modules/system/system-log.service';
import { configureApplication } from '../src/app.setup';
import { dataToExcel } from '../src/common/utils/excel-helper';
import { DictService } from '../src/modules/system/dict.service';
import { SysDictType } from '../src/modules/system/entities/sys-dict-type.entity';
import { SysDictItem } from '../src/modules/system/entities/sys-dict-item.entity';

const suite = process.env.TEST_HISTORY_DATABASE ? describe : describe.skip;
suite('单据履历：业务 HTTP 与隔离 MySQL', () => {
 let app: NestExpressApplication, db: DataSource, connection: Awaited<ReturnType<typeof createConnection>>, created = false;
 let codes: string[], user: any, itemId: number, otherId: number;
 const database = process.env.TEST_HISTORY_DATABASE!;
 const audit = { write: jest.fn(async () => undefined) };
 const api = () => request(app.getHttpServer());
 const access = (id = itemId, intent = randomUUID(), action = 'view', expectedVersion?: number) => api().post(`/api/v1/examples/items/${id}/access-events`).send({action,interactionId:intent,...(expectedVersion ? {expectedVersion} : {})});
 const history = (tab: string, id = itemId, query = '') => api().get(`/api/v1/examples/items/${id}/${tab}${query}`);
 const events = () => db.getRepository(ExampleEvent);
 beforeAll(async () => {
  if (!/^base_template_test_\d+$/.test(database) || database === process.env.DB_DATABASE) throw Error('拒绝非隔离库');
  const config = {host:process.env.DB_HOST,port:Number(process.env.DB_PORT || 3306),user:process.env.DB_USERNAME,password:process.env.DB_PASSWORD,multipleStatements:true};
  connection = await createConnection(config);
  const [old] = await connection.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[database]);
  if ((old as any[]).length) throw Error('测试库已存在，拒绝覆盖');
  await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`); created=true;
  const options = {type:'mysql' as const,...config,username:config.user,database,entities:[ExampleItem,SysDictType,SysDictItem]};
  db = await new DataSource({...options,synchronize:true}).initialize();
  const legacy = await db.getRepository(ExampleItem).save({title:'采集前旧记录',status:'pending',ownerId:7,version:1}); itemId=legacy.id;
  otherId=(await db.getRepository(ExampleItem).save({title:'范围外',status:'pending',ownerId:8,version:1})).id;
  await db.destroy();
  await connection.changeUser({database});
  await connection.query('CREATE TABLE users (id int PRIMARY KEY, display_name varchar(50), username varchar(50), deleted_at datetime NULL)');
  await connection.query("INSERT INTO users VALUES (7,'原操作人','seven',NULL),(8,'其他人','eight',NULL)");
  const migration=readFileSync(resolve('..','docs/sql/20261026-example-document-history.sql'),'utf8');
  await connection.query(migration); await connection.query(migration);
  // User 的快照查询只选 id/displayName/username，但其关联元数据要求 Role/Department/Menu 一并注册。
  db=await new DataSource({...options,entities:[ExampleItem,ExampleEvent,ExampleChange,SysDictType,SysDictItem,User,Role,Department,Menu],synchronize:false}).initialize();
  const dictType=await db.getRepository(SysDictType).save({code:'item_category',name:'类别',status:1});
  await db.getRepository(SysDictItem).save({typeId:dictType.id,value:'a',label:'当时类别',status:1});
  const dict=new DictService(db.getRepository(SysDictType),db.getRepository(SysDictItem),audit as any);
  const service=new ExampleService(db.getRepository(ExampleItem),dict);
  const module=await Test.createTestingModule({controllers:[ExampleController],providers:[{provide:ExampleService,useValue:service},{provide:AuthService,useValue:{getUserAccessCodes:async()=>codes}},{provide:SystemLogService,useValue:audit},{provide:APP_GUARD,useClass:PermissionGuard},{provide:APP_INTERCEPTOR,useClass:AuditInterceptor}]}).compile();
  app=module.createNestApplication<NestExpressApplication>({bodyParser:false});
  app.use((req:any,_res:any,next:()=>void)=>{req.user=user;next()}); configureApplication(app,new ConfigService()); await app.init();
 },30000);
 beforeEach(()=>{codes=['example-items:view'];user={sub:7,roleCode:'user'};audit.write.mockClear()});
 afterAll(async()=>{
  if(db?.isInitialized) {
   const summary=await db.query('SELECT action,result,source,COUNT(*) AS count FROM example_events GROUP BY action,result,source');
   writeFileSync(resolve('..','.scratch/document-history/evidence/http-db-summary.json'),JSON.stringify({database,summary,legacyId:itemId,verifiedAt:new Date().toISOString()},null,2));
   await db.destroy();
  }
  await app?.close();
  if(connection){if(created) await connection.query(`DROP DATABASE \`${database}\``);await connection.end()}
 });
 it('A01/A03/A18/A40 旧数据升级后首次查看，操作可查，其他页为空、内部回读不新增事件，回滚保留表',async()=>{
  const before=await db.getRepository(ExampleItem).findOneByOrFail({id:itemId});
  const intent=randomUUID();const viewed=await access(itemId,intent).expect(201);expect(viewed.body.data.record.title).toBe('采集前旧记录');
  await api().post(`/api/v1/examples/items/${itemId}/access-events/`).send({action:'view',interactionId:intent}).expect(201);
  expect((await history('activity')).body.data.list).toEqual([]);expect((await history('changes')).body.data.list).toEqual([]);
  const operations=(await history('operations')).body.data;expect(operations.list).toHaveLength(1);expect(operations.list[0]).toMatchObject({action:'view',actorName:'原操作人',source:'web'});
  expect(JSON.stringify(operations)).not.toMatch(/requestId|interactionId|ipAddress/);
  await api().get(`/api/v1/examples/items/${itemId}`).expect(200);await history('operations').expect(200);
  expect(await events().count()).toBe(1);expect(await db.getRepository(ExampleItem).findOneByOrFail({id:itemId})).toEqual(before);
  expect(audit.write).not.toHaveBeenCalled();
 });
 it('A02/A04/A05 并发重试、响应丢失后重试幂等，新的打开产生新事件，挪用动作或对象拒绝',async()=>{
  const intent=randomUUID();const before=await events().count();
  const responses=await Promise.all([access(itemId,intent),access(itemId,intent)]);expect(responses.map(r=>r.status)).toEqual([201,201]);expect(responses[0].body.data.eventId).toBe(responses[1].body.data.eventId);
  await access(itemId,intent).expect(201);expect(await events().count()).toBe(before+1);
  await access().expect(201);expect(await events().count()).toBe(before+2);
  const reused=await access(itemId,intent,'print',1);expect(reused.status).toBe(409);expect(reused.body.reason).toBe('intent_reused');
  user={sub:7,roleCode:'user',dataScopes:[{scopeKey:'example-items',scopeType:'all',viewOthers:1}]};
  await access(otherId,intent).expect(409);expect(await events().count()).toBe(before+2);
 });
 it('A06 事件 INSERT 故障时查看失败且零事件，随后同意图重试可用',async()=>{
  const intent=randomUUID(), count=await events().count();
  await connection.query("CREATE TRIGGER fail_view BEFORE INSERT ON example_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected-event-failure'");
  try{await access(itemId,intent).expect(500);expect(await events().count()).toBe(count)}finally{await connection.query('DROP TRIGGER fail_view')}
  await access(itemId,intent).expect(201);expect(await events().count()).toBe(count+1);
 });
 it('A07/A08 仅 view 可 POST，越权字段和未知动作拒绝，范围外及缺失返回相同错误，重试重新鉴权',async()=>{
  const intent=randomUUID();await access(itemId,intent).expect(201);codes=[];await access(itemId,intent).expect(403);
  for(const tab of ['activity','operations','changes'])await history(tab).expect(403);
  codes=['example-items:view'];await access(otherId).expect(404);await access(999999).expect(404);
  for(const tab of ['activity','operations','changes'])await history(tab,otherId).expect(404);
  for(const body of [{action:'create',interactionId:randomUUID()},{action:'view',interactionId:randomUUID(),actorId:8},{action:'view',interactionId:'short'}])await api().post(`/api/v1/examples/items/${itemId}/access-events`).send(body).expect(400);
 });
 it('A33 查询参数严格验证，读取不递归留痕',async()=>{
  const before=await events().count();
  for(const query of ['?action=x','?pageSize=101','?page=0','?from=2026-02-30','?from=2026-10-27&to=2026-10-26','?entity=users','?cursor=x'])await history('operations',itemId,query).expect(400);
  await history('operations',itemId,'?action=view&actorId=7').expect(200);expect(await events().count()).toBe(before);
 });
 it('A09/A10/A11/A16/A17 创建真实身份、多字段一事件、中文快照、长文本、规范化无变化',async()=>{
  codes=['example-items:create','example-items:update','example-items:view'];
  const created=(await api().post('/api/v1/examples/items').send({title:'  新事项  ',category:'a'}).expect(201)).body.data;
  const createdEvent=await events().findBy({itemId:created.id});expect(createdEvent).toHaveLength(1);expect(createdEvent[0]).toMatchObject({action:'create',objectLabel:'新事项'});
  const after=(await api().put(`/api/v1/examples/items/${created.id}`).send({title:'修改事项',status:'doing',category:null,description:'长'.repeat(500),version:1}).expect(200)).body.data;
  expect(after.version).toBe(2);
  const changes=(await history('changes',created.id)).body.data.list;expect(changes).toHaveLength(1);expect(changes[0].changes).toHaveLength(4);
  expect(changes[0].changes).toEqual(expect.arrayContaining([expect.objectContaining({fieldKey:'title',beforeValue:'新事项',afterValue:'修改事项'}),expect.objectContaining({fieldKey:'status',beforeLabel:'待处理',afterLabel:'进行中'}),expect.objectContaining({fieldKey:'category',beforeLabel:'当时类别',afterValue:null})]));
  await connection.query("UPDATE users SET display_name='改名后' WHERE id=7");await db.getRepository(SysDictItem).update({value:'a'},{label:'改名类别'});
  const preserved=(await history('changes',created.id)).body.data.list[0];expect(preserved.actorName).toBe('原操作人');expect(preserved.changes.find(c=>c.fieldKey==='category').beforeLabel).toBe('当时类别');
  const noChange=(await api().put(`/api/v1/examples/items/${created.id}`).send({title:'  修改事项  ',version:2}).expect(200)).body.data;
  expect(noChange.version).toBe(2);expect(new Date(noChange.updatedAt)).toEqual(new Date(after.updatedAt));
  expect((await history('activity',created.id)).body.data.list.map(e=>e.action)).toEqual(['update','create']);expect((await history('changes',created.id)).body.data.list).toHaveLength(1);
  expect(await events().countBy({itemId:created.id,action:'no_change'})).toBe(1);
  await api().put(`/api/v1/examples/items/${created.id}`).send({title:'x',version:2,password:'secret'}).expect(400);
  await connection.query("UPDATE users SET display_name='原操作人' WHERE id=7");
 });
 it('A12 并发更新只有一个成功，缺失版本拒绝，旧值取自事务内当前行',async()=>{
  codes=['example-items:update','example-items:view'];
  const responses=await Promise.all(['甲','乙'].map(title=>api().put(`/api/v1/examples/items/${itemId}`).send({title,version:1})));
  expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
  const updates=await events().findBy({itemId,action:'update'});expect(updates).toHaveLength(1);
  const diff=await db.getRepository(ExampleChange).findOneByOrFail({eventId:updates[0].id,fieldKey:'title'});expect(diff.beforeValue).toBe('采集前旧记录');
  await api().put(`/api/v1/examples/items/${itemId}`).send({title:'无版本'}).expect(400);
  await api().put(`/api/v1/examples/items/${itemId}`).send({title:'旧版本',version:1}).expect(409);
  expect(await events().countBy({itemId,action:'update'})).toBe(1);
 });
 it('A13 创建/修改事件与 diff 故障均整体回滚',async()=>{
  codes=['example-items:create','example-items:update','example-items:view'];
  const before=await db.getRepository(ExampleItem).findOneByOrFail({id:itemId}), count=await events().count(), items=await db.getRepository(ExampleItem).count();
  await connection.query("CREATE TRIGGER fail_write BEFORE INSERT ON example_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected-event-failure'");
  try {
   await api().post('/api/v1/examples/items').send({title:'不应创建'}).expect(500);
   await api().put(`/api/v1/examples/items/${itemId}`).send({title:'应回滚',version:before.version}).expect(500);
  } finally {await connection.query('DROP TRIGGER fail_write')}
  expect(await db.getRepository(ExampleItem).count()).toBe(items);expect(await events().count()).toBe(count);expect(await db.getRepository(ExampleItem).findOneByOrFail({id:itemId})).toEqual(before);
  await connection.query("CREATE TRIGGER fail_diff BEFORE INSERT ON example_changes FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected-diff-failure'");
  try { await api().put(`/api/v1/examples/items/${itemId}`).send({title:'差异失败',version:before.version}).expect(500) } finally {await connection.query('DROP TRIGGER fail_diff')}
  expect(await events().count()).toBe(count);expect(await db.getRepository(ExampleItem).findOneByOrFail({id:itemId})).toEqual(before);
 });
 it('A19/A21/A22/A23 查看资格的版本打印、重复意图、错误版本和权限撤回、故障回滚',async()=>{
  const before=await db.getRepository(ExampleItem).findOneByOrFail({id:itemId}), intent=randomUUID(), count=await events().count();
  const print=(await access(itemId,intent,'print',before.version).expect(201)).body.data;
  expect(print.record).toMatchObject({title:before.title,version:before.version});
  await access(itemId,intent,'print',before.version).expect(201);expect(await events().count()).toBe(count+1);
  expect(await events().findOneByOrFail({id:print.eventId})).toMatchObject({action:'print',result:'accepted',version:before.version});expect(audit.write).not.toHaveBeenCalled();
  const stale=await access(itemId,randomUUID(),'print',before.version-1);expect(stale.status).toBe(409);expect(stale.body.reason).toBe('version_stale');
  codes=[];await access(itemId,intent,'print',before.version).expect(403);codes=['example-items:view'];
  await api().post(`/api/v1/examples/items/${itemId}/access-events`).send({action:'print',interactionId:randomUUID()}).expect(400);
  await connection.query("CREATE TRIGGER fail_print BEFORE INSERT ON example_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected-print-failure'");
  const retry=randomUUID();try{await access(itemId,retry,'print',before.version).expect(500)}finally{await connection.query('DROP TRIGGER fail_print')}
  await access(itemId,retry,'print',before.version).expect(201);await access(itemId,retry,'print',before.version).expect(201);
  expect(await events().count()).toBe(count+2);expect(await db.getRepository(ExampleItem).findOneByOrFail({id:itemId})).toEqual(before);
  expect((await history('activity')).body.data.list.every(e=>!['view','print'].includes(e.action))).toBe(true);
 });
 it('A25/A26/A28/A29 delete-only、范围外、批量部分成功与重复删除，成功历史保留',async()=>{
  const repo=db.getRepository(ExampleItem);
  const own=await repo.save({title:'批量本人',ownerId:7,status:'pending',version:1});
  const peer=await repo.save({title:'允许删除但不允许查看',ownerId:8,status:'pending',version:1});
  const outside=await repo.save({title:'不在范围',ownerId:9,status:'pending',version:1});
  user={sub:7,roleCode:'user',dataScopes:[{scopeKey:'example-items',scopeType:'by_users',targets:[8],viewOthers:0,deleteOthers:1}]};codes=['example-items:delete'];
  await access(peer.id).expect(403);
  const batch=(await api().post('/api/v1/examples/items/batch/remove').send({ids:[own.id,peer.id,outside.id,999999,own.id]}).expect(201)).body.data;
  expect(batch).toMatchObject({successCount:2,total:4,failures:[{id:outside.id,reason:'记录不存在'},{id:999999,reason:'记录不存在'}]});
  const deleted=await events().findBy({batchId:batch.batchId});expect(deleted).toHaveLength(2);expect(deleted.every(e=>e.action==='delete'&&e.actorId===7)).toBe(true);
  expect(await repo.countBy({id:own.id})).toBe(0);expect(await repo.countBy({id:peer.id})).toBe(0);expect(await repo.countBy({id:outside.id})).toBe(1);
  await api().delete(`/api/v1/examples/items/${peer.id}`).expect(404);expect(await events().countBy({itemId:peer.id,action:'delete'})).toBe(1);
  codes=['example-items:view'];for(const tab of ['activity','operations','changes'])await history(tab,peer.id).expect(404);await access(peer.id).expect(404);
 });
 it('A27 删除事件失败整体回滚，不依赖查看权限',async()=>{
  codes=['example-items:delete'];const row=await db.getRepository(ExampleItem).save({title:'删除故障',ownerId:7,status:'pending',version:1});
  await connection.query("CREATE TRIGGER fail_delete BEFORE INSERT ON example_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected-delete-failure'");
  try{await api().delete(`/api/v1/examples/items/${row.id}`).expect(500)}finally{await connection.query('DROP TRIGGER fail_delete')}
  expect(await db.getRepository(ExampleItem).countBy({id:row.id})).toBe(1);expect(await events().countBy({itemId:row.id})).toBe(0);
  await api().delete(`/api/v1/examples/items/${row.id}`).expect(200);expect(await events().countBy({itemId:row.id,action:'delete'})).toBe(1);
 });
 it('A30/A31/A32 真实 Excel 预检零写入，混合成功/验证失败/事件失败逐行事务与来源批次一致',async()=>{
  const buffer=await dataToExcel([{title:'导入成功甲',status:'待处理'},{title:'导入无效',status:'unknown'},{title:'导入写入失败',status:'待处理'},{title:'导入成功乙',status:'进行中'}],[{header:'标题',key:'title'},{header:'状态',key:'status'}]);
  const upload=(route:string)=>api().post(`/api/v1/examples/items/${route}`).attach('file',buffer,{filename:'history.xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const before=await events().count(), items=await db.getRepository(ExampleItem).count();
  codes=['example-items:import'];
  for(let i=0;i<2;i++)expect((await upload('import/precheck').expect(201)).body.data).toMatchObject({total:4,valid:3});
  expect(await events().count()).toBe(before);expect(await db.getRepository(ExampleItem).count()).toBe(items);
  await connection.query("CREATE TRIGGER fail_import BEFORE INSERT ON example_events FOR EACH ROW BEGIN IF NEW.object_label='导入写入失败' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected-import-failure'; END IF; END");
  let result:any;try{result=(await upload('import').expect(201)).body.data}finally{await connection.query('DROP TRIGGER fail_import')}
  expect(result).toMatchObject({imported:2,total:4,errors:[{row:3,message:expect.any(String)},{row:4,message:'导入失败，请稍后重试'}]});
  const imported=await events().findBy({batchId:result.batchId});expect(imported).toHaveLength(2);expect(imported.map(e=>[e.source,e.action,e.rowNumber])).toEqual([['import','create',2],['import','create',5]]);
  expect(await db.getRepository(ExampleItem).count()).toBe(items+2);
  codes=['example-items:view'];const id=imported[0].itemId;await access(id).expect(201);
  expect((await history('activity',id)).body.data.list).toHaveLength(1);expect((await history('changes',id)).body.data.list).toHaveLength(0);expect((await history('operations',id)).body.data.list.map(e=>e.action)).toEqual(['view','create']);
  user={sub:8,roleCode:'user'};for(const tab of ['activity','operations','changes'])await history(tab,id,`?eventId=${imported[0].id}`).expect(404);
 });
 it('A33/A34/A35 稳定游标含微秒及查询上界、表格分页组完整、他单事件定位不泄露',async()=>{
  codes=['example-items:create','example-items:update','example-items:view'];
  const item=(await api().post('/api/v1/examples/items').send({title:'分页事项'}).expect(201)).body.data;
  for(let version=1;version<=25;version++)await api().put(`/api/v1/examples/items/${item.id}`).send({title:`分页${version}`,description:`说明${version}`,version}).expect(200);
  // 日期筛选按北京时间解释；用当天日期避免用例对“编写日”的硬编码依赖。
 const day=new Date(Date.now()+8*3600*1000).toISOString().slice(0,10);
 await connection.query('UPDATE example_events SET occurred_at=? WHERE item_id=?',[`${day} 08:00:00.123456`,item.id]);
  const first=(await history('activity',item.id,'?pageSize=5')).body.data;
  const expected=(await events().find({where:{itemId:item.id},order:{id:'DESC'}})).map(e=>e.id);
  await api().put(`/api/v1/examples/items/${item.id}`).send({title:'上界之后',version:26}).expect(200);
  const all=first.list.map(e=>e.id);let cursor=first.nextCursor;
  while(cursor){const next=(await history('activity',item.id,`?pageSize=5&cursor=${encodeURIComponent(cursor)}`).expect(200)).body.data;all.push(...next.list.map(e=>e.id));cursor=next.nextCursor}
  expect(all).toEqual(expected);expect(new Set(all).size).toBe(expected.length);
  const page1=(await history('changes',item.id,'?pageSize=5')).body.data;
  await api().put(`/api/v1/examples/items/${item.id}`).send({title:'再次新增',version:27}).expect(200);
  const page2=(await history('changes',item.id,`?pageSize=5&page=2&upper=${page1.upper}`)).body.data;
  expect(page2.total).toBe(page1.total);expect(page2.list.every(e=>!page1.list.some(first=>first.id===e.id)&&e.changes.length===2)).toBe(true);
  const located=page2.list[0];expect((await history('changes',item.id,`?eventId=${located.id}`)).body.data.list[0].id).toBe(located.id);
  expect((await history('changes',itemId,`?eventId=${located.id}`)).body.data.list).toEqual([]);
  const filtered=(await history('operations',item.id,`?action=update&actorId=7&from=${day}&to=${day}`)).body.data;
  expect(filtered.total).toBe(27);expect(filtered.list.every(e=>e.action==='update'&&e.actorId===7)).toBe(true);
 });
 it('A17 停用原类别可保留，非法改选拒绝，类型停用仍能清空，旧差异快照不被字典改名改变',async()=>{
  codes=['example-items:create','example-items:update','example-items:view'];
  const item=(await api().post('/api/v1/examples/items').send({title:'字典规则',category:'a'}).expect(201)).body.data;
  await db.getRepository(SysDictItem).update({value:'a'},{status:0});
  await api().put(`/api/v1/examples/items/${item.id}`).send({title:'只改标题',category:'a',version:1}).expect(200);
  await api().put(`/api/v1/examples/items/${item.id}`).send({category:'不存在',version:2}).expect(400);
  await db.getRepository(SysDictType).update({code:'item_category'},{status:0});
  await api().put(`/api/v1/examples/items/${item.id}`).send({category:null,version:2}).expect(200);
  const changes=(await history('changes',item.id)).body.data.list[0].changes;
  expect(changes[0]).toMatchObject({fieldKey:'category',beforeValue:'a',afterValue:null,beforeLabel:'改名类别（已停用）'});
 });
 it('A40 应用回退仅使用旧实体可读旧业务数据，两张历史表及事件保持',async()=>{
  const count=await events().count();
  const rollback=await new DataSource({...db.options,entities:[ExampleItem],synchronize:false}).initialize();
  try{expect((await rollback.getRepository(ExampleItem).findOneByOrFail({id:itemId})).id).toBe(itemId)}finally{await rollback.destroy()}
  expect(await events().count()).toBe(count);expect(await db.getRepository(ExampleChange).count()).toBeGreaterThan(0);
 });
});
