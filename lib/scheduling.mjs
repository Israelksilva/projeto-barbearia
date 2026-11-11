export class AppError extends Error { constructor(status,message){super(message);this.status=status;} }
export const check = (condition,message,status=400) => {if(!condition)throw new AppError(status,message);};
export const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bahia',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const stamp = (date,minutes) => Date.parse(`${date}T${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}:00-03:00`);
export const clock = minutes => `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
export function parseTime(value){check(/^\d{2}:\d{2}$/.test(value||''),'Horário inválido.');const [h,m]=value.split(':').map(Number);check(h>=0&&h<24&&m>=0&&m<60,'Horário inválido.');return h*60+m;}
export function validDate(date, future=true) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return false;
  const parsed=new Date(date+'T12:00:00Z');
  return !Number.isNaN(+parsed)&&parsed.toISOString().slice(0,10)===date&&(!future||(date>=today()&&date<=new Date(Date.now()+90*864e5).toISOString().slice(0,10)));
}
export const weekday = date => new Date(date+'T12:00:00Z').getUTCDay();
export function fitsSchedule(staff,date,start,end) {
  return staff.days.split(',').includes(String(weekday(date)))&&start>=staff.start&&end<=staff.end&&!(staff.breakStart!==null&&start<staff.breakEnd&&end>staff.breakStart);
}
export function ensureSlot(store,staffId,date,start,duration,ignore='') {
  check(typeof staffId==='string'&&staffId.length<=80,'Selecione um profissional.');
  check(validDate(date),'Escolha uma data nos próximos 90 dias.');
  check(Number.isInteger(start)&&start%15===0&&stamp(date,start)>Date.now(),'Escolha um horário futuro, em intervalos de 15 minutos.');
  const staff=store.get('SELECT * FROM staff WHERE id=? AND active=1',staffId);
  check(staff,'Profissional indisponível.');
  const end=start+duration;
  check(fitsSchedule(staff,date,start,end),'O serviço não cabe no expediente ou coincide com o intervalo.');
  check(!store.get("SELECT 1 FROM appointments WHERE staffId=? AND date=? AND status IN ('confirmed','completed','no_show') AND start<? AND end>? AND id<>?",staffId,date,end,start,ignore),'O profissional já tem uma reserva nesse período.',409);
  check(!store.get('SELECT 1 FROM blocks WHERE staffId=? AND date=? AND start<? AND end>?',staffId,date,end,start),'O profissional está indisponível nesse período.',409);
  return staff;
}
export function availableSlots(store,staffId,serviceId,date,ignore='') {
  const staff=store.get('SELECT * FROM staff WHERE id=? AND active=1',staffId), service=ignore?store.get('SELECT duration FROM appointments WHERE id=?',ignore):store.get('SELECT * FROM services WHERE id=? AND active=1',serviceId);
  if(!staff||!service||!validDate(date))return [];
  const result=[];
  for(let start=Math.ceil(staff.start/15)*15;start+service.duration<=staff.end;start+=15){try{ensureSlot(store,staffId,date,start,service.duration,ignore);result.push(clock(start));}catch(e){if(!(e instanceof AppError))throw e;}}
  return result;
}
