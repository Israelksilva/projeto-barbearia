# Barbearia Teste — versão 3.0

Agendamento de uma barbearia por instalação, com página pública, painel do proprietário, serviços, equipe, contas de clientes, remarcação, cancelamento e personalização. Tema preto e dourado, logo enviada pelo proprietário e imagens ilustrativas.

## Hospedagem gratuita para demonstração

Esta versão suporta **Render Free + banco externo Turso/libSQL**. Banco, contas, reservas, configurações e imagens enviadas pelo painel ficam no Turso. Reiniciar ou substituir o disco da Render não apaga esses dados, desde que você continue usando o mesmo banco e token válidos.

A conta e o banco reais do Turso ainda precisam ser criados e conectados. A entrega não contém credenciais e não publica automaticamente o serviço.

1. Crie uma conta Free em https://app.turso.tech e um banco compatível com libSQL.
2. Obtenha a URL libsql://... e um token de acesso desse banco.
3. Na Render, conecte o repositório privado e escolha Docker, branch main, raiz vazia e compute Free. Não adicione disco pago.
4. Adicione as variáveis abaixo no painel Environment da Render. Não envie tokens pelo chat e não os coloque no GitHub.

| Variável | Valor |
|---|---|
| TURSO_DATABASE_URL | URL libsql://... fornecida pelo Turso |
| TURSO_AUTH_TOKEN | Token privado com permissão de leitura e escrita nesse banco |
| SETUP_TOKEN | Valor aleatório de 32 a 128 caracteres; use Generate na Render |
| NODE_ENV | production |
| HOST | 0.0.0.0 |

O endereço público é detectado por RENDER_EXTERNAL_URL. Se você usar outra hospedagem ou domínio próprio, configure PUBLIC_URL com o endereço HTTPS, sem barra final.

Após o deploy, abra /admin e use o valor de SETUP_TOKEN para cadastrar o proprietário. O código nunca é enviado ao navegador pela API. Uma vez criado o proprietário, ele não permite criar outra conta administrativa. Guarde a chave de recuperação exibida.

Também foi incluído render.yaml para uso opcional como Blueprint; ele não cria serviços sozinho. Ele solicita as duas variáveis do banco e gera SETUP_TOKEN. Confira plano Free antes de confirmar qualquer criação de serviço.

### Limites do modo gratuito

- A Render Free pode suspender o processo por inatividade; o primeiro acesso pode demorar para acordar a aplicação.
- Lembretes por e-mail dependem de o processo estar rodando. Podem atrasar após suspensão; não há garantia de envio pontual no Free.
- O plano gratuito do Turso tem limites de armazenamento, leitura e escrita. Monitore a conta e não ative cobrança excedente sem decidir por isso.
- A persistência depende da disponibilidade do provedor e da manutenção do banco. Exclusão da conta/banco ou perda das credenciais pode interromper o serviço.
- Este caminho é para demonstração e piloto acompanhado. Antes de vender operação contínua, valide custos, disponibilidade, privacidade e cópias externas com o cliente.

