# Integração implementada na versão 3.1

A versão operacional é public/index.html servida pelo Node em /. Ela usa public/common.js + public/app.js, cookies HttpOnly e a API na mesma origem. Abra a URL do servidor/Render, não GitHub Pages.

Rotas principais:
GET /api/catalog — configurações, serviços, equipe, estado da operação e hoje.
POST /api/auth/setup — primeiro proprietário com código privado de instalação.
POST /api/auth/register, /api/auth/login, /api/auth/logout — sessão de usuário.
GET /api/slots?date=YYYY-MM-DD&staff=ID&service=ID — disponibilidade real.
POST /api/booking-requests — reserva AUTENTICADA, alias de /api/bookings; corpo {service,staff,date,time,phone}. Nome/e-mail vêm da conta, preço/duração do catálogo. Idempotency-Key com 16–128 letras/dígitos/_/-; frontend envia UUID. Resposta 201 na criação, 200 no retry, incluindo id,status,price,duration e replayed. Retry de reserva cancelada retorna o status atual sem recriar. Payload divergente com mesma chave retorna 409.
GET /api/bookings — reservas da própria conta.
PATCH ou DELETE /api/bookings/ID — remarcação/cancelamento conforme regra e propriedade.
GET/PUT /api/admin/legal — identificação/retencão/liberação, somente proprietário.
Demais /api/admin/* — serviços, equipe, expediente, bloqueios, agenda, CSV, backup e auditoria, somente proprietário.

Para mutações, Origin deve coincidir com PUBLIC_URL/RENDER_EXTERNAL_URL e Content-Type application/json. Não liberar CORS indiscriminadamente. A página demonstrativa de raiz e frontend/site.js continuam isolados e sem tráfego real por demo=true. Seu adaptador api.js é legado da preparação visual; não é o cliente utilizado na aplicação Node e não deve ser ativado como formulário público anônimo.

Leia BACKEND-PRONTO.md e CONFORMIDADE-BR.md. Não basta copiar token para o frontend; nenhum segredo deve sair do servidor. E-mail/pagamento/WhatsApp automático não são ativados por esta integração.
