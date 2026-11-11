import { stamp, clock } from './scheduling.mjs';
import { randomUUID } from 'node:crypto';
export const emailReady = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && process.env.PUBLIC_URL);
export function queueEmail(store,{id=randomUUID(),bookingId=null,kind,recipient,subject,message,due=Date.now()}) {
  store.run('INSERT OR IGNORE INTO outbox(id,bookingId,kind,recipient,subject,message,due) VALUES(?,?,?,?,?,?,?)',id,bookingId,kind,recipient,subject,message,due);
}
export function bookingMessages(store,booking,kind='confirmation') {
  store.run("UPDATE outbox SET status='cancelled' WHERE bookingId=? AND status IN ('pending','failed')",booking.id);
  if(!booking.email)return;
  const user=booking.userId&&store.get('SELECT emailVerified FROM users WHERE id=?',booking.userId);
  if(!user?.emailVerified)return;
  const shop=store.get('SELECT * FROM shop WHERE id=1');
  const date=booking.date.split('-').reverse().join('/');
  const detail=`${booking.serviceName} com ${booking.staffName}\n${date} às ${clock(booking.start)}\n${shop.name}\n${shop.address}\nValor: R$ ${(booking.price/100).toFixed(2).replace('.',',')} — pagamento no local.`;
  const link=process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/#reservas` : 'Abra o site da barbearia e entre na sua conta.';
  queueEmail(store,{id:`${booking.id}-${booking.version}-${kind}`,bookingId:booking.id,kind,recipient:booking.email,subject:kind==='cancellation'?'Sua reserva foi cancelada':kind==='rescheduled'?'Sua reserva foi alterada':'Reserva confirmada',message:`Olá, ${booking.name}!\n\n${detail}\n\n${kind==='cancellation'?'Esta reserva foi cancelada.':'Acompanhe sua reserva: '+link}`});
  if(booking.status==='confirmed') {
    const due=stamp(booking.date,booking.start)-24*3600e3;
    if(due>Date.now())queueEmail(store,{id:`${booking.id}-${booking.version}-reminder`,bookingId:booking.id,kind:'reminder',recipient:booking.email,subject:'Seu horário é amanhã',message:`Olá, ${booking.name}!\n\nLembrete do seu horário:\n${detail}\n\nGerencie sua reserva: ${link}`,due});
  }
}
export async function sendEmail(item) {
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':item.id},body:JSON.stringify({from:process.env.EMAIL_FROM,to:[item.recipient],subject:item.subject,text:item.message}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error(`Provedor de e-mail retornou ${response.status}`);
}
export function makeMessageWorker(store,transport=sendEmail,ready=emailReady) {
  let running=false;
  return async () => {
    if(running||!ready())return;
    running=true;
    try {
      for(const item of store.all("SELECT * FROM outbox WHERE status IN ('pending','failed') AND attempts<5 AND due<=? ORDER BY due LIMIT 10",Date.now())) {
        if(item.bookingId){const b=store.get('SELECT status,date,start FROM appointments WHERE id=?',item.bookingId);if(!b||(item.kind!=='cancellation'&&b.status!=='confirmed')||(item.kind==='reminder'&&stamp(b.date,b.start)<=Date.now())){store.run("UPDATE outbox SET status='cancelled' WHERE id=?",item.id);continue;}}
        try {await transport(item);store.run("UPDATE outbox SET status='accepted',sent=?,attempts=attempts+1,lastError='' WHERE id=?",Date.now(),item.id);}
        catch(error){store.run("UPDATE outbox SET status='failed',attempts=attempts+1,lastError=?,due=? WHERE id=?",String(error.message).slice(0,200),Date.now()+Math.min(3600e3,60000*2**item.attempts),item.id);}
      }
    } finally {running=false;}
  };
}
