# Traço Barbearia — versão comercial 2.0

Sistema de agendamento para uma barbearia por instalação. Código sem dependências npm externas, com Node.js 24+ e banco SQLite persistente. O projeto original enviado serviu como referência de proposta; esta entrega é a reconstrução independente iniciada neste chat.

## Abrir agora no Windows

1. Instale Node.js 24 ou superior.
2. Extraia o ZIP em uma pasta privada e abra `INICIAR.bat`.
3. Acesse http://localhost:3000/admin.
4. Abra `data/PRIMEIRO-ACESSO.txt`, gerado na primeira inicialização, e use o código para criar a conta do proprietário. Não há senha padrão.
5. Salve a chave de recuperação exibida após o cadastro. Ela permite recuperar sua conta mesmo sem e-mails configurados.
6. No painel, personalize a marca e cadastre equipe, serviços, preços e expediente.
7. A página dos clientes fica em http://localhost:3000.

O terminal precisa ficar aberto enquanto o sistema é usado. Para interromper, pressione Ctrl+C. Em uso local, ele só atende o próprio computador. O ZIP não contém banco, contas, credenciais nem dados de demonstração.

## O que foi implementado

- Conta do proprietário, painel protegido e sessões HttpOnly com validade de sete dias.
- Conta de cliente, login em outros dispositivos, troca de senha, recuperação por chave e recuperação por e-mail quando configurado.
- Verificação de e-mail para receber mensagens de reservas.
- Serviços editáveis com preço em centavos e duração de 15 a 360 minutos, em múltiplos de 15.
- Equipe com expediente próprio, dias da semana e intervalo; todos atendem os serviços ativos.
- Disponibilidade considerando duração, intervalo, bloqueios, reservas existentes e horário passado.
- Transações SQLite para impedir conflitos de atendimento, inclusive entre serviços de durações diferentes.
- Agendamento pelo cliente e lançamento manual pelo proprietário.
- Remarcação, cancelamento e registro de atendido ou falta.
- Preço, nome e duração preservados na reserva mesmo quando o catálogo muda.
- Indicadores diários: confirmados, atendidos, cancelados e soma dos valores atendidos. Não se trata de confirmação bancária de pagamento.
- Personalização do nome, apresentação, endereço, WhatsApp, logo, foto e política de cancelamento.
- Exportação CSV da agenda e download dos dados do cliente.
- Exclusão da conta de cliente com cancelamento e remoção dos dados de contato no banco principal.
- Backups automáticos, download de cópia e histórico de ações administrativas.
- Fila de e-mails com confirmação, remarcação, cancelamento, verificação, recuperação e lembrete 24 horas antes.
- Botão de confirmação manual no WhatsApp e arquivo de calendário ICS para o cliente.
- Layout para desktop e celular, navegação por teclado, validações no servidor, proteção de origem e limitação de tentativas.

## Regras importantes

- Fuso de operação: America/Bahia (UTC−03), sem configuração para outros fusos nesta versão.
- Reservas online nos próximos 90 dias, com início em múltiplos de 15 minutos.
- Cancelamento/remarcação pelo cliente exigem a antecedência configurada (padrão: duas horas). O proprietário pode cancelar ou remarcar reservas confirmadas sem essa antecedência.
- Alterar expediente ou inativar um profissional exige resolver reservas futuras incompatíveis antes.
- Bloqueios não atropelam reservas já existentes: o painel exige remarcar ou cancelar antes.
- Status de atendido/falta só pode ser registrado a partir do horário de início. Não há reversão desses status pela interface nesta versão.
- Reservas canceladas liberam a disponibilidade, preservando o histórico.
- As primeiras reservas legadas são migradas com duração de 30 minutos, igual à versão antiga. O cliente precisa estar autenticado e manter o cookie antigo para acessá-las; o proprietário vê todas pelo painel. Faça backup antes de atualizar uma instalação real.

## E-mails e WhatsApp

O envio real de e-mails exige uma conta Resend, domínio de envio verificado e configuração das variáveis descritas em `.env.example`. Nenhum envio externo foi realizado na validação desta entrega.

Copie `.env.example` para `.env`, preencha `RESEND_API_KEY`, `EMAIL_FROM` e `PUBLIC_URL`, e reinicie. As chaves ficam somente no servidor. Não as coloque no código, no ZIP ou no chat.

A fila é processada a cada 30 segundos, com até cinco tentativas e espera crescente entre falhas. O servidor precisa estar permanentemente ligado. Somente e-mails confirmados recebem mensagens de agendamento. Reservas feitas menos de 24h antes recebem confirmação, sem lembrete retroativo. Reagendar invalida lembretes pendentes da versão anterior. O estado “aceito pelo provedor” não comprova entrega na caixa de entrada. Não há rastreamento de abertura, bounces ou webhook de entrega nesta versão.

