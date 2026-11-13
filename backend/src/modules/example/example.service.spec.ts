import { ValidationPipe } from '@nestjs/common';
import { dataToExcel } from '../../common/utils/excel-helper';
import * as XLSX from 'xlsx-js-style';
import { CrudBaseService } from '../../common/services/crud-base.service';
import { ExampleService } from './example.service';
import { CreateExampleDto, UpdateExampleDto, validateExample } from './example.dto';
import { ExampleItem } from './example-item.entity';
import { ExampleItemMember } from './example-member.entity';
import { ExampleReservedNumber } from './example-recycle.entity';
import { User } from '../user/user.entity';

// 事务、并发、真实旧值和停用类别保留改由 document-history.mysql.e2e-spec 的业务 HTTP 验证。
// 原来 spy CrudBaseService.update 的断言不能验证本模块事务。
describe('示例事项输入规则', () => {
 const pipe = new ValidationPipe({ transform:true, whitelist:true, forbidNonWhitelisted:true });
 it.each([{}, {title:'   '}, {title:'x'.repeat(101)}, {title:'事项',status:'unknown'}, {title:'事项',status:null}, {title:'事项',description:'x'.repeat(501)}, {title:'事项',remark:'x'.repeat(501)}, {title:'事项',ownerId:99}])('HTTP 新增拒绝非法输入 %j', async input => {
  await expect(pipe.transform(input,{type:'body',metatype:CreateExampleDto})).rejects.toThrow();
 });
 it('标题规范化和默认状态，部分更新不重置状态',()=>{
  expect(validateExample({title:'  事项  '})).toMatchObject({title:'事项',status:'pending'});
  expect(validateExample({title:'事项',remark:'  备注  '})).toMatchObject({remark:'备注'});
  expect(validateExample({description:'新说明',version:1},true).status).toBeUndefined();
  expect(()=>validateExample({version:1},true)).toThrow('没有可更新的字段');
 });
 it('页面和服务端修改都强制版本；系统字段不可写',async()=>{
  await expect(pipe.transform({title:'x',version:1},{type:'body',metatype:UpdateExampleDto})).resolves.toBeTruthy();
  for(const input of [{title:'x'}, {title:'x',version:'1'}, {title:null,version:1},{title:'x',version:1,ownerId:8}]) expect(()=>validateExample(input,true)).toThrow();
 });
 it('单据编号由系统生成，客户端提交被白名单拒绝',async()=>{
  await expect(pipe.transform({title:'事项',docNo:'EX-20261102-999'},{type:'body',metatype:CreateExampleDto})).rejects.toThrow();
 });
 it('缺少身份在业务存储之前拒绝',async()=>{
  const service=new ExampleService({} as any);
  await expect(service.create({title:'事项'})).rejects.toThrow('未登录');
  await expect(service.findOne(1)).rejects.toThrow('未登录');
 });
});

describe('单据编号生成与创建写入',()=>{
 function fixture(maxSeq: number | string | null) {
  const saved: any[] = [];
  const events: any[] = [];
  const itemRepo = {
   createQueryBuilder: () => ({
    withDeleted() { return this; },
    where() { return this; },
    select() { return this; },
    getRawOne: async () => ({ maxSeq }),
   }),
   save: async (data: any) => { saved.push(data); return { id:7, version:1, createdAt:new Date(), updatedAt:new Date(), ...data }; },
  };
  const manager = {
   getRepository: (entity: any) => entity === ExampleItem || entity === ExampleReservedNumber ? itemRepo
    : entity === User ? { findOne: async () => ({ id:1, displayName:'张三', username:'zhang' }) }
    : { save: async (data: any) => { events.push(data); return { id:9, ...data }; } },
   transaction: async (cb:(m:any)=>Promise<any>) => cb(manager),
  };
  return { service:new ExampleService({ manager } as any), saved, events };
 }
 it('创建时生成当日编号，默认归属创建人并记录创建事件',async()=>{
  const { service, saved, events } = fixture(null);
  const item = await service.create({ title:'事项' }, 1, { sub:1 } as any);
  expect(item.docNo).toMatch(/^EX-\d{8}-001$/);
  expect(saved[0]).toMatchObject({ title:'事项', remark:null, docNo:item.docNo, version:1, ownerId:1, createdBy:1 });
  expect(events[0]).toMatchObject({ action:'create', actorId:1, actorName:'张三' });
 });
 it('编号按当日最大流水递增；备注规范化为空值或去空格',async()=>{
  const { service, saved } = fixture(2);
  const item = await service.create({ title:'事项', remark:' 备注 ' }, 1, { sub:1 } as any);
  expect(item.docNo?.endsWith('-003')).toBe(true);
  expect(saved[0]).toMatchObject({ remark:'备注' });
  const empty = await fixture(null).service.create({ title:'事项', remark:'' }, 1, { sub:1 } as any);
  expect(empty.remark).toBeNull();
 });
});

