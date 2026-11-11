# Abrir no VS Code

1. Extraia o ZIP inteiro; não abra os arquivos diretamente de dentro do ZIP.
2. No VS Code, escolha Arquivo > Abrir Pasta e selecione a pasta barbearia. Você também pode abrir Barbearia.code-workspace.
3. Tenha Node.js 24 ou superior instalado.
4. Abra Terminal > Novo Terminal e execute:

```sh
npm start
```

5. Abra http://localhost:3000. O painel está em http://localhost:3000/admin.

Não precisa executar npm install: esta versão utiliza apenas recursos incluídos no Node.js.

Também é possível usar Terminal > Executar Tarefa > Barbearia: iniciar. Para testes, execute npm test ou a tarefa Barbearia: testar.

Para parar, pressione Ctrl+C no terminal do servidor. Caso a porta 3000 já esteja ocupada, encerre a outra instância antes de iniciar. Como alternativa, copie .env.example para .env, altere PORT para 3001 e abra http://localhost:3001.

## Onde editar

- public/index.html: página pública.
- public/admin.html: painel.
- public/theme.css: preto e dourado.
- public/assets/: logo e imagens.
- public/app.js e public/admin.js: comportamento das telas.
- server.mjs: API e servidor.
- lib/: banco, autenticação, agenda e mensagens.

Ao modificar HTML, CSS ou JavaScript do navegador, atualize a página. Ao modificar server.mjs ou lib/, pare e inicie o servidor novamente.

O ZIP vem sem dados pessoais. Na primeira execução ele gera data/PRIMEIRO-ACESSO.txt para criar uma nova conta do proprietário. A pasta aberta neste computador preserva o acesso e os dados já cadastrados. Não compartilhe a pasta data ou o arquivo .env com compradores; distribua o ZIP limpo.
