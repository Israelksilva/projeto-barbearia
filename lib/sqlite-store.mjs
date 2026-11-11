import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync, readdirSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export function openStore(filename) {
  const directory = path.dirname(filename);
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(filename, { timeout: 5000 });
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS shop(id INTEGER PRIMARY KEY CHECK(id=1),name TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT 'Cuidado nos detalhes, personalidade no resultado.',logo TEXT NOT NULL DEFAULT '',photo TEXT NOT NULL DEFAULT '',cancelHours INTEGER NOT NULL DEFAULT 2);
    INSERT OR IGNORE INTO shop(id,name,logo) VALUES(1,'Barbearia Teste','/assets/logo-barbearia.png');
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password TEXT NOT NULL,recovery TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('owner','customer')),created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS resets(hash TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS verifications(hash TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS services(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>=0),duration INTEGER NOT NULL CHECK(duration>0),active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS staff(id TEXT PRIMARY KEY,name TEXT NOT NULL,bio TEXT NOT NULL DEFAULT '',days TEXT NOT NULL DEFAULT '1,2,3,4,5,6',start INTEGER NOT NULL DEFAULT 540,end INTEGER NOT NULL DEFAULT 1080,breakStart INTEGER,breakEnd INTEGER,active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS appointments(id TEXT PRIMARY KEY,userId TEXT REFERENCES users(id),legacyOwner TEXT,staffId TEXT NOT NULL REFERENCES staff(id),serviceId TEXT NOT NULL REFERENCES services(id),serviceName TEXT NOT NULL,staffName TEXT NOT NULL,price INTEGER NOT NULL,duration INTEGER NOT NULL,name TEXT NOT NULL,phone TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',date TEXT NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','completed','cancelled','no_show')),created INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS appointments_slot ON appointments(staffId,date,start,end,status);
    CREATE INDEX IF NOT EXISTS appointments_user ON appointments(userId,date);
    CREATE TABLE IF NOT EXISTS blocks(id TEXT PRIMARY KEY,staffId TEXT NOT NULL REFERENCES staff(id),date TEXT NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,reason TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,bookingId TEXT REFERENCES appointments(id),kind TEXT NOT NULL,recipient TEXT NOT NULL,subject TEXT NOT NULL,message TEXT NOT NULL,due INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,lastError TEXT NOT NULL DEFAULT '',sent INTEGER);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,created INTEGER NOT NULL);
  `);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  if (!all('PRAGMA table_info(users)').some(c=>c.name==='emailVerified')) db.exec('ALTER TABLE users ADD COLUMN emailVerified INTEGER NOT NULL DEFAULT 0');
  function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  if (!get("SELECT 1 FROM meta WHERE key='seed-v2'")) transaction(() => {
    run("INSERT OR IGNORE INTO services VALUES('corte','Corte de cabelo','Corte, acabamento e finalização para o seu estilo.',4500,30,1)");
    run("INSERT OR IGNORE INTO services VALUES('barba','Barba & cuidado','Desenho, alinhamento e cuidado com os detalhes.',3500,30,1)");
    run("INSERT OR IGNORE INTO services VALUES('combo','Corte + barba','O ritual completo para renovar o visual.',7000,60,1)");
    run("INSERT OR IGNORE INTO staff(id,name,bio) VALUES('principal','Profissional principal','Especialista em bons cortes e boas conversas.')");
    if (get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings'")) {
      const old = get('SELECT name,phone FROM settings WHERE id=1');
      if (old) run('UPDATE shop SET name=?,phone=? WHERE id=1', old.name, old.phone);
    }
    if (get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='bookings'")) {
      for (const b of all('SELECT * FROM bookings')) {
        const service = get('SELECT * FROM services WHERE id=?', b.service) || get("SELECT * FROM services WHERE id='corte'");
        const [h,m] = b.time.split(':').map(Number), start = h * 60 + m;
        run('INSERT OR IGNORE INTO appointments(id,legacyOwner,staffId,serviceId,serviceName,staffName,price,duration,name,phone,date,start,end,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', b.id,b.owner,'principal',service.id,service.name,'Profissional principal',service.price,30,b.name,b.phone,b.date,start,start+30,Date.now());
      }
    }
    run("INSERT INTO meta VALUES('seed-v2','1')");
  });
  const setupPath = path.join(directory, 'PRIMEIRO-ACESSO.txt');
  if (!get("SELECT 1 FROM users WHERE role='owner'") && !get("SELECT 1 FROM meta WHERE key='setup-token'")) {
    const token = randomBytes(24).toString('hex');
    run("INSERT INTO meta VALUES('setup-token',?)", token);
    writeFileSync(setupPath, `TRAÇO — PRIMEIRO ACESSO\n\nAbra /admin no endereço do site.\nCódigo de instalação: ${token}\n\nUse este código uma única vez para criar o acesso do proprietário.\nNão compartilhe este arquivo nem inclua a pasta data no pacote de venda.\n`, { mode: 0o600 });
  }
  let backupRunning = false;
  async function snapshot() {
    if (backupRunning) return null;
    backupRunning = true;
    const targetDir = path.join(directory,'backups'); mkdirSync(targetDir,{recursive:true});
    const target = path.join(targetDir, `agenda-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomBytes(3).toString('hex')}.sqlite`);
    try {
      await backup(db, target);
      const files = readdirSync(targetDir).filter(f=>f.endsWith('.sqlite')).sort().reverse();
      for (const file of files.slice(14)) unlinkSync(path.join(targetDir,file));
      return target;
    } finally { backupRunning = false; }
  }
  return { db,get,all,run,transaction,directory,setupPath,snapshot,readBackup: readFileSync,hasFile: existsSync };
}
