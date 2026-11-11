import {DatabaseSync,backup} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const file=process.env.DB_PATH||path.join(root,'data','agenda.sqlite');
const command=process.argv[2];
if(!['backup','recover-owner','check'].includes(command)){console.log('Uso: node --env-file-if-exists=.env maintenance.mjs backup|check|recover-owner');process.exit(1);}
const db=new DatabaseSync(file,{timeout:5000});
try{
 if(command==='backup'){const targetDir=path.join(path.dirname(file),'backups');mkdirSync(targetDir,{recursive:true});const target=path.join(targetDir,'manual-'+Date.now()+'.sqlite');await backup(db,target);console.log('Backup salvo em: '+target);}
 if(command==='check')console.log(db.prepare('PRAGMA integrity_check').get());
 if(command==='recover-owner'){
   const owner=db.prepare("SELECT id,email FROM users WHERE role='owner'").get();if(!owner)throw Error('Nenhum proprietário cadastrado. Use o primeiro acesso.');
   const key=randomBytes(32).toString('hex');db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE users SET recovery=? WHERE id=?').run(createHash('sha256').update(key).digest('hex'),owner.id);db.prepare('DELETE FROM sessions WHERE userId=?').run(owner.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
   console.log('Conta: '+owner.email+'\nNova chave de recuperação (guarde em local privado):\n'+key+'\n\nAbra o site, clique em Entrar > Recuperar acesso e escolha uma nova senha. A chave anterior foi invalidada.');
 }
}finally{db.close();}