describe('示例导入预检与字典翻译',()=>{
 const options=[{label:'类别甲',value:'cat-a',status:1},{label:'类别乙',value:'cat-old',status:0}];
 function fixture(){
  // 与真实 DictService.getLabelBook 同语义的轻量实现：值↔显示名双向翻译，停用加后缀
  const dict={getValueStatus:async(_code:string,value:string)=>{const item=options.find(o=>o.value===value);return !item?'unknown':item.status===1?'enabled':'disabled'},
   getLabelBook:async()=>({display:(value:string)=>{const item=options.find(o=>o.value===value);return item?(item.status===1?item.label:`${item.label}（已停用）`):undefined},
    valueOf:(text:string)=>options.find(o=>o.value===text||o.label===text||(o.status!==1&&`${o.label}（已停用）`===text))?.value})};
  return new ExampleService({} as any,dict as any);
 }
 const buffer=(rows:any[])=>dataToExcel(rows,[{header:'标题',key:'title'},{header:'状态',key:'status'},{header:'类别',key:'category'}]);
 it('模板表头与真实导入列一致',async()=>{
  const workbook=XLSX.read(await fixture().importTemplateBuffer(),{type:'buffer'});
  expect(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1})[0]).toEqual(['标题','状态','类别','说明','备注']);
 });
 it('展示标签和内部值均可预检，停用和未知值逐行报错，预检不需要写仓储',async()=>{
  const result=await fixture().importPreview(await buffer([{title:'标签',status:'待处理',category:'类别甲'},{title:'内部值',status:'pending',category:'cat-a'},{title:'停用',status:'待处理',category:'类别乙'},{title:'未知',category:'不存在'},{title:'状态错误',status:'unknown'}]),1,{sub:1});
  expect(result).toMatchObject({total:5,valid:2});
  expect(result.errors).toEqual([{row:4,message:'该类别已停用，请重新选择'},{row:5,message:'类别不存在或已删除，请重新选择'},{row:6,message:'状态必须为 pending、doing 或 done'}]);
 });
 it('新增停用类别提供结构化字段错误',async()=>{
  await expect(fixture().create({title:'事项',category:'cat-old'},1,{sub:1})).rejects.toMatchObject({response:{fieldErrors:[{path:'category',code:'dict-disabled',message:'该类别已停用，请重新选择'}]}});
 });
});

describe('导出行投影（与列表列设置勾选项同键对齐）',()=>{
 afterEach(()=>jest.restoreAllMocks());
 it('负责人/创建人/团队成员投影为姓名（displayName 优先），时间转 Date，状态与类别翻译展示标签',async()=>{
  const rows=[
   {id:1,status:'pending',category:'cat-a',ownerId:1,createdBy:2,createdAt:'2026-01-02T03:04:05Z',updatedAt:'2026-01-03T00:00:00Z'},
   {id:2,status:'doing',category:null,ownerId:null,createdBy:2,createdAt:null,updatedAt:null},
  ];
  jest.spyOn(CrudBaseService.prototype as any,'getExportRows').mockResolvedValue(rows);
  const users=[{id:1,displayName:'张三',username:'zhang'},{id:2,displayName:'',username:'li'}];
  const members=[{itemId:1,userId:2},{itemId:1,userId:1}];
  const manager={getRepository:(entity:any)=>entity===User?{find:async()=>users}
   :entity===ExampleItemMember?{find:async()=>members}
   :{}};
  const dict={getLabelBook:async()=>({display:(value:string)=>value==='cat-a'?'类别甲':undefined})};
  const result=await (new ExampleService({manager} as any,dict as any) as any).getExportRows({sub:1},{});
  expect(result[0]).toMatchObject({status:'待处理',category:'类别甲',ownerId:'张三',memberIds:'li、张三',createdBy:'li'});
  expect(result[0].createdAt).toBeInstanceOf(Date);
  expect(result[0].updatedAt).toBeInstanceOf(Date);
  expect(result[1]).toMatchObject({category:'',ownerId:'',memberIds:'',createdBy:'li',createdAt:null});
 });
});
