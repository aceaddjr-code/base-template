import { ValidationPipe } from '@nestjs/common';
import { dataToExcel } from '../../common/utils/excel-helper';
import * as XLSX from 'xlsx-js-style';
import { ExampleService } from './example.service';
import { CreateExampleDto, UpdateExampleDto, validateExample } from './example.dto';

// 事务、并发、真实旧值和停用类别保留改由 document-history.mysql.e2e-spec 的业务 HTTP 验证。
// 原来 spy CrudBaseService.update 的断言不能验证本模块事务。
describe('示例事项输入规则', () => {
 const pipe = new ValidationPipe({ transform:true, whitelist:true, forbidNonWhitelisted:true });
 it.each([{}, {title:'   '}, {title:'x'.repeat(101)}, {title:'事项',status:'unknown'}, {title:'事项',status:null}, {title:'事项',description:'x'.repeat(501)}, {title:'事项',ownerId:99}])('HTTP 新增拒绝非法输入 %j', async input => {
  await expect(pipe.transform(input,{type:'body',metatype:CreateExampleDto})).rejects.toThrow();
 });
 it('标题规范化和默认状态，部分更新不重置状态',()=>{
  expect(validateExample({title:'  事项  '})).toMatchObject({title:'事项',status:'pending'});
  expect(validateExample({description:'新说明',version:1},true).status).toBeUndefined();
  expect(()=>validateExample({version:1},true)).toThrow('没有可更新的字段');
 });
 it('页面和服务端修改都强制版本；系统字段不可写',async()=>{
  await expect(pipe.transform({title:'x',version:1},{type:'body',metatype:UpdateExampleDto})).resolves.toBeTruthy();
  for(const input of [{title:'x'}, {title:'x',version:'1'}, {title:null,version:1},{title:'x',version:1,ownerId:8}]) expect(()=>validateExample(input,true)).toThrow();
 });
 it('缺少身份在业务存储之前拒绝',async()=>{
  const service=new ExampleService({} as any);
  await expect(service.create({title:'事项'})).rejects.toThrow('未登录');
  await expect(service.findOne(1)).rejects.toThrow('未登录');
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