O WhatsApp abre uma mensagem preenchida para o proprietário revisar e enviar. Não há disparo automático de WhatsApp nem dependência de API da Meta. Pagamentos são realizados no estabelecimento; não há gateway de cobrança ou PIX conciliado.

Referência do provedor de e-mail: https://resend.com/docs/api-reference/emails/send-email

## Dados e backup

A pasta `data/` é privada. Ela contém o banco, mídias e backups; nunca publique essa pasta como arquivos estáticos.

- Banco: `data/agenda.sqlite` e seus arquivos WAL/SHM enquanto estiver aberto.
- Imagens: `data/media/`.
- Backups: `data/backups/`, até 14 arquivos automáticos mantidos pelo servidor.
- Backup automático: na inicialização e a cada 24 horas enquanto o servidor roda.
- Backup completo do banco pelo painel: Dados e segurança > Baixar backup.
- Backup pelo terminal: `npm run backup`.

Backups no mesmo disco protegem contra alterações acidentais, mas não contra perda do servidor. Configure cópia externa, privada e criptografada com o provedor de hospedagem. Copie também as imagens. A política de retenção deve ser revista com a barbearia antes de atender clientes reais.

Para restaurar: desligue o servidor, faça uma cópia da pasta data atual, mova o banco atual e seus arquivos `-wal` e `-shm` para uma pasta de preservação e coloque o backup desejado como `data/agenda.sqlite`. Restaure as imagens correspondentes. Com o servidor ainda parado, execute `node --env-file-if-exists=.env maintenance.mjs check`; o resultado esperado é `ok`. Depois inicie novamente. Nunca substitua o banco com o servidor ligado. Uma restauração pode recuperar sessões antigas ainda válidas; revogue-as se necessário.

Se o proprietário perder senha e chave e não tiver e-mail configurado, a pessoa com acesso ao servidor pode gerar uma nova chave com `node --env-file-if-exists=.env maintenance.mjs recover-owner`. Esse comando revoga as sessões do dono e invalida a chave anterior. Restrinja o acesso ao servidor.

## Publicação

Leia `PUBLICAR.md`. A entrega inclui Dockerfile, Docker Compose, proxy Caddy e configuração de HTTPS para um domínio que você controle. Não foram contratados domínio, hospedagem ou e-mail. Não há URL pública publicada nesta entrega.

Este backend usa disco persistente. Não publique em hospedagem de arquivos estáticos ou em função sem persistência local. A hospedagem Sites disponível neste ambiente executa Cloudflare Workers/D1 e não executa este servidor Node/SQLite sem uma adaptação de backend. Por isso não foi publicado um front-end que deixaria a agenda desconectada.

## Testes

Na pasta do projeto: `npm test`.

A suíte usa bancos temporários e cobre setup, autenticação, permissões, conflitos simultâneos, duração, intervalos, bloqueios, remarcação com preço original, cancelamento, recuperação, exclusão, exportação, backup, reinício, fila de e-mails e migração da primeira versão.

Também foram verificados no navegador o login do dono, cadastro de serviço, reserva manual e reserva pela página pública; layout do painel em largura de celular. Os testes de transporte de e-mails usam uma função controlada, sem enviar mensagens reais. Docker e publicação externa precisam ser validados na hospedagem escolhida.

## Escopo comercial

Uma instalação atende uma barbearia com vários profissionais. Para vender a outra, instale o pacote limpo com outro banco, outro domínio e outras credenciais. Não é um SaaS que separa várias empresas no mesmo banco, e não inclui cobrança de mensalidades dos seus clientes, estoque, comissões ou contabilidade.

Antes do primeiro cliente real: configure os contatos, confira serviços e horários com o proprietário, personalize o aviso de privacidade, valide HTTPS e backup/restauração na hospedagem e faça uma reserva piloto completa com confirmação de e-mail. A entrega não substitui uma auditoria de segurança independente.

## Atualização visual 2.1

Tema preto e dourado aplicado à página pública, formulários e painel. Imagens ilustrativas geradas por IA incluídas localmente em public/assets, sem depender de sites de fotos externos. A foto personalizada no painel prevalece sobre a imagem padrão. Consulte IMAGENS.md para os prompts usados. Aparência verificada em desktop e celular.

## Direitos autorais

© 2026 Israelksilva. Todos os direitos reservados.

A disponibilização do código neste repositório não concede uma licença geral para uso ou comercialização. Para autorizações e licenciamento comercial, entre em contato com [Israelksilva](https://github.com/Israelksilva). Consulte o arquivo [LICENSE](LICENSE).

Como o repositório é público, continuam valendo os direitos de visualização e fork previstos nos termos do GitHub. Referência: [Licenciamento de repositórios](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).