Referências: [Render Free](https://render.com/docs/free), [Turso Free](https://turso.tech/pricing?frequency=monthly), [cliente libSQL](https://docs.turso.tech/sdk/ts/reference).

## Abrir no VS Code e executar localmente

Requer Node.js 24+. Abra a pasta que contém package.json e execute:

```sh
npm ci
npm start
```

Sem TURSO_DATABASE_URL, usa o SQLite local em data/agenda.sqlite e preserva bancos da versão anterior. O código de primeiro acesso local fica em data/PRIMEIRO-ACESSO.txt.

Copie .env.example para .env se quiser configurar outro PORT ou usar um banco remoto localmente. Nunca compartilhe .env, data ou node_modules. Não execute uma segunda instância na mesma porta.

## Funções disponíveis

- Conta do proprietário e de clientes com senha, sessão HttpOnly, recuperação e verificação de e-mail.
- Cadastro de serviços com preço e duração variável, equipe com expediente/intervalo próprio e bloqueios por data.
- Agenda por profissional, proteção contra sobreposição de horários, remarcação e cancelamento.
- Reservas manuais, registro de atendido/falta e indicadores diários. Valores atendidos não confirmam recebimentos bancários.
- Nome, telefone, endereço, apresentação, logo e foto editáveis.
- Exportação da agenda CSV, arquivo ICS de horário e exportação dos dados do cliente.
- Exclusão da conta com cancelamento e remoção dos dados de contato no banco principal.
- WhatsApp com mensagem preenchida para envio manual. Não há disparo automático de WhatsApp.
- Pagamento no estabelecimento. Não inclui gateway de pagamentos, estoque, comissões ou emissão fiscal.

Todos os profissionais ativos atendem o catálogo. Reservas nos próximos 90 dias, em intervalos de 15 minutos. Fuso America/Bahia, UTC−03. O cancelamento pelo cliente segue a antecedência configurada. Reservas antigas mantêm preço e duração originais.

## E-mails

Para envio real, configure RESEND_API_KEY e EMAIL_FROM (remetente verificado) no servidor. O endereço do site vem de PUBLIC_URL ou RENDER_EXTERNAL_URL. O envio não está ativado apenas por cadastrar uma conta de cliente.

Confirmações, remarcações, cancelamentos e lembretes são enviados somente para e-mails verificados. A fila registra falhas e tentativas; aceite pelo provedor não comprova entrega na caixa de entrada. Sem provedor, login e recuperação por chave continuam funcionando. E-mails externos não foram enviados nos testes.

## Backup e migração

No modo Turso, o painel baixa um backup JSON com os dados e as imagens enviadas. Guarde uma cópia privada e criptografada fora da Render. Não há backup automático durável no disco gratuito da Render.

No modo SQLite local, o download continua sendo .sqlite; o servidor mantém até 14 cópias no disco local, feitas a cada inicialização e a cada 24 horas de funcionamento. Imagens novas são armazenadas no próprio banco. Imagens de instalações antigas ainda podem estar em data/media e devem ser preservadas.

Para migrar uma instalação local existente para um banco Turso novo e vazio:

1. Faça backup e pare o servidor local. Não altere o arquivo original durante a importação.
2. Configure as credenciais do banco de destino em .env.
3. No PowerShell:

```powershell
$env:CONFIRM_IMPORT = 'sim'
npm run db:import -- 'C:\caminho\data\agenda.sqlite'
Remove-Item Env:CONFIRM_IMPORT
```

No Linux/macOS: `CONFIRM_IMPORT=sim npm run db:import -- /caminho/agenda.sqlite`.

O mesmo comando aceita um backup JSON criado por esta versão. A operação recusa destinos que já tenham contas ou reservas e reverte toda a importação em caso de erro. Ela inclui imagens antigas referenciadas em data/media. Não sobrescreve nem exclui o banco original. A migração não é executada automaticamente e não foi aplicada aos seus dados neste computador.

Verificar conexão: `npm run db:check`. Exportar backup por terminal: `npm run backup`. Recuperação administrativa offline: `node --env-file-if-exists=.env maintenance.mjs recover-owner` (gera chave nova e revoga sessões do dono).

## Verificação desta entrega

`npm test` testa os fluxos com SQLite nativo e com o cliente libSQL usando um arquivo local dedicado de teste. Inclui concorrência, isolamento de clientes, reinício com disco da aplicação novo, imagens, backup, importação, rollback e restauração JSON. Não substitui a validação final com a URL e o token reais do Turso, que precisam ser criados pelo proprietário.

Docker e deploy na Render ainda precisam ser executados na conta real. Não há serviço externo novo contratado nesta entrega.

## Direitos autorais

© 2026 Israelksilva. Todos os direitos reservados. Consulte [LICENSE](LICENSE).
