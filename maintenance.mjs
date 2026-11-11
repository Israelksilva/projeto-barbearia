import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {openStore} from './lib/db.mjs';
import {hash} from './lib/security.mjs';
import {readTransfer,importTransfer} from './lib/transfer.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),command=process.argv[2];
if(!['backup','recover-owner','check','import'].includes(command)){console.log('Uso: node --env-file-if-exists=.env maintenance.mjs backup|check|recover-owner|import [arquivo]');process.exit(1);}
const store=await openStore(process.env.DB_PATH||path.join(root,'data','agenda.sqlite'));
try{
 if(command==='check'){await store.get('SELECT 1 AS ok');if((await store.all('PRAGMA foreign_key_check')).length)throw Error('Há referências inválidas.');console.log(`Conexão verificada (${store.remote?'Turso/libSQL':'SQLite local'}).`);}
 if(command==='backup')console.log('Backup salvo em: '+await store.snapshot());
 if(command==='import'){if(!process.argv[3])throw Error('Informe o arquivo SQLite ou JSON de origem.');await importTransfer(store,readTransfer(path.resolve(process.argv[3])),{confirmed:process.env.CONFIRM_IMPORT==='sim'});console.log('Importação concluída.');}
 if(command==='recover-owner'){
  const owner=await store.get("SELECT id,email FROM users WHERE role='owner'");if(!owner)throw Error('Nenhum proprietário cadastrado. Use o primeiro acesso.');
  const key=randomBytes(32).toString('hex');await store.transaction(async()=>{await store.run('UPDATE users SET recovery=? WHERE id=?',hash(key),owner.id);await store.run('DELETE FROM sessions WHERE userId=?',owner.id);});
  console.log(`Conta: ${owner.email}\nNova chave de recuperação (mantenha privada):\n${key}\n\nEntre em Recuperar acesso no site. A chave anterior foi invalidada.`);
 }
}finally{await store.close();}
