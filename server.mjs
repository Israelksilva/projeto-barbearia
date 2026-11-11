import http from 'node:http';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openStore } from './lib/db.mjs';
import { secret, hash, passwordHash, passwordMatches, makeLimiter } from './lib/security.mjs';
import { AppError, check, today, stamp, clock, parseTime, validDate, fitsSchedule, ensureSlot, availableSlots } from './lib/scheduling.mjs';
import { queueEmail, bookingMessages, emailReady, makeMessageWorker } from './lib/messages.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const filename = process.env.DB_PATH || path.join(root, 'data', 'agenda.sqlite');
const store = await openStore(filename), { get, all, run, transaction } = store;
const port = Number(process.env.PORT || 3000), production = process.env.NODE_ENV === 'production';
const publicURL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL)?.replace(/\/$/, '');
if (production && (!publicURL || !publicURL.startsWith('https://')))
    throw Error('Em produção, configure PUBLIC_URL com HTTPS.');
const limiter = makeLimiter(), workMessages = makeMessageWorker(store);
const now = () => Date.now();
const clean = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const email = value => clean(value, 254).toLowerCase();
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const userView = user => user ? { id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: !!user.emailVerified } : null;
async function audit(actor, action, target = '') { await run('INSERT INTO audit(actor,action,target,created) VALUES(?,?,?,?)', actor, action, target, now()); }
async function sessionUser(req) { const raw = req.headers.cookie?.match(/(?:^|; )traco_session=([a-f0-9]{64})(?:;|$)/)?.[1]; return raw ? await get('SELECT u.* FROM users u JOIN sessions s ON s.userId=u.id WHERE s.hash=? AND s.expires>?', hash(raw), now()) : null; }
async function sessionCookie(res, userId) { const token = secret(); await run('INSERT INTO sessions VALUES(?,?,?)', hash(token), userId, now() + 7 * 864e5); res.setHeader('Set-Cookie', `traco_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${production ? '; Secure' : ''}`); }
async function revoke(req, res) { const raw = req.headers.cookie?.match(/(?:^|; )traco_session=([a-f0-9]{64})(?:;|$)/)?.[1]; if (raw)
    await run('DELETE FROM sessions WHERE hash=?', hash(raw)); res.setHeader('Set-Cookie', `traco_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${production ? '; Secure' : ''}`); }
function requireUser(user) { check(user, 'Entre na sua conta para continuar.', 401); }
function ownerOnly(user) { requireUser(user); check(user.role === 'owner', 'Apenas o proprietário pode fazer isso.', 403); }
async function ownBooking(user, id, req) { const b = await get('SELECT * FROM appointments WHERE id=?', id); check(b, 'Reserva não encontrada.', 404); const legacy = req.headers.cookie?.match(/(?:^|; )owner=([a-f0-9-]{36})(?:;|$)/)?.[1]; check(user && (user.role === 'owner' || b.userId === user.id || (legacy && b.legacyOwner === legacy)), 'Reserva não encontrada.', 404); return b; }
function throttle(key, limit = 20) { check(limiter(key, limit), 'Muitas tentativas. Aguarde 15 minutos e tente novamente.', 429); }
async function newVerification(user) { const token = secret(); await run('INSERT INTO verifications VALUES(?,?,?)', hash(token), user.id, now() + 24 * 3600e3); await queueEmail(store, { kind: 'verification', recipient: user.email, subject: 'Confirme seu e-mail', message: `Olá, ${user.name}!\n\nConfirme seu e-mail para receber confirmações e lembretes:\n${publicURL}/#verificar=${token}\n\nO link expira em 24 horas. Se você não criou uma conta, ignore esta mensagem.` }); }
function publicBooking(b) { return { ...b, legacyOwner: undefined, userId: undefined, email: undefined, created: undefined }; }
function serviceInput(b) { const name = clean(b.name, 80), description = clean(b.description, 400), price = Number(b.price), duration = Number(b.duration); check(name.length >= 2 && Number.isInteger(price) && price >= 0 && price <= 1000000, 'Informe um nome e um preço válido em centavos.'); check(Number.isInteger(duration) && duration >= 15 && duration <= 360 && duration % 15 === 0, 'Duração deve ser de 15 a 360 minutos, em intervalos de 15.'); return { name, description, price, duration, active: b.active === false ? 0 : 1 }; }
function staffInput(b) { const name = clean(b.name, 80), bio = clean(b.bio, 300); const days = [...new Set(String(b.days || '').split(',').filter(v => /^[0-6]$/.test(v)))].sort().join(','); const start = parseTime(b.start), end = parseTime(b.end), breakStart = b.breakStart ? parseTime(b.breakStart) : null, breakEnd = b.breakEnd ? parseTime(b.breakEnd) : null; check(name.length >= 2 && days && end > start && start % 15 === 0 && end % 15 === 0, 'Confira nome, dias e expediente em intervalos de 15 minutos.'); check((breakStart === null && breakEnd === null) || (breakStart !== null && breakEnd !== null && breakStart >= start && breakEnd <= end && breakEnd > breakStart && breakStart % 15 === 0 && breakEnd % 15 === 0), 'O intervalo precisa caber no expediente.'); return { name, bio, days, start, end, breakStart, breakEnd, active: b.active === false ? 0 : 1 }; }
async function cancelAllowed(user, b) { if (user.role === 'owner')
    return; const shop = await get('SELECT cancelHours FROM shop WHERE id=1'); check(b.status === 'confirmed', 'A reserva não está ativa.'); check(stamp(b.date, b.start) - now() >= shop.cancelHours * 3600e3, `Cancelamento online disponível até ${shop.cancelHours}h antes. Fale com a barbearia.`); }
