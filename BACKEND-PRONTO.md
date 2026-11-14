# Aplicação integrada — versão 3.1.0

## Rodar no computador
Requer Node.js 24+. Extraia o ZIP completo e abra no VS Code a pasta barbearia (a que contém package.json). Execute:

    npm ci
    npm start

Abra http://localhost:3000 e http://localhost:3000/admin. O primeiro acesso exige o código privado gerado em data/PRIMEIRO-ACESSO.txt. Cadastre seu proprietário e guarde a chave de recuperação. Não envie esses arquivos no GitHub/chat. Se a porta estiver ocupada, crie .env a partir de .env.example e troque PORT=3001; abra a nova porta. INICIAR.bat também instala dependências e inicia o servidor.

O banco local é data/agenda.sqlite. Não distribuir a pasta data, .env ou node_modules. Não rodar sobre uma instalação real sem cópia de segurança. A migração nova cria booking_keys sem apagar reservas existentes.

## O que está conectado
A aplicação operacional é public/index.html, servida por server.mjs em /. Usa /app.js, sessões HttpOnly e API na mesma origem, sem expor credenciais de banco ao navegador. Cadastro/login, recuperação por chave, serviços/equipe/expediente, horários livres, confirmação no banco, minhas reservas, remarcação/cancelamento, painel e exportação/backup estão integrados.

POST /api/booking-requests foi implementado como alias AUTENTICADO da criação de reserva. Exige sessão; calcula preço e duração pelo catálogo no servidor. Cabeçalho Idempotency-Key impede recriação em retry do mesmo pedido, inclusive após cancelamento. Outro payload com a mesma chave retorna 409; o isolamento é por usuário. Conflitos são verificados em transação de escrita. Não é um formulário público anônimo.

A index.html da RAIZ continua sendo a demonstração fictícia para GitHub Pages. Ela não vira a aplicação completa por configurar apiBaseUrl. Use o endereço da Render para operação integrada. Não há conexão CORS de uma página no GitHub para cookies de outra origem.

## Produção e identificação
No painel > Minha marca há Identificação e privacidade. Preencha dados reais e critérios de conservação, revise termos/privacidade e só então autorize liberação. Em NODE_ENV=production, cadastro de clientes e novas reservas retornam 503 até a liberação; setup/login/painel continuam acessíveis. Em desenvolvimento o fluxo funciona para testes com dados fictícios. Campo de cadastro preenchido não certifica LGPD, direitos de marca ou conformidade da operação.

## Render + Turso
Serviço Web Service/Docker, branch main, raiz vazia. Dockerfile já instala dependências. Configure somente no Environment da Render:
- TURSO_DATABASE_URL: URL libsql://... do banco compatível com libSQL.
- TURSO_AUTH_TOKEN: token privado desse banco.
- SETUP_TOKEN: aleatório de 32 a 128 caracteres; use Generate antes do primeiro setup.
- NODE_ENV=production e HOST=0.0.0.0 (Dockerfile já os define).
PUBLIC_URL é opcional na Render, pois usa RENDER_EXTERNAL_URL automaticamente. Se definir PUBLIC_URL, use a URL HTTPS EXATA do serviço ou domínio sem barra final, nunca a URL do GitHub Pages. Origem incorreta produz 403.

O banco do Turso deve ser compatível com @libsql/client, não presumir compatibilidade com outro engine. Não criar outro banco nem substituir dados existentes sem necessidade. Em Render sem Turso configurado, o servidor recusa início para não perder dados no disco efêmero. Banco e imagens enviadas ficam no Turso.

Depois do deploy abra /api/health: deve retornar ok:true e version:3.1.0. Em /admin use SETUP_TOKEN apenas se não houver proprietário. Se já houver, entre com a conta existente. Nunca recriar dono ou apagar banco como solução de erro. Libere operação após preencher/revisar dados reais. Teste cadastro, reserva, conflito em outro navegador, remarcação, cancelamento e painel no ambiente real.

## Limites que continuam
Resend precisa de conta, domínio verificado e chaves de servidor para e-mail real; não foi enviado e-mail externo neste trabalho. WhatsApp é manual, sem disparos. Pagamento no local, sem Pix/cartão online. Um estabelecimento por instalação; sem SaaS multitenant. Rate limit em memória, dimensionado para uma instância; avaliar proteção distribuída antes de escalar. Fuso America/Bahia (UTC−03) e janela de 90 dias.

Render Free dorme e perde disco local; adequado apenas para demonstração/piloto acompanhado, não garantia de operação contínua. Lembretes podem atrasar com suspensão. Planejar hospedagem de produção, custos e cópias externas antes de vender disponibilidade contínua. Não foram contratados serviços pagos.

## Evidência e pendências
npm test: 57 testes passaram em SQLite local, cliente libSQL usando arquivo de teste e modo production com ambiente simulado. Incluem sessões/permissões, conflitos, idempotência, backups/migração e bloqueio de produção. npm audit --omit=dev: zero vulnerabilidades reportadas na consulta de 14/11/2026 (não equivale a auditoria completa de segurança).
Página local carregou catálogo real da API no navegador. A ferramenta de navegador perdeu a sessão ao tentar clicar; por isso o fluxo visual completo de login/reserva/painel NÃO foi concluído nesta rodada. Testes HTTP do fluxo passaram. Conexão com o Turso remoto e deploy Render ainda dependem da configuração real e da URL do serviço para verificação; não são cobertos pelo teste de libSQL local.

Fontes: https://render.com/docs/environment-variables ; https://render.com/docs/free ; https://docs.turso.tech/sdk/ts/reference
