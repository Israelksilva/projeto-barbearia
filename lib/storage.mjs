import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient } from '@libsql/client';
import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { openStore as openSqlite } from './sqlite-store.mjs';

const mediaDDL='CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,mime TEXT NOT NULL,content BLOB NOT NULL,created INTEGER NOT NULL)';
const keysDDL='CREATE TABLE IF NOT EXISTS booking_keys(userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,key TEXT NOT NULL,fingerprint TEXT NOT NULL,bookingId TEXT NOT NULL REFERENCES appointments(id),created INTEGER NOT NULL,PRIMARY KEY(userId,key))';
export const backupTables=['meta','shop','services','staff','users','sessions','resets','verifications','appointments','booking_keys','blocks','outbox','audit','media'];
function mutex(){let tail=Promise.resolve();return async fn=>{let release;const next=new Promise(r=>release=r),prior=tail;tail=next;await prior;try{return await fn();}finally{release();}};}

export async function openStore(filename, options={}) {
  const url=options.url??process.env.TURSO_DATABASE_URL;
  if(process.env.RENDER==='true'&&!url)throw Error('Configure TURSO_DATABASE_URL e TURSO_AUTH_TOKEN antes de publicar na Render. O disco gratuito não preserva dados.');
  if(!url){
    const original=openSqlite(filename), lock=mutex(), context=new AsyncLocalStorage();
    original.run(mediaDDL);original.run(keysDDL);
    const inside=fn=>context.getStore()?Promise.resolve().then(fn):lock(fn);
    const store={...original,remote:false,backupFormat:'sqlite',
      get:(...args)=>inside(()=>original.get(...args)),
      all:(...args)=>inside(()=>original.all(...args)),
      run:(...args)=>inside(()=>original.run(...args)),
      batch:statements=>inside(()=>statements.map(s=>original.run(s.sql,...s.args))),
      transaction:fn=>context.getStore()?fn():lock(()=>context.run(true,async()=>{original.db.exec('BEGIN IMMEDIATE');try{const value=await fn();original.db.exec('COMMIT');return value;}catch(e){original.db.exec('ROLLBACK');throw e;}})),
      snapshot:()=>lock(()=>original.snapshot()),close:()=>inside(()=>original.db.close())
    };
    return store;
  }
  const localTest=process.env.NODE_ENV==='test'&&url.startsWith('file:');
  if(!localTest&&!/^libsql:\/\/[^/]+$/.test(url))throw Error('TURSO_DATABASE_URL deve usar libsql:// com o endereço do banco, sem caminho.');
  const authToken=options.authToken??process.env.TURSO_AUTH_TOKEN;
  if(!localTest&&!authToken)throw Error('Configure TURSO_AUTH_TOKEN no servidor.');
  const client=createClient({url,authToken,concurrency:10}),context=new AsyncLocalStorage();
  const directory=path.dirname(filename);mkdirSync(directory,{recursive:true});
  const executor=()=>context.getStore()||client;
  const execute=(sql,...args)=>executor().execute({sql,args});
  const get=async(sql,...args)=>(await execute(sql,...args)).rows[0];
  const all=async(sql,...args)=>(await execute(sql,...args)).rows;
  const run=async(sql,...args)=>{const result=await execute(sql,...args);return {changes:result.rowsAffected,lastInsertRowid:result.lastInsertRowid};};
  async function transaction(fn,mode='write') {
    if(context.getStore())return fn();
    for(let attempt=0;;attempt++){
      let tx;
      try{tx=await client.transaction(mode);return await context.run(tx,async()=>{try{const result=await fn();await tx.commit();return result;}catch(e){try{await tx.rollback();}catch{}throw e;}});}
      catch(error){if(attempt>=3||!String(error.code).includes('SQLITE_BUSY'))throw error;await new Promise(r=>setTimeout(r,50*2**attempt));}
      finally{tx?.close();}
    }
  }
  const schema=readFileSync(new URL('./schema.sql',import.meta.url),'utf8').split(';').map(s=>s.trim()).filter(Boolean);
  await client.execute('PRAGMA foreign_keys=ON');
  await client.batch([...schema,mediaDDL,keysDDL],'write');
  await transaction(async()=>{
    await run("INSERT OR IGNORE INTO services VALUES('corte','Corte de cabelo','Corte, acabamento e finalização para o seu estilo.',4500,30,1)");
    await run("INSERT OR IGNORE INTO services VALUES('barba','Barba & cuidado','Desenho, alinhamento e cuidado com os detalhes.',3500,30,1)");
    await run("INSERT OR IGNORE INTO services VALUES('combo','Corte + barba','O ritual completo para renovar o visual.',7000,60,1)");
    await run("INSERT OR IGNORE INTO staff(id,name,bio) VALUES('principal','Profissional principal','Especialista em bons cortes e boas conversas.')");
    if(!(await get("SELECT 1 FROM users WHERE role='owner'"))&&!(await get("SELECT 1 FROM meta WHERE key='setup-token'"))){
      const token=options.setupToken??process.env.SETUP_TOKEN;
      if(!token||token.length<32||token.length>128)throw Error('Defina SETUP_TOKEN com 32 a 128 caracteres aleatórios antes do primeiro acesso.');
      await run("INSERT INTO meta VALUES('setup-token',?)",token);
    }
  });
  const store={get,all,run,transaction,directory,remote:true,backupFormat:'json',setupPath:null,
    batch:statements=>context.getStore()?executor().batch(statements):client.batch(statements,'write'),
    close:async()=>client.close(),db:{close:()=>client.close()}
  };
  let backupRunning=false;
  store.snapshot=async()=>{
    if(backupRunning)return null;backupRunning=true;
    const target=path.join(directory,`traco-backup-${Date.now()}-${randomBytes(4).toString('hex')}.json`);
    try{
      await transaction(async()=>{
        writeFileSync(target,JSON.stringify({format:'traco-backup-v1',createdAt:new Date().toISOString()}).slice(0,-1)+',"tables":{',{mode:0o600});
        let tableIndex=0;
        for(const table of backupTables){
          appendFileSync(target,(tableIndex++?',':'')+JSON.stringify(table)+':[');let cursor=0,index=0;
          for(;;){const rows=await all(`SELECT rowid AS __cursor,* FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT 250`,cursor);if(!rows.length)break;
            for(const row of rows){cursor=Number(row.__cursor);const value={...row};delete value.__cursor;if(table==='media')value.content={$base64:Buffer.from(value.content).toString('base64')};appendFileSync(target,(index++?',':'')+JSON.stringify(value,(_,v)=>typeof v==='bigint'?Number(v):v));}
          }
          appendFileSync(target,']');
        }
        appendFileSync(target,'}}');
      },'read');
      return target;
    }finally{backupRunning=false;}
  };
  return store;
}
