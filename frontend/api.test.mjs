import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from './api.js';
test('modo de apresentação não envia pedidos',async()=>{let called=false;const api=createApi('',()=>{called=true});await assert.rejects(api.book({},'key'),/não foi ativado/);assert.equal(called,false)});
test('timeout é limitado e chave acompanha o pedido',async()=>{let sent;const api=createApi('https://example.com/',async(url,options)=>{sent={url,...options};return new Response(JSON.stringify({id:'123',status:'pending'}))});assert.equal((await api.book({service:'corte'},'same-key')).status,'pending');assert.equal(sent.url,'https://example.com/api/booking-requests');assert.equal(sent.headers['Idempotency-Key'],'same-key');assert.ok(sent.signal);assert.equal(JSON.parse(sent.body).service,'corte')});
test('conflito não vira confirmação',async()=>{await assert.rejects(createApi('https://example.com',async()=>new Response('{}',{status:409})).book({},'x'),/ocupado/)});
test('resposta sem confirmação válida é rejeitada',async()=>{await assert.rejects(createApi('https://example.com',async()=>new Response('{}')).book({},'x'),/validar/)});
test('credenciais não podem ser configuradas em HTTP',()=>assert.throws(()=>createApi('http://example.com'),/HTTPS/));