function csv(rows) { const escape = v => '"' + String(v ?? '').replaceAll('"', '""') + '"'; return '\uFEFF' + rows.map(row => row.map(escape).join(';')).join('\r\n'); }
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'), pathname = url.pathname;
    let user = null;
    const ip = process.env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim() : req.socket.remoteAddress;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (production)
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
        if (pathname.startsWith('/api/')) user = await sessionUser(req);
        if (pathname.startsWith('/api/')) {
            if (!['GET', 'HEAD'].includes(req.method)) {
                const origin = publicURL ? new URL(publicURL).origin : `http://${req.headers.host}`;
                check(req.headers.origin === origin, 'Origem da requisição não permitida.', 403);
                check((req.headers['content-type'] || '').startsWith('application/json'), 'Envie dados em JSON.', 415);
                throttle(`mutations:${ip}`, 300);
            }
            let b = {};
            if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
                let raw = '';
                for await (const chunk of req) {
                    raw += chunk;
                    check(Buffer.byteLength(raw) <= 3 * 1024 * 1024, 'Arquivo ou dados muito grandes.', 413);
                }
                if (raw) {
                    try {
                        b = JSON.parse(raw);
                    }
                    catch {
                        throw new AppError(400, 'Dados JSON inválidos.');
                    }
                }
                check(b && typeof b === 'object' && !Array.isArray(b), 'Dados inválidos.');
            }
            const method = req.method;
            if (pathname === '/api/health' && method === 'GET')
                return json(200, { ok: true });
            if (pathname === '/api/catalog' && method === 'GET')
                return json(200, { settings: await get('SELECT * FROM shop WHERE id=1'), services: await all('SELECT * FROM services WHERE active=1 ORDER BY rowid'), staff: await all('SELECT * FROM staff WHERE active=1 ORDER BY rowid'), today: today(), emailEnabled: emailReady(), storage:store.remote?'turso':'sqlite', setupSource:store.remote?'environment':'file', backupFormat:store.backupFormat, setupRequired: !await get("SELECT 1 FROM users WHERE role='owner'") });
            if (pathname === '/api/auth/me' && method === 'GET')
                return json(200, { user: userView(user) });
            if (pathname === '/api/auth/setup' && method === 'POST') {
                throttle(`setup:${ip}`, 10);
                check(!await get("SELECT 1 FROM users WHERE role='owner'"), 'A instalação já tem proprietário.', 409);
                const token = (await get("SELECT value FROM meta WHERE key='setup-token'"))?.value || '';
                check(typeof b.token === 'string' && hash(b.token) === hash(token), 'Código de instalação inválido.', 403);
                check(clean(b.name).length >= 2 && validEmail(email(b.email)) && typeof b.password === 'string' && b.password.length >= 12 && b.password.length <= 200, 'Informe nome, e-mail e senha de 12 a 200 caracteres.');
                const password = await passwordHash(b.password), id = randomUUID(), recoveryKey = secret();
                await transaction(async () => { check(!await get("SELECT 1 FROM users WHERE role='owner'"), 'A instalação já tem proprietário.', 409); await run('INSERT INTO users(id,name,email,password,recovery,role,created) VALUES(?,?,?,?,?,?,?)', id, clean(b.name), email(b.email), password, hash(recoveryKey), 'owner', now()); await run("DELETE FROM meta WHERE key='setup-token'"); await audit(id, 'setup'); });
                if (store.setupPath && existsSync(store.setupPath))
                    unlinkSync(store.setupPath);
                await sessionCookie(res, id);
                return json(201, { user: userView(await get('SELECT * FROM users WHERE id=?', id)), recoveryKey });
            }
            if (pathname === '/api/auth/register' && method === 'POST') {
                throttle(`register:${ip}`, 15);
                check(await get("SELECT 1 FROM users WHERE role='owner'"), 'A barbearia ainda está sendo configurada.', 503);
                const name = clean(b.name), mail = email(b.email);
                check(name.length >= 2 && validEmail(mail) && typeof b.password === 'string' && b.password.length >= 12 && b.password.length <= 200, 'Informe nome, e-mail válido e senha de 12 a 200 caracteres.');
                check(b.privacy === true, 'Leia e aceite o aviso de privacidade para criar a conta.');
                const password = await passwordHash(b.password), id = randomUUID(), recoveryKey = secret();
                check(!await get('SELECT 1 FROM users WHERE email=?', mail), 'Não foi possível cadastrar. Tente entrar ou recuperar sua conta.', 409);
                await run('INSERT INTO users(id,name,email,password,recovery,role,created) VALUES(?,?,?,?,?,?,?)', id, name, mail, password, hash(recoveryKey), 'customer', now());
                const account = await get('SELECT * FROM users WHERE id=?', id);
                if (emailReady())
                    await newVerification(account);
                await sessionCookie(res, id);
                return json(201, { user: userView(account), recoveryKey });
            }
            if (pathname === '/api/auth/login' && method === 'POST') {
                throttle(`login:${ip}`, 25);
                throttle(`account:${email(b.email)}`, 15);
                check(typeof b.password === 'string' && b.password.length <= 200, 'Credenciais inválidas.', 401);
                const account = await get('SELECT * FROM users WHERE email=?', email(b.email));
                check(await passwordMatches(b.password, account?.password), 'E-mail ou senha incorretos.', 401);
                await sessionCookie(res, account.id);
                return json(200, { user: userView(account) });
            }
            if (pathname === '/api/auth/logout' && method === 'POST') {
                await revoke(req, res);
                return json(200, { ok: true });
            }
            if (pathname === '/api/auth/recover' && method === 'POST') {
                throttle(`recover:${ip}`, 10);
                const account = await get('SELECT * FROM users WHERE email=?', email(b.email));
                check(account && typeof b.recoveryKey === 'string' && hash(b.recoveryKey) === account.recovery, 'E-mail ou chave de recuperação inválidos.', 401);
                check(typeof b.password === 'string' && b.password.length >= 12 && b.password.length <= 200, 'A nova senha precisa ter de 12 a 200 caracteres.');
                const password = await passwordHash(b.password), key = secret();
                await transaction(async () => { check((await get('SELECT recovery FROM users WHERE id=?', account.id)).recovery === hash(b.recoveryKey), 'Chave já utilizada.', 409); await run('UPDATE users SET password=?,recovery=? WHERE id=?', password, hash(key), account.id); await run('DELETE FROM sessions WHERE userId=?', account.id); await run('DELETE FROM resets WHERE userId=?', account.id); await audit(account.id, 'recover'); });
                await sessionCookie(res, account.id);
                return json(200, { user: userView(account), recoveryKey: key });
            }
            if (pathname === '/api/auth/forgot' && method === 'POST') {
                throttle(`forgot:${ip}`, 10);
                check(emailReady(), 'Recuperação por e-mail não está ativada. Use sua chave de recuperação.', 503);
                const account = await get('SELECT * FROM users WHERE email=?', email(b.email));
                if (account) {
                    const token = secret();
                    await transaction(async () => { await run('DELETE FROM resets WHERE userId=?', account.id); await run('INSERT INTO resets VALUES(?,?,?)', hash(token), account.id, now() + 3600e3); await queueEmail(store, { kind: 'reset', recipient: account.email, subject: 'Redefina sua senha', message: `Para criar uma nova senha, abra:\n${publicURL}/#redefinir=${token}\n\nEste link expira em uma hora. Se não foi você, ignore esta mensagem.` }); });
                }
                return json(200, { ok: true, message: 'Se houver uma conta, enviaremos instruções.' });
            }
            if (pathname === '/api/auth/reset' && method === 'POST') {
                throttle(`reset:${ip}`, 10);
                const reset = await get('SELECT * FROM resets WHERE hash=? AND expires>?', hash(b.token), now());
                check(reset, 'Link inválido ou expirado.');
                check(typeof b.password === 'string' && b.password.length >= 12 && b.password.length <= 200, 'Use uma senha de 12 a 200 caracteres.');
                const password = await passwordHash(b.password), key = secret();
                await transaction(async () => { check(await get('SELECT 1 FROM resets WHERE hash=? AND expires>?', hash(b.token), now()), 'Link já utilizado.'); await run('UPDATE users SET password=?,recovery=?,emailVerified=1 WHERE id=?', password, hash(key), reset.userId); await run('DELETE FROM sessions WHERE userId=?', reset.userId); await run('DELETE FROM resets WHERE userId=?', reset.userId); });
                await sessionCookie(res, reset.userId);
                return json(200, { user: userView(await get('SELECT * FROM users WHERE id=?', reset.userId)), recoveryKey: key });
            }
            if (pathname === '/api/auth/verify' && method === 'POST') {
                throttle(`verify:${ip}`, 20);
                const token = await get('SELECT * FROM verifications WHERE hash=? AND expires>?', hash(b.token), now());
                check(token, 'Link inválido ou expirado.');
                await run('UPDATE users SET emailVerified=1 WHERE id=?', token.userId);
                await run('DELETE FROM verifications WHERE userId=?', token.userId);
                return json(200, { ok: true });
            }
            if (pathname === '/api/auth/verification' && method === 'POST') {
                requireUser(user);
                throttle(`verification:${user.id}`, 3);
                check(emailReady(), 'Envio de e-mails não configurado.', 503);
                if (!user.emailVerified)
                    await newVerification(user);
                return json(200, { ok: true });
            }
            if (pathname === '/api/account/password' && method === 'PUT') {
                requireUser(user);
                throttle(`password:${ip}`, 10);
                check(typeof b.current === 'string' && b.current.length <= 200 && await passwordMatches(b.current, user.password), 'Senha atual incorreta.', 401);
                check(typeof b.password === 'string' && b.password.length >= 12 && b.password.length <= 200, 'Use uma senha de 12 a 200 caracteres.');
                const password = await passwordHash(b.password), key = secret();
                await run('UPDATE users SET password=?,recovery=? WHERE id=?', password, hash(key), user.id);
                await run('DELETE FROM sessions WHERE userId=?', user.id);
                await sessionCookie(res, user.id);
                return json(200, { recoveryKey: key });
            }
            if (pathname === '/api/account/export' && method === 'GET') {
                requireUser(user);
                return json(200, { user: userView(user), bookings: await all('SELECT id,serviceName,staffName,price,name,phone,date,start,end,status FROM appointments WHERE userId=?', user.id) });
            }
            if (pathname === '/api/account' && method === 'DELETE') {
                requireUser(user);
                check(user.role !== 'owner', 'A conta do proprietário não pode ser excluída por aqui.');
                check(typeof b.password === 'string' && b.password.length <= 200 && await passwordMatches(b.password, user.password), 'Senha incorreta.', 401);
                await transaction(async () => { await run("UPDATE outbox SET status='cancelled',recipient='',message='' WHERE bookingId IN (SELECT id FROM appointments WHERE userId=?) AND status IN ('pending','failed')", user.id); await run("UPDATE appointments SET name='Cliente removido',phone='',email='',userId=NULL,status=CASE WHEN status='confirmed' THEN 'cancelled' ELSE status END WHERE userId=?", user.id); await run("UPDATE outbox SET recipient='',message='' WHERE recipient=?", user.email); await run('DELETE FROM users WHERE id=?', user.id); });
                await revoke(req, res);
                return json(200, { ok: true });
            }
            if (pathname === '/api/slots' && method === 'GET') {
                throttle(`slots:${ip}`, 500);
                const ignore = url.searchParams.get('ignore') || '';
                if (ignore)
                    await ownBooking(user, ignore, req);
                return json(200, { slots: await availableSlots(store, url.searchParams.get('staff'), url.searchParams.get('service'), url.searchParams.get('date'), ignore) });
            }
            if (pathname === '/api/bookings' && method === 'GET') {
                requireUser(user);
                const legacy = req.headers.cookie?.match(/(?:^|; )owner=([a-f0-9-]{36})(?:;|$)/)?.[1] || '';
                return json(200, (await all('SELECT * FROM appointments WHERE userId=? OR (legacyOwner=? AND legacyOwner IS NOT NULL) ORDER BY date DESC,start', user.id, legacy)).map(publicBooking));
            }
            if ((pathname === '/api/bookings' || pathname === '/api/admin/bookings') && method === 'POST') {
                requireUser(user);
                const admin = pathname.includes('/admin/');
                if (admin)
                    ownerOnly(user);
                throttle(`booking:${user.id}`, 40);
                check(typeof b.service === 'string' && b.service.length <= 80, 'Selecione um serviço.');
                const service = await get('SELECT * FROM services WHERE id=? AND active=1', b.service);
                check(service, 'Serviço indisponível.');
                const name = admin ? clean(b.name, 80) : user.name, phone = String(b.phone || '').replace(/\D/g, '');
                check(name.length >= 2 && /^\d{10,13}$/.test(phone), 'Informe nome e telefone com DDD.');
                const start = parseTime(b.time), id = randomUUID();
                await transaction(async () => { const staff = await ensureSlot(store, b.staff, b.date, start, service.duration); await run('INSERT INTO appointments(id,userId,staffId,serviceId,serviceName,staffName,price,duration,name,phone,email,date,start,end,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, admin ? null : user.id, staff.id, service.id, service.name, staff.name, service.price, service.duration, name, phone, admin ? '' : user.email, b.date, start, start + service.duration, now()); await bookingMessages(store, await get('SELECT * FROM appointments WHERE id=?', id)); await audit(user.id, 'booking-created', id); });
                return json(201, publicBooking(await get('SELECT * FROM appointments WHERE id=?', id)));
            }
            const match = pathname.match(/^\/api\/(?:admin\/)?bookings\/([a-f0-9-]+)$/);
            if (match && (method === 'PATCH' || method === 'DELETE')) {
                const booking = await ownBooking(user, match[1], req);
                if (pathname.includes('/admin/'))
                    ownerOnly(user);
                if (method === 'DELETE' || b.status === 'cancelled') {
                    check(booking.status === 'confirmed', 'Apenas reservas confirmadas podem ser canceladas.');
                    await cancelAllowed(user, booking);
                    await transaction(async () => { await run("UPDATE appointments SET status='cancelled',version=version+1 WHERE id=?", booking.id); await bookingMessages(store, await get('SELECT * FROM appointments WHERE id=?', booking.id), 'cancellation'); await audit(user.id, 'booking-cancelled', booking.id); });
                    return json(200, { ok: true });
                }
                if (b.status) {
                    ownerOnly(user);
                    check(['completed', 'no_show'].includes(b.status) && booking.status === 'confirmed', 'Mudança de status inválida.');
                    check(stamp(booking.date, booking.start) <= now(), 'Marque atendimento ou falta somente após o início do horário.');
                    await transaction(async () => { await run('UPDATE appointments SET status=?,version=version+1 WHERE id=?', b.status, booking.id); await run("UPDATE outbox SET status='cancelled' WHERE bookingId=? AND kind='reminder' AND status IN ('pending','failed')", booking.id); await audit(user.id, 'booking-' + b.status, booking.id); });
                    return json(200, { ok: true });
                }
                check(booking.status === 'confirmed', 'Apenas reservas confirmadas podem ser alteradas.');
                await cancelAllowed(user, booking);
                const start = parseTime(b.time);
                await transaction(async () => { const staff = await ensureSlot(store, b.staff || booking.staffId, b.date, start, booking.duration, booking.id); await run('UPDATE appointments SET date=?,start=?,end=?,staffId=?,staffName=?,version=version+1 WHERE id=?', b.date, start, start + booking.duration, staff.id, staff.name, booking.id); await bookingMessages(store, await get('SELECT * FROM appointments WHERE id=?', booking.id), 'rescheduled'); await audit(user.id, 'booking-rescheduled', booking.id); });
                return json(200, { ok: true });
            }
            if (pathname.startsWith('/api/admin/')) {
                ownerOnly(user);
                if (pathname === '/api/admin/dashboard' && method === 'GET') {
                    const date = url.searchParams.get('date') || today();
                    check(validDate(date, false), 'Data inválida.');
                    const staff = url.searchParams.get('staff') || '';
                    const appointments = await all('SELECT * FROM appointments WHERE date=? AND (?=\'\' OR staffId=?) ORDER BY start', date, staff, staff);
                    return json(200, { date, bookings: appointments.map(x => ({ ...x, legacyOwner: undefined })), blocks: await all('SELECT b.*,s.name staffName FROM blocks b JOIN staff s ON s.id=b.staffId WHERE date=? AND (?=\'\' OR staffId=?) ORDER BY start', date, staff, staff), stats: { confirmed: appointments.filter(x => x.status === 'confirmed').length, completed: appointments.filter(x => x.status === 'completed').length, cancelled: appointments.filter(x => x.status === 'cancelled').length, revenue: appointments.filter(x => x.status === 'completed').reduce((sum, x) => sum + x.price, 0) } });
                }
                if (pathname === '/api/admin/catalog' && method === 'GET')
                    return json(200, { settings: await get('SELECT * FROM shop WHERE id=1'), services: await all('SELECT * FROM services ORDER BY rowid'), staff: await all('SELECT * FROM staff ORDER BY rowid') });
                if (pathname === '/api/admin/settings' && method === 'PUT') {
                    const name = clean(b.name, 60), phone = String(b.phone || '').replace(/\D/g, ''), address = clean(b.address, 300), description = clean(b.description, 500), cancelHours = Number(b.cancelHours);
                    check(name.length >= 2 && (!phone || /^\d{10,13}$/.test(phone)) && Number.isInteger(cancelHours) && cancelHours >= 0 && cancelHours <= 72, 'Confira nome, WhatsApp e antecedência de cancelamento (0 a 72h).');
                    await run('UPDATE shop SET name=?,phone=?,address=?,description=?,cancelHours=? WHERE id=1', name, phone, address, description, cancelHours);
                    await audit(user.id, 'settings-updated');
                    return json(200, { ok: true });
                }
                if (pathname === '/api/admin/media' && method === 'POST') {
                    check(['logo', 'photo'].includes(b.kind), 'Tipo de imagem inválido.');
                    const match = String(b.data || '').match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
                    check(match, 'Envie uma imagem PNG, JPG ou WebP.');
                    const bytes = Buffer.from(match[2], 'base64');
                    check(bytes.length < 2 * 1024 * 1024 && bytes.length > 12, 'Imagem deve ter até 2 MB.');
                    const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
                    check(valid, 'Conteúdo da imagem inválido.');
                    const filename = `${b.kind}-${randomUUID()}.${match[1]}`;
                    await run('INSERT INTO media VALUES(?,?,?,?)',filename,'image/'+match[1],bytes,now());
                    await run(`UPDATE shop SET ${b.kind}=? WHERE id=1`, '/media/' + filename);
                    return json(200, { ok: true });
                }
                if (pathname === '/api/admin/services' && method === 'POST') {
                    const s = serviceInput(b), id = randomUUID();
                    await run('INSERT INTO services VALUES(?,?,?,?,?,?)', id, s.name, s.description, s.price, s.duration, s.active);
                    await audit(user.id, 'service-created', id);
                    return json(201, { id });
                }
                const serviceMatch = pathname.match(/^\/api\/admin\/services\/([a-z0-9-]+)$/);
                if (serviceMatch && method === 'PUT') {
                    const s = serviceInput(b);
                    check(await get('SELECT 1 FROM services WHERE id=?', serviceMatch[1]), 'Serviço não encontrado.', 404);
                    await run('UPDATE services SET name=?,description=?,price=?,duration=?,active=? WHERE id=?', s.name, s.description, s.price, s.duration, s.active, serviceMatch[1]);
                    await audit(user.id, 'service-updated', serviceMatch[1]);
                    return json(200, { ok: true });
                }
                if (pathname === '/api/admin/staff' && method === 'POST') {
                    const s = staffInput(b), id = randomUUID();
                    await run('INSERT INTO staff VALUES(?,?,?,?,?,?,?,?,?)', id, s.name, s.bio, s.days, s.start, s.end, s.breakStart, s.breakEnd, s.active);
                    await audit(user.id, 'staff-created', id);
                    return json(201, { id });
                }
                const staffMatch = pathname.match(/^\/api\/admin\/staff\/([a-z0-9-]+)$/);
                if (staffMatch && method === 'PUT') {
                    const s = staffInput(b);
                    check(await get('SELECT 1 FROM staff WHERE id=?', staffMatch[1]), 'Profissional não encontrado.', 404);
                    await transaction(async () => { const future = (await all("SELECT * FROM appointments WHERE staffId=? AND status='confirmed' AND date>=?", staffMatch[1], today())).filter(x => stamp(x.date, x.start) > now()); check(!future.some(x => !s.active || !fitsSchedule(s, x.date, x.start, x.end)), 'Há reservas futuras fora desse novo expediente. Remarque ou cancele antes.'); await run('UPDATE staff SET name=?,bio=?,days=?,start=?,end=?,breakStart=?,breakEnd=?,active=? WHERE id=?', s.name, s.bio, s.days, s.start, s.end, s.breakStart, s.breakEnd, s.active, staffMatch[1]); await audit(user.id, 'staff-updated', staffMatch[1]); });
                    return json(200, { ok: true });
                }
                if (pathname === '/api/admin/blocks' && method === 'POST') {
                    const start = parseTime(b.start), end = parseTime(b.end), id = randomUUID();
                    check(validDate(b.date) && await get('SELECT 1 FROM staff WHERE id=?', b.staff) && end > start, 'Confira profissional, data e período.');
                    await transaction(async () => { check(!await get("SELECT 1 FROM appointments WHERE staffId=? AND date=? AND status='confirmed' AND start<? AND end>?", b.staff, b.date, end, start), 'Já há reservas nesse período. Remarque ou cancele antes.', 409); await run('INSERT INTO blocks VALUES(?,?,?,?,?,?)', id, b.staff, b.date, start, end, clean(b.reason, 200) || 'Indisponível'); await audit(user.id, 'block-created', id); });
                    return json(201, { id });
                }
                const blockMatch = pathname.match(/^\/api\/admin\/blocks\/([a-f0-9-]+)$/);
                if (blockMatch && method === 'DELETE') {
                    await run('DELETE FROM blocks WHERE id=?', blockMatch[1]);
                    await audit(user.id, 'block-removed', blockMatch[1]);
                    return json(200, { ok: true });
                }
                if (pathname === '/api/admin/messages' && method === 'GET')
                    return json(200, { enabled: emailReady(), provider: 'Resend', items: await all('SELECT id,kind,recipient,subject,due,status,attempts,lastError,sent FROM outbox ORDER BY rowid DESC LIMIT 100') });
                if (pathname === '/api/admin/messages/retry' && method === 'POST') {
                    check(emailReady(), 'Configure o provedor de e-mails antes de reenviar.', 503);
                    await run("UPDATE outbox SET status='pending',attempts=0,due=? WHERE id=? AND status='failed'", now(), clean(b.id, 150));
                    return json(200, { ok: true });
                }
                if (pathname === '/api/admin/export' && method === 'GET') {
                    const from = url.searchParams.get('from') || today(), to = url.searchParams.get('to') || today();
                    check(validDate(from, false) && validDate(to, false) && from <= to, 'Período inválido.');
                    const rows = await all('SELECT date,start,name,phone,serviceName,staffName,price,status FROM appointments WHERE date BETWEEN ? AND ? ORDER BY date,start', from, to);
                    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="agenda.csv"', 'Cache-Control': 'no-store' });
                    return res.end(csv([['Data', 'Hora', 'Cliente', 'Telefone', 'Serviço', 'Profissional', 'Valor (R$)', 'Status'], ...rows.map(x => [x.date, clock(x.start), ...['name', 'phone', 'serviceName', 'staffName'].map(k => /^[=+\-@\t\r]/.test(String(x[k])) ? "'" + x[k] : x[k]), (x.price / 100).toFixed(2).replace('.', ','), x.status])]));
                }
                if (pathname === '/api/admin/backup' && method === 'POST') {
                    throttle(`backup:${user.id}`, 5);
                    const target = await store.snapshot();
                    check(target, 'Outro backup está em andamento.', 409);
                    await audit(user.id, 'backup-created');
                    const content=readFileSync(target);
                    if(store.remote)unlinkSync(target);
                    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="traco-backup.${store.backupFormat}"`, 'Cache-Control': 'no-store' });
                    return res.end(content);
                }
                if (pathname === '/api/admin/audit' && method === 'GET')
                    return json(200, await all('SELECT action,target,created FROM audit ORDER BY id DESC LIMIT 100'));
            }
            throw new AppError(404, 'Rota não encontrada.');
        }
        const staticFiles = { '/': 'index.html', '/admin': 'admin.html', '/admin/': 'admin.html', '/app.js': 'app.js', '/admin.js': 'admin.js', '/common.js': 'common.js', '/assets/logo-barbearia.png': 'assets/logo-barbearia.png', '/theme.css': 'theme.css', '/assets/barbearia-interior.png': 'assets/barbearia-interior.png', '/assets/corte-degrade.png': 'assets/corte-degrade.png', '/assets/ritual-barba.png': 'assets/ritual-barba.png', '/style.css': 'style.css', '/admin.css': 'admin.css', '/privacidade': 'privacy.html' };
        let file = staticFiles[pathname], absolute;
        if (file)
            absolute = path.join(root, 'public', file);
        else if (/^\/media\/(logo|photo)-[a-f0-9-]+\.(png|jpeg|webp)$/.test(pathname)) {
            const media=await get('SELECT mime,content FROM media WHERE id=?',path.basename(pathname));
            if(media){res.writeHead(200,{'Content-Type':media.mime,'Cache-Control':'public, max-age=86400'});return res.end(Buffer.from(media.content));}
            file = pathname;
            absolute = path.join(store.directory, 'media', path.basename(file));
        }
        check(absolute && existsSync(absolute), 'Página não encontrada.', 404);
        const ext = path.extname(file), types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache' });
        res.end(readFileSync(absolute));
    }
    catch (error) {
        if (!(error instanceof AppError))
            console.error(error);
        if (!res.headersSent)
            json(error.status || 500, { error: error.status ? error.message : 'Não foi possível concluir. Tente novamente.' });
        else
            res.end();
    }
});
server.requestTimeout = 20000;
server.headersTimeout = 15000;
async function cleanup(){await transaction(async()=>{await run('DELETE FROM sessions WHERE expires<?',now());await run('DELETE FROM resets WHERE expires<?',now());await run('DELETE FROM verifications WHERE expires<?',now());});}
const background = setInterval(() => { workMessages().catch(console.error);cleanup().catch(console.error); }, 30000);
background.unref();
const backupTimer = setInterval(() => {if(!store.remote)store.snapshot().catch(console.error);}, 24 * 3600e3);
backupTimer.unref();
server.listen(port, process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1'), async () => {
    console.log(`Traço disponível em ${publicURL || 'http://localhost:' + port}`);
    if (!await get("SELECT 1 FROM users WHERE role='owner'"))
        console.log(store.remote?'Primeiro acesso: abra /admin e use o código definido em SETUP_TOKEN na hospedagem.':`Primeiro acesso: abra /admin. O código está em ${store.setupPath}`);
    if (!store.remote && process.env.DISABLE_BACKUPS !== '1')
        store.snapshot().catch(console.error);
});
for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => { clearInterval(background); clearInterval(backupTimer); server.close(async () => { await store.close(); process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); });
