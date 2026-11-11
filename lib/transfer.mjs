import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { backupTables } from './storage.mjs';

export function readTransfer(file) {
  if(file.endsWith('.json')){
    const data=JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
    if(data.format!=='traco-backup-v1'||!data.tables||!Array.isArray(data.tables.shop))throw Error('Backup JSON não reconhecido.');
    return data;
  }
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    db.exec('BEGIN');
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('O banco de origem não passou na verificação de integridade.');
    const names=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
    if(!names.has('appointments'))throw Error('Atualize primeiro o banco na versão local do aplicativo.');
    const tables={};
    for(const table of backupTables)tables[table]=names.has(table)?db.prepare(`SELECT * FROM ${table}`).all():[];
    tables.media=tables.media.map(row=>({...row,content:{$base64:Buffer.from(row.content).toString('base64')}}));
    for(const shop of tables.shop)for(const key of ['logo','photo']){
      const value=shop[key];if(!/^\/media\/(logo|photo)-[a-f0-9-]+\.(png|jpeg|webp)$/.test(value||''))continue;
      const id=path.basename(value),source=path.join(path.dirname(file),'media',id);
      if(!tables.media.some(r=>r.id===id)&&existsSync(source))tables.media.push({id,mime:'image/'+path.extname(id).slice(1),content:{$base64:readFileSync(source).toString('base64')},created:Date.now()});
    }
    return {format:'traco-backup-v1',createdAt:new Date().toISOString(),tables};
  }finally{db.close();}
}

export async function importTransfer(store,data,{confirmed=false}={}) {
  if(!confirmed)throw Error('Confirme a importação com CONFIRM_IMPORT=sim.');
  if(!store.remote)throw Error('A importação exige TURSO_DATABASE_URL configurada para o banco de destino.');
  if(data.format!=='traco-backup-v1'||!data.tables)throw Error('Formato de backup inválido.');
  const columns={};for(const table of backupTables)columns[table]=new Set((await store.all(`PRAGMA table_info(${table})`)).map(c=>c.name));
  await store.transaction(async()=>{
    if(await store.get('SELECT 1 FROM users LIMIT 1')||await store.get('SELECT 1 FROM appointments LIMIT 1'))throw Error('O destino já contém contas ou reservas. Nada foi substituído.');
    const setup=await store.get("SELECT value FROM meta WHERE key='setup-token'");
    for(const table of [...backupTables].reverse())await store.run(`DELETE FROM ${table}`);
    for(const table of backupTables){
      const rows=data.tables[table]||[];if(!Array.isArray(rows))throw Error('Tabela inválida no backup: '+table);
      const statements=[];
      for(const row of rows){
        if(table==='meta'&&row.key==='setup-token')continue;
        const keys=Object.keys(row);if(!keys.length||keys.some(k=>!columns[table].has(k)))throw Error('Coluna inválida no backup: '+table);
        const args=keys.map(k=>table==='media'&&k==='content'?Buffer.from(row[k].$base64,'base64'):row[k]);
        statements.push({sql:`INSERT INTO ${table}(${keys.map(k=>'"'+k+'"').join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,args});
      }
      for(let i=0;i<statements.length;i+=100)await store.batch(statements.slice(i,i+100));
    }
    if(!(await store.get("SELECT 1 FROM users WHERE role='owner'"))&&setup)await store.run("INSERT OR REPLACE INTO meta VALUES('setup-token',?)",setup.value);
    if((await store.all('PRAGMA foreign_key_check')).length)throw Error('O backup contém referências inválidas. Importação revertida.');
  });
}
