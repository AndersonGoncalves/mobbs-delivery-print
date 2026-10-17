# Testes do `mobbs-delivery-print`

Guia de como rodar os testes automatizados do serviço de impressão. Para rodar o serviço em si,
veja o [`README.md`](./README.md).

## Visão geral

| Item | Valor |
|---|---|
| Framework | **Jest 29** + **ts-jest** (TypeScript direto, sem build prévio) |
| Config | [`jest.config.js`](./jest.config.js) — `testEnvironment: node`, `testMatch: **/*.spec.ts` |
| Onde ficam os testes | `src/*.spec.ts`, um por módulo (`config`, `bffClient`, `pollCycle`, `printer`, `localServer`, `setup`, `windowsPrinterDriver`) |
| Tamanho atual | 7 arquivos / 48 testes, ≈ 30 s |
| Dependências externas | **Nenhuma** — BFF, impressora e PowerShell/driver do Windows são mockados. Não precisa de impressora, BFF no ar nem `.env` |

Pré-requisito: `npm install` (Node 20).

## Rodando pelo terminal

```bash
cd mobbs-delivery-print

npm test                                   # todos os testes (jest --passWithNoTests)
npx jest src/pollCycle.spec.ts             # um arquivo
npx jest -t "impressão"                    # só testes cujo nome contém o texto
npx jest --watch                           # re-roda ao salvar
npx jest --verbose                         # lista cada teste
npx jest --runInBand                       # um processo só (depuração)
```

### Cobertura

```bash
npx jest --coverage                        # tabela por arquivo + coverage/lcov-report/index.html
```

A pasta `coverage/` está no `.gitignore`.

### Gates antes de publicar

O pipeline `release-windows.yml` só faz `npm ci`, `build` e `package:win` — **não roda os testes**,
então rode-os localmente antes de publicar:

```bash
npm run lint && npm test && npm run build
```

## Rodando pelo VS Code (painel **Testing**, igual ao do Flutter)

O painel *Testing* do VS Code é genérico: o Flutter/Dart aparece nele pela extensão do Dart, e o
Jest aparece por uma extensão própria.

1. Instale a extensão **Jest** (`orta.vscode-jest`).
2. Abra a pasta `mobbs-delivery-print` (ou, num workspace com várias pastas, configure a raiz do
   Jest em `.vscode/settings.json`):

   ```json
   {
     "jest.rootPath": "/home/anderson/DevPrograms/Projetos/delivery/mobbs-delivery-print",
     "jest.jestCommandLine": "npx jest"
   }
   ```

3. Os testes aparecem no painel *Testing* em árvore, com ▶ por teste/arquivo, ✔/✖ e *Debug Test*;
   também aparece o ▶ acima de cada `it(...)` no arquivo `.spec.ts`. Como a suíte é pequena, o
   modo automático padrão (re-roda ao salvar) é confortável.

## Melos?

**Não.** O Melos é uma ferramenta do ecossistema **Dart/Flutter** (lê `pubspec.yaml`) e não
enxerga projetos Node. Aqui o equivalente é o próprio `npm` (scripts do `package.json`). Para rodar
todos os projetos de uma vez, veja o "Resumo" de
`../mobbs-delivery-app/rodar-local/README.md`.

## Como os testes são escritos

- Tudo que toca o mundo externo é injetado/mockado: `BffClient` (axios), `Printer`
  (`node-thermal-printer`) e o driver nativo do Windows (`windowsPrinterDriver.spec.ts` mocka
  `child_process`/`fs`, ou seja, o PowerShell). Por isso os testes rodam igual em Linux, Windows ou CI.
- Ao mudar o contrato com o BFF (`types.ts`/`bffClient.ts`), atualize junto o `ReceiptLine`/
  `PendingOrder` espelhados do BFF (`mobbs-delivery-bff/src/modules/auto-print/`).

## Teste manual com impressora de verdade

Os testes automatizados não substituem imprimir uma comanda real. Para isso, suba o BFF local,
gere a chave em *Configurações → Impressão automática* na retaguarda e rode `npm run build &&
npm start` (ver `../mobbs-delivery-app/rodar-local/README.md`, seção 5).
