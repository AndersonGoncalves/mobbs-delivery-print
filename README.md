# mobbs-delivery-print

Serviço local (Windows/Linux) que imprime a comanda de um pedido de delivery/retirada assim que
ele é confirmado na retaguarda — sem precisar abrir a tela de "Pedidos em andamento" e clicar em
"Imprimir". Roda no computador que está ligado à impressora térmica (normalmente o computador do
caixa), consultando o BFF do mobbs-delivery em segundo plano.

Documentação completa do comportamento esperado: `specs/0139-impressao-automatica-bridge`, no
repositório `mobbs-delivery-app`.

## Como funciona

1. Na retaguarda web, em **Configurações > Impressão automática**, gere uma chave de API e ligue
   a impressão automática.
2. Configure este serviço (`.env`, abaixo) com essa chave e rode-o no computador ligado à
   impressora.
3. A cada pedido de delivery/retirada confirmado, este serviço consulta o BFF (no intervalo
   configurado na retaguarda, padrão 10s), imprime a comanda e confirma ao BFF que imprimiu.

## Instalação

Pré-requisito: [Node.js](https://nodejs.org/) 18 ou mais recente, instalado no computador do
caixa (Windows ou Linux).

```bash
npm install
cp .env.example .env
```

Edite o `.env` com a chave de API (gerada na retaguarda) e o endereço da impressora — ver os
comentários no próprio `.env.example` pra cada sistema operacional.

## Rodando

Em primeiro plano, pra testar:

```bash
npm run build
npm start
```

Deve aparecer "Serviço mobbs-delivery-print iniciado..." no terminal. Se a impressora estiver
desligada ou mal configurada, o erro aparece no log a cada tentativa, sem derrubar o processo (o
próximo ciclo tenta de novo sozinho).

## Rodando em segundo plano (produção)

O computador do caixa não pode depender de um terminal aberto que alguém feche por engano. Use o
[PM2](https://pm2.keymetrics.io/) pra manter o serviço rodando sempre, inclusive depois de
reiniciar o computador:

```bash
npm install -g pm2
npm run build
pm2 start dist/index.js --name "mobbs-delivery-print"
pm2 startup   # siga a instrução que o comando imprime, pra iniciar junto com o sistema
pm2 save
```

Comandos úteis depois disso: `pm2 logs mobbs-delivery-print` (ver o log), `pm2 restart
mobbs-delivery-print` (reiniciar, ex. depois de mudar o `.env`).

## Desenvolvimento

```bash
npm run dev     # roda com reinício automático a cada mudança de código
npm test        # testes (sem precisar de impressora/BFP reais — tudo mockado)
npm run lint
```

## Estrutura

- `src/config.ts` — lê e valida o `.env`.
- `src/bffClient.ts` — consulta a fila de pedidos pendentes e confirma impressão no BFF.
- `src/printer.ts` — converte as linhas do recibo (já formatadas pelo BFF) em comandos ESC/POS
  via [`node-thermal-printer`](https://github.com/Klemen1337/node-thermal-printer).
- `src/pollCycle.ts` — um ciclo de consulta (testável, sem `setTimeout`).
- `src/index.ts` — ponto de entrada: monta as peças acima e roda o laço de consulta.
