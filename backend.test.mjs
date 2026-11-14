import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
for(const mode of ['sqlite','libsql','production']) test('integração 3.1: '+mode,async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'barbearia-backend-')),port=43000+Math.floor(Math.random()*10000),origin='http://127.0.0.1:'+port;
 const token='test-setup-token-012345678901234567890123456789';
 let processLog='';const child=spawn(process.execPath,['server.mjs'],{cwd:import.meta.dirname,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DB_PATH:path.join(dir,'agenda.sqlite'),NODE_ENV:mode==='production'?'production':'test',PUBLIC_URL:mode==='production'?'https://barbearia.example.test':'',RENDER:'',RENDER_EXTERNAL_URL:'',TURSO_DATABASE_URL:mode==='libsql'?pathToFileURL(path.join(dir,'external.sqlite')).href:'',TURSO_AUTH_TOKEN:'',SETUP_TOKEN:token,RESEND_API_KEY:'',EMAIL_FROM:'',DISABLE_BACKUPS:'1'},stdio:['ignore','pipe','pipe']});
 child.stderr.on('data',d=>processLog+=d);
 function client(){let cookie='';return {async call(route,method='GET',body,key){const r=await fetch(origin+'/api/'+route,{method,headers:{origin:mode==='production'?'https://barbearia.example.test':origin,'Content-Type':'application/json',...(cookie?{cookie}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,data:await r.json()};}};}
 const owner=client(),customer=client(),other=client(),anon=client();
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error(processLog)}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Servidor não iniciou')),10000).unref())]);
  const setup=mode==='libsql'?token:readFileSync(path.join(dir,'PRIMEIRO-ACESSO.txt'),'utf8').match(/Código de instalação: (\w+)/)[1];
  const password='Senha ficticia de teste 2026!';
  assert.equal((await owner.call('auth/setup','POST',{token:setup,name:'Proprietário Fictício',email:'owner@example.test',password})).status,201);
  if(mode==='production')await t.test('produção bloqueia cadastro até o proprietário liberar',async()=>{
    assert.equal((await anon.call('catalog')).data.acceptingBookings,false);
    assert.equal((await anon.call('auth/register','POST',{name:'Cliente',email:'blocked@example.test',password,privacy:true})).status,503);
    assert.equal((await owner.call('admin/legal','PUT',{enabled:true})).status,400);
    assert.equal((await owner.call('admin/legal','PUT',{enabled:true,operatorName:'Empresa Fictícia',address:'Endereço fictício de testes',privacyEmail:'privacy@example.test',retention:'Critérios fictícios de retenção somente para testes.'})).status,200);
    assert.equal((await anon.call('catalog')).data.acceptingBookings,true);
  });
  for(const [c,name] of [[customer,'cliente'],[other,'outro']])assert.equal((await c.call('auth/register','POST',{name,email:name+'@example.test',password,privacy:true})).status,201);
  let d=new Date(Date.now()+7*864e5);while(d.getUTCDay()===0)d=new Date(+d+864e5);const date=d.toISOString().slice(0,10);
  const payload={service:'corte',staff:'principal',date,time:'10:00',phone:'71999999999',price:1,duration:1};
  let id;
  await t.test('alias exige sessão e calcula preço/duração no servidor',async()=>{assert.equal((await anon.call('booking-requests','POST',payload,'request-key-00000001')).status,401);const r=await customer.call('booking-requests','POST',payload,'request-key-00000001');assert.equal(r.status,201);assert.equal(r.data.status,'confirmed');assert.equal(r.data.price,4500);assert.equal(r.data.duration,30);id=r.data.id;});
  await t.test('repetição concorrente retorna a mesma reserva sem novo registro',async()=>{const replies=await Promise.all(Array.from({length:3},()=>customer.call('booking-requests','POST',payload,'request-key-00000001')));assert.ok(replies.every(r=>r.status===200&&r.data.id===id&&r.data.replayed));assert.equal((await customer.call('bookings')).data.length,1);});
  await t.test('chave não pode ser reutilizada para outro pedido',async()=>{assert.equal((await customer.call('booking-requests','POST',{...payload,time:'11:00'},'request-key-00000001')).status,409);assert.equal((await other.call('booking-requests','POST',payload,'request-key-00000001')).status,409);assert.equal((await other.call('booking-requests','POST',{...payload,time:'13:00'},'request-key-00000001')).status,201);});
  await t.test('cancelamento não recria reserva em retry',async()=>{assert.equal((await customer.call('bookings/'+id,'DELETE',{})).status,200);const retry=await customer.call('booking-requests','POST',payload,'request-key-00000001');assert.equal(retry.status,200);assert.equal(retry.data.status,'cancelled');assert.equal((await customer.call('bookings')).data.length,1);});
  await t.test('perfil só pode ser liberado pelo proprietário com dados mínimos',async()=>{assert.equal((await customer.call('admin/legal','PUT',{})).status,403);assert.equal((await owner.call('admin/legal','PUT',{enabled:true})).status,400);const profile={enabled:true,operatorName:'Empresa Fictícia para Testes',businessId:'EXEMPLO',address:'Endereço fictício para teste',privacyEmail:'privacy@example.test',retention:'Política fictícia de retenção, apenas para testes automatizados.'};assert.equal((await owner.call('admin/legal','PUT',profile)).status,200);assert.equal((await anon.call('legal')).data.operatorName,profile.operatorName);assert.equal((await anon.call('catalog')).data.legal.enabled,true);});
  await t.test('página operacional serve arquivos e nunca banco/configuração privada',async()=>{for(const file of ['/','/admin','/site.css','/legal.js','/termos','/privacidade'])assert.equal((await fetch(origin+file)).status,200,file);for(const file of ['/.env','/data/agenda.sqlite','/package.json','/frontend/config.js'])assert.equal((await fetch(origin+file)).status,404,file);const home=await (await fetch(origin)).text();assert.ok(home.includes('/app.js')&&home.includes('operation-notice'));});
 }finally{if(child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}try{rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100})}catch{}}
});
