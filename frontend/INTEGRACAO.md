# Frontend comercial — configuração e integração

O site público é index.html na raiz + frontend/ + public/assets/. No GitHub Pages selecione main / (root). Nenhuma chave privada deve aparecer no frontend.

## Personalizar para cada cliente
Edite frontend/config.js: name, address, hours, whatsapp (55 + DDD + número), serviços (price em centavos, duration em minutos). Preços iniciais do projeto: corte 4500, barba 3500, combo 7000. Substitua fotos ilustrativas e logo em public/assets e personalize os textos, identificação da barbearia e privacidade. Sem número configurado não há link de WhatsApp. Sem API, o formulário apenas revisa/copia o pedido; não salva reservas nem envia dados. No WhatsApp o cliente precisa enviar a mensagem e aguardar confirmação.

## API proposta (a implementar)
Defina apiBaseUrl HTTPS, sem /api final. frontend/api.js é o único adaptador de transporte. O backend Node anterior permanece preservado; ele NÃO implementa ainda POST /api/booking-requests. Não basta apontar a URL para ele: implemente a rota abaixo ou adapte para a autenticação existente. O modo online falha de forma explícita se o catálogo ou os horários não forem válidos.

GET /api/catalog -> {services:[{id,name,description,price,duration}],staff:[{id,name}]}. Inteiros em centavos/minutos.
GET /api/slots?date=YYYY-MM-DD&staff=ID&service=ID -> {slots:["09:00","09:30"]}. Strings HH:mm no fuso local do estabelecimento.
POST /api/booking-requests -> {service,staff,name,phone,date,time,notes,consent:true}. Cabeçalho Idempotency-Key UUID por tentativa lógica. Resposta 200/201: {id:"codigo",status:"pending"|"confirmed"}. Só confirmed significa reserva confirmada. Pending precisa de confirmação posterior pelo estabelecimento. 409: horário ocupado; 429: limite de tentativas. O cliente reutiliza a chave em retries e aplica timeout de 15s. Em timeout o resultado pode ser incerto; não mostrar sucesso automaticamente.

## Responsabilidades obrigatórias do backend
Validar e limitar campos no servidor; determinar preço/duração pelo catálogo, nunca aceitar preço enviado pelo cliente. Validar datas no fuso da barbearia e regras de expediente. Impedir conflitos atomicamente e persistir a idempotência com comparação do payload. Autenticar e autorizar painel e operações de consulta/cancelamento. A rota proposta é pública e necessita limite de tentativas e proteção contra abuso. Configurar CORS apenas para a origem do site (https://israelksilva.github.io, sem caminho), preflight OPTIONS para Content-Type e Idempotency-Key, HTTPS e política de retenção. Não colocar Turso tokens ou SETUP_TOKEN no config.js. O frontend não utiliza cookies de autenticação nessa rota pública. Mudar esse modelo exige adaptar credenciais/CORS/CSRF.

## Validação antes de vender operação
Página pronta para apresentação não equivale a sistema operacional completo. Confirmar preços, contato, endereço, expediente e direitos das imagens; preencher identificação e política de privacidade; testar WhatsApp real. Para ativar reservas, implementar API, testar concorrência, fusos, indisponibilidade, retries, permissões, backups e fluxo completo com clientes em dispositivos diferentes. Login e painel da versão Node não são publicados como funcionalidades da página estática.

Checks: node --test frontend/api.test.mjs; node --check frontend/site.js.
