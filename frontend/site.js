import {config} from './config.js';
import {createApi} from './api.js';
const $=s=>document.querySelector(s), api=createApi(config.demo ? '' : config.apiBaseUrl);
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dialog=$('#booking'),form=$('#request-form');
let services=config.services, staff=[], selected, key, slotVersion=0, sending=false, catalogReady=!api.enabled;
let phone=config.whatsapp.replace(/\D/g,'');
const whatsappReady=!config.demo && /^55\d{10,11}$/.test(phone);
const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
function toast(s){$('#toast').textContent=s;$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,4500);}
function render(){
 $('#services').innerHTML=services.map((s,i)=>`<article class="card ${s.id==='combo'?'featured':''}">${s.id==='combo'?'<span class="ribbon">O ritual completo</span>':''}<img class="service-photo" src="./public/assets/${config.services.find(x=>x.id===s.id)?.image||'corte-degrade.png'}" alt="Imagem ilustrativa de ${esc(s.name)}" loading="lazy" width="640" height="420"><div class="card-content"><span class="card-number">0${i+1}</span><h3>${esc(s.name)}</h3><p>${esc(s.description)}</p><span class="duration">${s.duration} MIN · PAGAMENTO NO LOCAL</span><div class="card-bottom"><span class="price">${money(s.price)}</span><button class="button" data-service="${esc(s.id)}">Escolher ↗</button></div></div></article>`).join('');
}
render();
document.querySelectorAll('[data-brand]').forEach(e=>e.textContent=config.name);
if(!config.demo){$('.demo-banner').hidden=true;}
document.title=config.name+' · Cabelo, barba e estilo';
for(const [id,value] of [['#business-address',config.address],['#business-hours',config.hours]]){if(value){$(id).textContent=value;$(id).hidden=false;}}
if(whatsappReady){$('#contact-link').href='https://wa.me/'+phone;$('#contact-link').hidden=false;$('#contact-status').textContent='Fale com a gente para combinar seu próximo horário.';}
const menu=$('.menu-toggle');menu.onclick=()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));$('#navigation').classList.toggle('open',open);};
$('#navigation').onclick=e=>{if(e.target.closest('a')){menu.setAttribute('aria-expanded','false');$('#navigation').classList.remove('open');}};
function showError(s){$('#form-error').textContent=s;}
function resetResult(){$('#request-result').hidden=true;$('#whatsapp-send').hidden=true;}
function open(service){
 selected=service;slotVersion++;key=crypto.randomUUID();form.querySelectorAll('input,select,textarea').forEach(x=>x.disabled=false);form.reset();resetResult();showError('');$('#submit-request').disabled=false;
 if(config.demo){form.elements.name.value='Cliente de demonstração';form.elements.phone.value='(00) 00000-0000';for(const n of ['name','phone','notes'])form.elements[n].readOnly=true;form.elements.notes.placeholder='Campo desativado na demonstração';}
 $('#dialog-title').textContent=service.name;$('#service-summary').textContent=money(service.price)+' · '+service.duration+' minutos · pagamento no local';
 $('#mode-note').textContent=api.enabled?'Consulte a disponibilidade e envie seu pedido. Aguarde o resultado antes de reenviar.':whatsappReady?'Você vai revisar a mensagem e enviá-la pelo WhatsApp. Aguarde a confirmação da barbearia.':'Demonstração com dados fictícios: não informe dados pessoais. O pedido não será enviado e nenhum horário será reservado.';
 $('#submit-request').textContent=api.enabled?'Enviar pedido ↗':'Revisar pedido ↗';
 form.elements.date.min=today();const max=new Date();max.setDate(max.getDate()+90);form.elements.date.max=[max.getFullYear(),String(max.getMonth()+1).padStart(2,'0'),String(max.getDate()).padStart(2,'0')].join('-');
 $('#staff-label').hidden=!api.enabled;form.elements.staff.required=api.enabled;
 form.elements.staff.innerHTML=staff.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
 form.elements.time.hidden=api.enabled;form.elements.time.disabled=api.enabled;form.elements.time.required=!api.enabled;
 form.elements.slot.hidden=!api.enabled;form.elements.slot.disabled=true;form.elements.slot.required=api.enabled;form.elements.slot.innerHTML='<option value="">Escolha uma data</option>';
 dialog.showModal();
}
$('#services').onclick=e=>{const b=e.target.closest('[data-service]');if(!b)return;if(!catalogReady){toast('Não foi possível consultar os serviços online. Recarregue a página para tentar novamente.');return;}open(services.find(s=>s.id===b.dataset.service));};
$('.close').onclick=()=>{if(!sending)dialog.close();};dialog.addEventListener('cancel',e=>{if(sending)e.preventDefault();});
async function slots(){
 resetResult();if(!api.enabled||!form.elements.date.value)return;
 const version=++slotVersion;const select=form.elements.slot;select.disabled=true;select.innerHTML='<option value="">Consultando…</option>';showError('');
 try{const result=await api.slots({date:form.elements.date.value,staff:form.elements.staff.value,service:selected.id});if(version!==slotVersion)return;
 if(!Array.isArray(result.slots)||!result.slots.every(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))throw Error('Resposta de disponibilidade inválida.');
 select.innerHTML=result.slots.length?'<option value="">Escolha um horário</option>'+result.slots.map(t=>`<option>${t}</option>`).join(''):'<option value="">Sem horários neste dia</option>';select.disabled=!result.slots.length;
 }catch(e){if(version===slotVersion){select.innerHTML='<option value="">Indisponível</option>';showError(e.message);}}
}
form.elements.date.onchange=slots;form.elements.staff.onchange=slots;
form.addEventListener('input',()=>{key=crypto.randomUUID();resetResult();showError('');});
form.onsubmit=async e=>{
 e.preventDefault();if(sending)return;showError('');resetResult();
 const f=form.elements;const digits=f.phone.value.replace(/\D/g,'');
 if(!/^\d{10,11}$/.test(digits)){showError('Informe um telefone brasileiro com DDD, com 10 ou 11 dígitos.');f.phone.focus();return;}
 if(f.name.value.trim().length<2){showError('Informe seu nome.');f.name.focus();return;}
 const time=api.enabled?f.slot.value:f.time.value;
 if(!time||f.date.value<today()||new Date(f.date.value+'T'+time)<=new Date()){showError('Escolha uma data e um horário futuros.');return;}
 const payload={service:selected.id,name:f.name.value.trim(),phone:digits,date:f.date.value,time,notes:f.notes.value.trim(),privacyNoticeAcknowledged:true};
 const message=`Olá! Gostaria de solicitar um horário.\nServiço: ${selected.name}\nValor: ${money(selected.price)}\nDuração: ${selected.duration} minutos\nNome: ${payload.name}\nTelefone: ${config.demo?'fictício (demonstração)':digits}\nDia: ${payload.date.split('-').reverse().join('/')}\nHorário desejado: ${time}${payload.notes?'\nObservação: '+payload.notes:''}\nAguardo confirmação da disponibilidade.`;
 $('#message-preview').textContent=message;
 if(api.enabled){
  payload.staff=f.staff.value;sending=true;$('#submit-request').disabled=true;$('#submit-request').textContent='Enviando…';
  try{const result=await api.book(payload,key);$('#result-title').textContent=result.status==='confirmed'?'Agendamento confirmado':'Pedido recebido';$('#result-note').textContent=(result.status==='pending'?'Aguarde a confirmação da barbearia. ':'')+'Código: '+result.id;$('#request-result').hidden=false;$('#request-result').focus();form.querySelectorAll('input,select,textarea').forEach(x=>x.disabled=true);$('#submit-request').textContent='Pedido enviado';}
  catch(err){showError(err.name==='TimeoutError'?'A resposta demorou. Consulte a barbearia antes de reenviar; o pedido pode ter sido recebido.':err.message);$('#submit-request').disabled=false;$('#submit-request').textContent='Tentar novamente';}
  finally{sending=false;}
 }else{
  $('#result-title').textContent=whatsappReady?'Seu pedido está pronto para enviar':'Prévia do seu pedido';$('#result-note').textContent=whatsappReady?'Clique abaixo e envie a mensagem. O horário depende da confirmação da barbearia.':'Nada foi enviado. Contato e agendamento online ainda não foram ativados.';
  if(whatsappReady){$('#whatsapp-send').href='https://wa.me/'+phone+'?text='+encodeURIComponent(message);$('#whatsapp-send').hidden=false;}
  $('#request-result').hidden=false;$('#request-result').focus();
 }
};
$('#copy-request').onclick=async()=>{try{await navigator.clipboard.writeText($('#message-preview').textContent);toast('Pedido copiado.');}catch{toast('Selecione o texto do pedido para copiar manualmente.');}};
if(api.enabled){try{const c=await api.catalog();if(!Array.isArray(c.services)||!c.services.length||!Array.isArray(c.staff)||!c.staff.length||!c.services.every(s=>typeof s.id==='string'&&typeof s.name==='string'&&Number.isInteger(s.price)&&s.price>=0&&Number.isInteger(s.duration)&&s.duration>0))throw Error('Catálogo inválido.');services=c.services;staff=c.staff;catalogReady=true;render();}catch{toast('Serviços online indisponíveis. Nenhum pedido será enviado.');}}
