import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { hash } from './lib/security.mjs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { openStore } from './lib/db.mjs';
import { queueEmail, makeMessageWorker } from './lib/messages.mjs';
const nextDate = () => { let d = new Date(Date.now() + 4 * 864e5); while (d.getUTCDay() === 0)
    d = new Date(+d + 864e5); return d.toISOString().slice(0, 10); };
for (const mode of ['sqlite','libsql']) test('sistema comercial: '+mode, async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'traco-integracao-')), dbPath = path.join(dir, 'agenda.sqlite');
    const port = 32000 + Math.floor(Math.random() * 10000), origin = `http://127.0.0.1:${port}`;
    let child, logs = '', generation=0;
    async function start() { child = spawn(process.execPath, ['server.mjs'], { cwd: import.meta.dirname, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH:mode==='libsql'?path.join(dir,'cache-'+generation,'agenda.sqlite'):dbPath, TURSO_DATABASE_URL:mode==='libsql'?pathToFileURL(dbPath).href:'', TURSO_AUTH_TOKEN:'', SETUP_TOKEN:'test-setup-token-012345678901234567890123456789',RENDER:'',RENDER_EXTERNAL_URL:'', NODE_ENV: 'test', PUBLIC_URL: '', RESEND_API_KEY: '', EMAIL_FROM: '', DISABLE_BACKUPS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }); child.stderr.on('data', d => logs += d); await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw Error('Servidor não iniciou: ' + logs); }), new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('Timeout: ' + logs)), 10000); timer.unref(); })]); }
    async function stop() { if (child?.exitCode !== null)
        return; const exited = once(child, 'exit'); child.kill(); await exited; }
    function client() { let cookie = ''; return { get cookie() { return cookie; }, async call(route, method = 'GET', body, headers = {}) { const r = await fetch(origin + '/api/' + route, { method, headers: { origin, 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); const set = r.headers.get('set-cookie'); if (set)
            cookie = set.split(';')[0]; const content = r.headers.get('content-type') || ''; return { status: r.status, headers: r.headers, data: content.includes('json') ? await r.json() : content.includes('csv') ? await r.text() : Buffer.from(await r.arrayBuffer()) }; } }; }
    const owner = client(), alice = client(), bob = client(), anonymous = client();
    let recovery, aliceId, secondStaff, bookingId;
    const date = nextDate(), password = 'Senha de teste muito segura 123!';
    try {
        await start();
        await t.test('primeiro acesso exige código e encerra após cadastrar proprietário', async () => { assert.equal((await anonymous.call('admin/catalog')).status, 401); assert.equal((await owner.call('auth/setup', 'POST', { token: 'errado' })).status, 403); const token = mode==='libsql'?'test-setup-token-012345678901234567890123456789':readFileSync(path.join(dir, 'PRIMEIRO-ACESSO.txt'), 'utf8').match(/Código de instalação: (\w+)/)[1]; const setup = await owner.call('auth/setup', 'POST', { token, name: 'Proprietário Teste', email: 'owner@example.test', password }); assert.equal(setup.status, 201, JSON.stringify(setup.data)); assert.equal(setup.data.user.role, 'owner'); assert.ok(setup.headers.get('set-cookie').includes('HttpOnly')); assert.equal((await anonymous.call('auth/setup', 'POST', { token })).status, 409); });
        await t.test('cadastro, sessão e isolamento de papéis', async () => { const a = await alice.call('auth/register', 'POST', { name: 'Cliente Alice', email: 'alice@example.test', password, privacy: true }); assert.equal(a.status, 201); recovery = a.data.recoveryKey; aliceId = a.data.user.id; assert.equal((await bob.call('auth/register', 'POST', { name: 'Cliente Bob', email: 'bob@example.test', password, privacy: true })).status, 201); assert.equal((await alice.call('admin/settings', 'PUT', { name: 'Invasão' })).status, 403); assert.equal((await alice.call('auth/login', 'POST', { email: 'alice@example.test', password: 'senha errada' })).status, 401); assert.equal((await alice.call('auth/me')).data.user.id, aliceId); });
        await t.test('proteção de origem e validação', async () => { assert.equal((await owner.call('admin/settings', 'PUT', {}, { origin: 'https://site-malicioso.test' })).status, 403); assert.equal((await owner.call('admin/services', 'POST', { name: 'Inválido', price: 100, duration: 17 })).status, 400); assert.equal((await owner.call('admin/settings', 'PUT', { name: 'Traço Teste', phone: '5511999999999', address: 'Rua de Teste, 100', description: 'Barbearia de teste', cancelHours: 2 })).status, 200); assert.equal((await anonymous.call('catalog')).data.settings.name, 'Traço Teste'); });
        await t.test('equipe e serviços com duração variável', async () => { const s = await owner.call('admin/staff', 'POST', { name: 'Segundo barbeiro', bio: 'Teste', days: '1,2,3,4,5,6', start: '09:00', end: '18:00', breakStart: '12:00', breakEnd: '13:00', active: true }); assert.equal(s.status, 201, JSON.stringify(s.data)); secondStaff = s.data.id; const catalog = (await owner.call('admin/catalog')).data; assert.equal(catalog.staff.length, 2); assert.equal(catalog.services.find(x => x.id === 'combo').duration, 60); const slots = await alice.call('slots?' + new URLSearchParams({ staff: secondStaff, service: 'combo', date })); assert.ok(!slots.data.slots.includes('11:15')); assert.ok(slots.data.slots.includes('11:00')); assert.ok(!slots.data.slots.includes('12:00')); });
        const payload = { service: 'combo', staff: 'principal', date, time: '10:00', phone: '11999999999' };
        await t.test('concorrência e sobreposição de serviços', async () => { const result = await Promise.all([alice.call('bookings', 'POST', payload), bob.call('bookings', 'POST', payload)]); assert.deepEqual(result.map(x => x.status).sort(), [201, 409], JSON.stringify(result)); bookingId = result.find(x => x.status === 201).data.id; if (result[0].status !== 201) {
            await owner.call('admin/bookings/' + bookingId, 'DELETE', {});
            const created = await alice.call('bookings', 'POST', payload);
            assert.equal(created.status, 201);
            bookingId = created.data.id;
        } assert.equal((await bob.call('bookings', 'POST', { ...payload, service: 'corte', time: '10:30' })).status, 409); assert.equal((await bob.call('bookings', 'POST', { ...payload, staff: secondStaff })).status, 201); assert.equal((await alice.call('bookings', 'POST', { ...payload, date: '2020-01-01' })).status, 400); });
        await t.test('cliente não acessa nem cancela a reserva de outro', async () => { assert.equal((await anonymous.call('bookings')).status, 401); const bookings = (await bob.call('bookings')).data; assert.ok(!bookings.some(x => x.id === bookingId)); assert.equal((await bob.call('bookings/' + bookingId, 'DELETE', {})).status, 404); assert.equal((await anonymous.call('admin/dashboard?date=' + date)).status, 401); });
        await t.test('regras de bloqueio e expediente preservam reservas futuras', async () => { assert.equal((await owner.call('admin/blocks', 'POST', { staff: 'principal', date, start: '10:00', end: '11:00', reason: 'Teste' })).status, 409); assert.equal((await owner.call('admin/staff/principal', 'PUT', { name: 'Barbeiro', bio: '', days: '1,2,3,4,5,6', start: '12:00', end: '18:00', active: true })).status, 400); const block = await owner.call('admin/blocks', 'POST', { staff: 'principal', date, start: '14:00', end: '15:00', reason: 'Folga' }); assert.equal(block.status, 201); assert.equal((await alice.call('bookings', 'POST', { ...payload, time: '14:00' })).status, 409); assert.equal((await owner.call('admin/blocks/' + block.data.id, 'DELETE', {})).status, 200); });
        await t.test('remarcação mantém valor e duração originais', async () => { assert.equal((await owner.call('admin/services/combo', 'PUT', { name: 'Combo novo', description: 'Novo', price: 9900, duration: 90, active: false })).status, 200); const slots = await alice.call('slots?' + new URLSearchParams({ staff: 'principal', service: 'combo', date, ignore: bookingId })); assert.ok(slots.data.slots.includes('17:00')); assert.equal((await alice.call('bookings/' + bookingId, 'PATCH', { staff: 'principal', date, time: '11:00' })).status, 200); const booking = (await alice.call('bookings')).data.find(x => x.id === bookingId); assert.equal(booking.price, 7000); assert.equal(booking.duration, 60); assert.equal(booking.serviceName, 'Corte + barba'); assert.equal((await owner.call('admin/bookings/' + bookingId, 'PATCH', { status: 'completed' })).status, 400); });
        await t.test('cancelamento libera o período', async () => { assert.equal((await alice.call('bookings/' + bookingId, 'DELETE', {})).status, 200); const created = await alice.call('bookings', 'POST', { ...payload, service: 'corte', time: '11:00' }); assert.equal(created.status, 201); bookingId = created.data.id; });
        await t.test('acesso em outro navegador e recuperação revogam sessões antigas', async () => { const second = client(); assert.equal((await second.call('auth/login', 'POST', { email: 'alice@example.test', password })).status, 200); assert.ok((await second.call('bookings')).data.some(x => x.id === bookingId)); const recovered = await second.call('auth/recover', 'POST', { email: 'alice@example.test', recoveryKey: recovery, password: 'Nova senha de teste segura 456!' }); assert.equal(recovered.status, 200); assert.ok(recovered.data.recoveryKey !== recovery); assert.equal((await alice.call('auth/me')).data.user, null); assert.equal((await alice.call('auth/recover', 'POST', { email: 'alice@example.test', recoveryKey: recovery, password })).status, 401); assert.equal((await alice.call('auth/login', 'POST', { email: 'alice@example.test', password: 'Nova senha de teste segura 456!' })).status, 200); });
        await t.test('verificação e redefinição usam tokens de uso único', async () => {
            const fixture = new DatabaseSync(dbPath);
            fixture.prepare('INSERT INTO verifications VALUES(?,?,?)').run(hash('verify-test-only'), aliceId, Date.now() + 3600e3);
            fixture.prepare('INSERT INTO resets VALUES(?,?,?)').run(hash('reset-test-only'), aliceId, Date.now() + 3600e3);
            fixture.close();
            assert.equal((await alice.call('auth/verify', 'POST', { token: 'verify-test-only' })).status, 200);
            assert.equal((await alice.call('auth/verify', 'POST', { token: 'verify-test-only' })).status, 400);
            const c = await alice.call('bookings', 'POST', { ...payload, service: 'corte', time: '15:00' });
            assert.equal(c.status, 201);
            assert.equal((await alice.call('bookings/' + c.data.id, 'DELETE', {})).status, 200);
            const outbox = (await owner.call('admin/messages')).data;
            assert.ok(!outbox.enabled);
            assert.ok(outbox.items.some(x => x.kind === 'cancellation' && x.status === 'pending'));
            const reset = await alice.call('auth/reset', 'POST', { token: 'reset-test-only', password: 'Senha redefinida no teste 789!' });
            assert.equal(reset.status, 200);
            assert.ok(reset.data.recoveryKey);
            assert.equal((await alice.call('auth/reset', 'POST', { token: 'reset-test-only', password })).status, 400);
            assert.equal((await alice.call('account/password', 'PUT', { current: 'errada', password })).status, 401);
            assert.equal((await alice.call('account/password', 'PUT', { current: 'Senha redefinida no teste 789!', password })).status, 200);
        });
        let logoPath;
        await t.test('imagens enviadas persistem no banco e exigem proprietário',async()=>{
          const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ+UAAAAASUVORK5CYII=';
          assert.equal((await alice.call('admin/media','POST',{kind:'logo',data:image})).status,403);
          assert.equal((await owner.call('admin/media','POST',{kind:'logo',data:image})).status,200);
          logoPath=(await anonymous.call('catalog')).data.settings.logo;
          const media=await fetch(origin+logoPath);assert.equal(media.status,200);assert.equal(media.headers.get('content-type'),'image/png');assert.ok((await media.arrayBuffer()).byteLength>12);
        });
        await t.test('backup e persistência após trocar disco da aplicação',async()=>{
          const csv=await owner.call('admin/export?from='+date+'&to='+date);assert.equal(csv.status,200);assert.ok(csv.data.includes('Cliente Alice'));
          const backup=await owner.call('admin/backup','POST',{});assert.equal(backup.status,200);
          if(mode==='libsql'){
            const data=JSON.parse(backup.data.toString());assert.equal(data.format,'traco-backup-v1');assert.ok(data.tables.appointments.some(x=>x.id===bookingId));assert.ok(data.tables.media[0].content.$base64);
          }else{
            assert.equal(backup.data.subarray(0,15).toString(),'SQLite format 3');const file=path.join(dir,'restored.sqlite');writeFileSync(file,backup.data);const restored=new DatabaseSync(file,{readOnly:true});assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.ok(restored.prepare('SELECT 1 FROM appointments WHERE id=?').get(bookingId));restored.close();
          }
          await stop();if(mode==='libsql'){rmSync(path.join(dir,'cache-'+generation),{recursive:true,force:true});generation++;}await start();
          assert.ok((await alice.call('bookings')).data.some(x=>x.id===bookingId));assert.equal((await owner.call('admin/catalog')).data.settings.name,'Traço Teste');assert.equal((await fetch(origin+logoPath)).status,200);
        });
        await t.test('exclusão da conta cancela e anonimiza dados', async () => { assert.equal((await bob.call('account', 'DELETE', { password })).status, 200); assert.equal((await bob.call('auth/me')).data.user, null); const dashboard = (await owner.call('admin/dashboard?date=' + date)).data; assert.ok(dashboard.bookings.some(x => x.name === 'Cliente removido' && x.status === 'cancelled' && !x.phone)); });
        await t.test('rotas públicas e cabeçalhos de segurança', async () => { for (const route of ['/', '/admin', '/privacidade', '/app.js', '/admin.js', '/common.js']) {
            const r = await fetch(origin + route);
            assert.equal(r.status, 200, route);
            assert.ok(r.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
        } assert.equal((await fetch(origin + '/data/agenda.sqlite')).status, 404); assert.equal((await anonymous.call('auth/forgot', 'POST', { email: 'alice@example.test' })).status, 503); });
    }
    finally {
        await stop();
        rmSync(dir, { recursive: true, force: true });
    }
});
test('fila de e-mails: agendamento, repetição, falha e cancelamento', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'traco-mensagens-'));
    const store = await openStore(path.join(dir, 'queue.sqlite'),{url:''});
    try {
        await queueEmail(store, { id: 'test-1', kind: 'verification', recipient: 'teste@example.test', subject: 'Teste', message: 'Teste' });
        let sent = 0;
        const worker = makeMessageWorker(store, async () => { sent++; }, () => true);
        await worker();
        await worker();
        assert.equal(sent, 1);
        assert.equal((await store.get('SELECT status FROM outbox WHERE id=?', 'test-1')).status, 'accepted');
        await queueEmail(store, { id: 'test-2', kind: 'reset', recipient: 'teste@example.test', subject: 'Teste', message: 'Teste' });
        const fail = makeMessageWorker(store, async () => { throw Error('falha de teste'); }, () => true);
        await fail();
        const failed = await store.get('SELECT * FROM outbox WHERE id=?', 'test-2');
        assert.equal(failed.status, 'failed');
        assert.equal(failed.attempts, 1);
        assert.ok(failed.due > Date.now());
        await queueEmail(store, { id: 'test-3', kind: 'reminder', recipient: 'teste@example.test', subject: 'Amanhã', message: 'Teste', due: Date.now() + 864e5 });
        await worker();
        assert.equal(sent, 1);
        await store.run("INSERT INTO appointments(id,staffId,serviceId,serviceName,staffName,price,duration,name,phone,date,start,end,status,created) VALUES('cancel-test','principal','corte','Corte','Principal',4500,30,'Teste','11999999999',?,600,630,'cancelled',?)", nextDate(), Date.now());
        await queueEmail(store, { id: 'test-4', bookingId: 'cancel-test', kind: 'reminder', recipient: 'teste@example.test', subject: 'Cancelado', message: 'Não enviar' });
        await worker();
        assert.equal(sent, 1);
        assert.equal((await store.get("SELECT status FROM outbox WHERE id='test-4'")).status, 'cancelled');
    }
    finally {
        store.db.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
test('migração preserva marca e reservas da primeira versão', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'traco-migration-')), file = path.join(dir, 'old.sqlite');
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE settings(id INTEGER PRIMARY KEY,name TEXT,phone TEXT); INSERT INTO settings VALUES(1,'Minha Marca','5511999999999'); CREATE TABLE bookings(id TEXT,owner TEXT,service TEXT,name TEXT,phone TEXT,date TEXT,time TEXT); INSERT INTO bookings VALUES('legacy-id','cookie-owner','combo','Cliente antigo','11999999999','2027-01-01','10:00');");
    old.close();
    const store = await openStore(file,{url:''});
    try {
        assert.equal((await store.get('SELECT name FROM shop')).name, 'Minha Marca');
        const b = await store.get('SELECT * FROM appointments');
        assert.equal(b.name, 'Cliente antigo');
        assert.equal(b.duration, 30);
        assert.equal(b.start, 600);
        assert.equal(b.legacyOwner, 'cookie-owner');
    }
    finally {
        store.db.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('migração SQLite -> libSQL, reversão de falha e restauração JSON',async()=>{
 const {readTransfer,importTransfer}=await import('./lib/transfer.mjs');
 const dir=mkdtempSync(path.join(tmpdir(),'traco-transfer-')),sourcePath=path.join(dir,'local.sqlite');
 const source=await openStore(sourcePath,{url:''});
 let target,restored;const previous=process.env.NODE_ENV;
 try{
  await source.run("INSERT INTO users(id,name,email,password,recovery,role,created) VALUES('owner-import','Dono original','dono@example.test','hash-original','recovery-original','owner',?)",Date.now());
  await source.run("UPDATE shop SET name='Marca importada' WHERE id=1");
  await source.run("INSERT INTO appointments(id,userId,staffId,serviceId,serviceName,staffName,price,duration,name,phone,date,start,end,created) VALUES('import-booking','owner-import','principal','corte','Corte original','Barbeiro original',4500,30,'Dono original','11999999999',?,600,630,?)",nextDate(),Date.now());
  await source.run("INSERT INTO media VALUES('logo-import.png','image/png',?,?)",Buffer.from([137,80,78,71,1,2,3]),Date.now());
  const data=readTransfer(sourcePath);assert.equal(data.tables.users[0].password,'hash-original');
  process.env.NODE_ENV='test';
  target=await openStore(path.join(dir,'cache','scratch.sqlite'),{url:pathToFileURL(path.join(dir,'cloud.sqlite')).href,setupToken:'setup-test-012345678901234567890123456789'});
  const invalid=JSON.parse(JSON.stringify(data));invalid.tables.appointments[0].staffId='inexistente';
  await assert.rejects(()=>importTransfer(target,invalid,{confirmed:true}));
  assert.equal(await target.get('SELECT 1 FROM users'),undefined);assert.equal((await target.get('SELECT name FROM shop')).name,'Barbearia Teste');
  await importTransfer(target,data,{confirmed:true});
  assert.equal((await target.get('SELECT name FROM shop')).name,'Marca importada');assert.equal((await target.get('SELECT userId FROM appointments')).userId,'owner-import');assert.deepEqual(Buffer.from((await target.get('SELECT content FROM media')).content),Buffer.from([137,80,78,71,1,2,3]));
  await assert.rejects(()=>importTransfer(target,data,{confirmed:true}),/já contém/);
  const backup=await target.snapshot();restored=await openStore(path.join(dir,'cache2','scratch.sqlite'),{url:pathToFileURL(path.join(dir,'restored.sqlite')).href,setupToken:'setup-test-012345678901234567890123456789'});
  await importTransfer(restored,readTransfer(backup),{confirmed:true});assert.equal((await restored.get('SELECT password FROM users')).password,'hash-original');assert.equal((await restored.all('SELECT * FROM media')).length,1);
 }finally{await source.close();await target?.close();await restored?.close();if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;try{rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:100});}catch(e){console.warn("Limpeza temporária: "+e.code);}}
});
