# Publicar uma barbearia

Esta configuração é para um único servidor Linux com Docker Compose e volume persistente. Uma instalação = uma barbearia. Não contrata automaticamente serviços nem altera DNS.

## Preparação

1. Tenha um servidor compatível com Docker Compose, um domínio ou subdomínio sob seu controle e acesso ao DNS.
2. Aponte o registro DNS do domínio ao IP público do servidor conforme instruções do provedor.
3. Permita tráfego de entrada nas portas 80 e 443. A aplicação não deve ficar exposta diretamente na porta 3000.
4. Envie este projeto sem a pasta `data` da sua demonstração e sem `.env` de outra instalação.
5. Crie `.env` junto ao `compose.yaml` com `DOMAIN=agenda.seu-dominio.com.br` (sem https e sem caminho).
6. Para e-mail, crie conta Resend, verifique o domínio de envio e adicione `RESEND_API_KEY` e `EMAIL_FROM` no mesmo `.env`. Mantenha o arquivo privado, por exemplo com permissão de leitura apenas para o administrador.

O Compose define PUBLIC_URL automaticamente como `https://` + DOMAIN e armazena o banco em volume Docker separado. O Caddy solicita e renova certificados HTTPS quando o DNS aponta corretamente e as portas estão acessíveis.

## Subir

No diretório do projeto, execute:

```sh
docker compose up -d --build
```

Verifique:

```sh
docker compose ps
docker compose logs --tail=100 app
docker compose logs --tail=100 web
```

O log não mostra o código de instalação. Para obtê-lo no seu terminal privado:

```sh
docker compose exec app cat /app/data/PRIMEIRO-ACESSO.txt
```

Abra `https://SEU-DOMINIO/admin`, crie a conta do proprietário com o código e guarde a chave de recuperação. O arquivo de primeiro acesso é removido após o cadastro.

Depois configure marca, equipe, serviços e horários. Cadastre uma conta de cliente sua para testar, confirme o e-mail e faça uma reserva real de teste. Confira o painel e cancele a reserva pelo cliente. Verifique se o período volta a ficar disponível.

## Atualizar e operar

- Faça backup antes de atualizar.
- Atualize o código e execute novamente `docker compose up -d --build`.
- Preserve o volume `agenda`. Não use `docker compose down -v`, que remove os volumes e os dados.
- Mantenha apenas uma réplica de `app` com este banco SQLite.
- Não coloque a pasta data em um diretório servido pelo proxy.
- Monitore espaço em disco, saúde do processo e falhas da fila de mensagens.
- Programe cópias externas dos dados e valide restauração periodicamente.
- Proteja o acesso SSH e mantenha servidor e imagens de contêiner atualizados.
- Envio de e-mails deve usar seu remetente verificado. Não compartilhe a mesma credencial de produção entre barbearias sem um controle operacional apropriado.

Backup pelo painel baixa o banco. Para copiar mídias do contêiner para uma pasta privada do servidor:

```sh
docker compose cp app:/app/data/media ./backup-media
```

Para recuperação offline do proprietário:

```sh
docker compose exec app node maintenance.mjs recover-owner
```

## Limites verificados

Código e fluxo foram testados localmente. O ambiente desta entrega não tem Docker instalado para executar esse contêiner. DNS, emissão de certificado, entrega de e-mail e backup externo só podem ser verificados após a hospedagem ser escolhida e configurada. O pacote não afirma que esses serviços já estejam ativos.

Referências técnicas: https://docs.docker.com/compose/ e https://caddyserver.com/docs/automatic-https
