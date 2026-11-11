# Publicação na Render Free

Siga o passo a passo na seção "Hospedagem gratuita para demonstração" do README.md.

- Runtime: Docker.
- Branch: main.
- Root Directory: vazio.
- Compute: Free.
- Disks: nenhum.
- Health check: /api/health.
- Variáveis obrigatórias: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, SETUP_TOKEN.
- NODE_ENV=production e HOST=0.0.0.0 já estão no Dockerfile.
- PUBLIC_URL é detectada por RENDER_EXTERNAL_URL; não invente um domínio antes do deploy.

A URL e o token devem apontar para um banco libSQL no Turso. O schema é inicializado automaticamente, com tabelas próprias para contas, reservas, sessões e mídias. Não coloque credenciais no GitHub ou no navegador dos clientes.

Na Render, configure as variáveis antes de clicar em Deploy web service. A ausência do banco externo impede o servidor de iniciar, para evitar usar acidentalmente o disco efêmero como banco principal. Se receber erro de token, confira a chave na Render; não publique prints com valores secretos.

Após o deploy, abra a URL HTTPS fornecida, vá em /admin e crie o proprietário com o código SETUP_TOKEN. Guarde a chave de recuperação. Cadastre equipe e serviços, faça uma reserva piloto, reinicie a aplicação e confirme que a reserva e a logo continuam disponíveis. Esse último teste com o serviço real ainda deve ser feito após a configuração da conta.

Para levar dados locais existentes, importe antes de criar uma nova conta do proprietário no destino; veja o README. Nunca apague o banco antigo antes de conferir a importação.

O plano Free suspende o processo por inatividade e não é indicado pela Render para operação de produção contínua. Lembretes podem atrasar. Acordar a página é esperado; usar requisições artificiais para evitar suspensão não faz parte desta solução.

Se no futuro optar por servidor próprio com disco persistente, Dockerfile/compose.yaml/Caddyfile continuam disponíveis. O Compose usa SQLite em volume persistente e exige domínio e servidor configurados. Não é a opção gratuita proposta aqui.

Referências: https://render.com/docs/free e https://docs.turso.tech/sdk/ts/reference
