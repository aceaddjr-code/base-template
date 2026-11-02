import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const backend = createHttpServer((req,res)=>{req.resume();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({host:req.headers.host,origin:req.headers.origin}));});
backend.listen(0,'127.0.0.1'); await once(backend,'listening');
process.env.VITE_PROXY_TARGET=`http://127.0.0.1:${backend.address().port}`;
const {createServer}=await import(pathToFileURL(resolve('node_modules/vite/dist/node/index.js')).href);
let vite;
try {
  vite=await createServer({configFile:resolve('vite.config.ts'),server:{port:0,host:'127.0.0.1'},logLevel:'error'});await vite.listen();
  const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
  const form=new FormData();form.append('file',new Blob(['test']),'test.txt');
  const response=await fetch(origin+'/api/v1/attachments',{method:'POST',headers:{Origin:origin,Referer:origin+'/'},body:form});
  const result=await response.json();const expected=new URL(origin).host;
  console.log(JSON.stringify({expectedHost:expected,forwardedHost:result.host,origin:result.origin,pass:result.host===expected}));
  if(result.host!==expected)process.exitCode=1;
} finally {await vite?.close();await new Promise(resolve=>backend.close(resolve));}
