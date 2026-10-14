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
2. Baixe e rode este serviço no computador ligado à impressora (ver "Instalação" abaixo) — ele
   pergunta a chave e a impressora na primeira execução.
3. A cada pedido de delivery/retirada confirmado, este serviço consulta o BFF (no intervalo
   configurado na retaguarda, padrão 10s), imprime a comanda e confirma ao BFF que imprimiu.
4. **specs/0147-impressao-manual-direta-bridge** — além disso, enquanto este serviço estiver
   rodando, o botão "Imprimir" manual da retaguarda passa a usá-lo direto (sem diálogo de
   impressão, sem esperar o próximo ciclo): o serviço escuta em
   `http://127.0.0.1:48201/print-now`, só aceita chamadas da retaguarda oficial
   (`https://bsdelivery.com.br`). Se a retaguarda não conseguir falar com ele (serviço fechado,
   computador diferente), ela cai sozinha pro botão "Imprimir" de sempre — nenhuma configuração
   extra é necessária.

## Instalação (Windows, sem precisar instalar nada)

specs/0141-instalador-bridge-impressao — a forma recomendada pra quem só quer usar, sem mexer em
código: baixe o executável pronto, direto da retaguarda web (`/painel/auto-print`, botão "Baixar o
programa de impressão") ou direto do link estável:

```text
https://github.com/AndersonGoncalves/mobbs-delivery-print/releases/latest/download/mobbs-delivery-print-win.exe
```

Esse link sempre aponta pra versão mais recente — não precisa escolher nada. Dê dois cliques no
`.exe` baixado: na primeira vez, ele pergunta no próprio terminal a URL do BFF (Enter aceita o
padrão de produção), a Chave de API (a mesma gerada em "Impressão automática" na retaguarda), a
interface da impressora e o tipo dela — e já começa a rodar. Nas próximas vezes, não pergunta mais
nada (a configuração fica salva num `.env` ao lado do `.exe`).

O Windows pode mostrar um aviso do SmartScreen/Defender ("aplicativo desconhecido") por não ser um
executável assinado digitalmente — clique em "Mais informações" → "Executar assim mesmo".

Pra deixar rodando sempre, sem precisar abrir manualmente: crie um atalho do `.exe` e coloque-o na
pasta de Inicializar do Windows (`Win+R` → `shell:startup`) — ele abre sozinho (minimizado na
bandeja não é suportado nesta versão; fica uma janela de terminal aberta, que não deve ser
fechada).

## Instalação a partir do código-fonte (desenvolvimento)

Pré-requisito: [Node.js](https://nodejs.org/) 18 ou mais recente.

```bash
npm install
npm run build
npm start
```

Mesmo comportamento do `.exe`: sem `.env` na pasta, pergunta a configuração na primeira execução e
grava um `.env` (também aceita criar o `.env` manualmente a partir de `.env.example`, se preferir
não usar o setup interativo).

Deve aparecer "Serviço mobbs-delivery-print iniciado..." no terminal. Se a impressora estiver
desligada ou mal configurada, o erro aparece no log a cada tentativa, sem derrubar o processo (o
próximo ciclo tenta de novo sozinho).

## Rodando em segundo plano a partir do código-fonte (produção, sem ser o `.exe`)

Só se aplica a quem instalou a partir do código-fonte (seção anterior) — o `.exe` empacotado não
funciona com PM2 (ele não é um script Node.js comum, é um binário standalone; use o atalho na
pasta Inicializar, descrito acima, nesse caso). O computador do caixa não pode depender de um
terminal aberto que alguém feche por engano. Use o [PM2](https://pm2.keymetrics.io/) pra manter o
serviço rodando sempre, inclusive depois de reiniciar o computador:

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

- `src/setup.ts` — setup interativo da primeira execução (pergunta e grava o `.env`, só quando ele
  ainda não existe).
- `src/config.ts` — lê e valida o `.env`.
- `src/bffClient.ts` — consulta a fila de pedidos pendentes e confirma impressão no BFF.
- `src/printer.ts` — converte as linhas do recibo (já formatadas pelo BFF) em comandos ESC/POS
  via [`node-thermal-printer`](https://github.com/Klemen1337/node-thermal-printer).
- `src/pollCycle.ts` — um ciclo de consulta (testável, sem `setTimeout`).
- `src/localServer.ts` — servidor HTTP local (`127.0.0.1:48201`) pro botão "Imprimir" manual da
  retaguarda imprimir na hora, sem esperar o próximo ciclo (specs/0147).
- `src/index.ts` — ponto de entrada: monta as peças acima, inicia o servidor local e roda o laço
  de consulta.
