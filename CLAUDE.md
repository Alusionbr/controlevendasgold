# CLAUDE.md — Controle360 Multi

## Finalidade

Este projeto é um MVP local para controlar múltiplos negócios no mesmo sistema:

- estoque de matéria-prima, embalagens, produtos finais, kits, mercadorias e serviços;
- custo médio ponderado;
- ficha técnica / composição de produto;
- custo de produção;
- preço sugerido de venda por margem desejada e taxas;
- vendas com CMV e lucro bruto;
- pedidos pendentes, em preparo, prontos, despachados e concluídos;
- quadro Kanban de tarefas;
- consignado por cliente;
- clientes, fornecedores e relatórios.

O sistema deve continuar **sem dados de exemplo preenchidos**. Configurações padrão como unidades, tipos e status podem existir, mas não cadastrar produtos/clientes/fichas automaticamente.

---

## Contexto de uso

O usuário quer liberdade para trabalhar com vários negócios. Exemplos:

1. Essências aromáticas: matéria-prima, vidro, rótulo, caixa, tampa, lacre, embalagem, mão de obra e perda técnica.
2. Marmitas/alimentos: ingredientes, embalagem, produção, venda, canal e CMV.
3. Revenda/mercadorias: compra, custo médio, venda, estoque e consignado.
4. Serviços com materiais: pode usar produtos físicos e custo rateado.

Não crie lógica presa a um único nicho. Use nomes genéricos: produto, matéria-prima, embalagem, ficha técnica, pedido, venda, cliente, fornecedor, consignado.

---

## Princípios obrigatórios

### 1. Revisão humana fácil

- Código em arquivos pequenos e com nomes claros.
- Evitar abstração excessiva.
- Funções devem ter responsabilidade única.
- Não misturar regra de negócio com CSS.
- Não esconder cálculo importante em função sem nome claro.
- Não adicionar bibliotecas externas sem necessidade real.
- Preferir JavaScript puro no MVP.

### 2. Estoque nunca deve ser alterado sem movimentação

Toda alteração relevante no estoque físico deve gerar registro em `stockMovements`:

- compra: `entrada_compra`;
- produção: `saida_producao_insumo` e `entrada_producao_produto_final`;
- venda: `saida_venda`;
- envio consignado: `saida_envio_consignado`;
- devolução consignada: `entrada_devolucao_consignado`;
- ajustes futuros: `ajuste_manual` com motivo obrigatório.

### 3. Produto final deve ser calculável por ficha técnica

Um produto final ou kit pode consumir qualquer quantidade de:

- matéria-prima;
- embalagem;
- mercadoria comprada pronta;
- outro item físico, desde que não consuma ele mesmo.

A ficha técnica fica em `recipes`.

### 4. CMV deve usar custo no momento da venda

Venda direta usa `product.avgCost` no momento da venda.

Venda via consignado usa `costAtSend`, porque o estoque central já foi baixado no envio.

### 5. Consignado não é venda no envio

Envio consignado significa:

```txt
Estoque central -> estoque sob responsabilidade do cliente
```

A venda só acontece quando o cliente informa venda. O pagamento é outro evento.

---

## Estrutura de arquivos

```txt
controle-estoque-cmv-consignado/
├── index.html
├── README.md
├── CLAUDE.md
├── src/
│   ├── utils.js           # helpers puros: moeda, número, data, id, HTML escape
│   ├── api.js             # cliente Supabase (Auth + PostgREST + Edge Function), fetch puro
│   ├── state.js           # cache assíncrono alimentado por C360.api, espelho em localStorage
│   ├── calculations.js    # cálculos de custo, preço, CMV, consignado, métricas e piso de preço
│   ├── ui.js              # geradores de HTML reutilizáveis
│   ├── auth.js            # login/logout, sessão, papel (admin/vendedor), gestão de vendedores
│   ├── pricing.js         # preço padrão/piso por produto e preço específico por vendedor (admin)
│   ├── returns.js         # devolução e desperdício lançados a partir de uma venda
│   ├── sellerStock.js     # estoque próprio do vendedor -> consignado, e aprovação de pedidos (admin)
│   ├── calculator.js      # calculadora padrão + margem/markup/desconto/preço-alvo
│   ├── goals.js           # metas de vendas semanais/mensais com premiação
│   ├── sellerHelp.js      # central de ajuda/onboarding do vendedor
│   └── app.js             # telas, eventos, portão de autenticação e fluxos de negócio
├── styles/
│   └── main.css
├── docs/
│   ├── regras-negocio.md
│   ├── modelo-dados.md
│   ├── fluxos-operacionais.md
│   └── roadmap.md
└── tests/
    └── checklist-manual.md
```

---

## Modelo de dados principal

O estado fica no LocalStorage em `controle360_multi_v2`.

Coleções principais:

- `businesses`
- `products`
- `clients`
- `suppliers`
- `purchases`
- `stockMovements`
- `recipes`
- `productions`
- `sales`
- `orders`
- `consignments`
- `consignmentEvents`
- `tasks`

Toda coleção operacional, exceto `businesses`, deve ter `businessId`.

---

## Campos importantes de produto

```js
{
  id,
  businessId,
  name,
  type,
  unit,
  currentStock,
  avgCost,
  salePrice,
  minStock,
  laborCostPerUnit,
  overheadCostPerUnit,
  lossPercent,
  targetMarginPercent,
  taxFeePercent,
  notes
}
```

Tipos aceitos no MVP:

- `materia_prima`
- `embalagem`
- `produto_final`
- `mercadoria`
- `kit`
- `servico`

---

## Fórmulas obrigatórias

### Custo médio ponderado

```txt
novo_custo_medio = (estoque_atual * custo_medio_atual + valor_nova_entrada) / (estoque_atual + quantidade_entrada)
```

### Custo de produto por ficha técnica

```txt
custo_materiais = soma(qtd_por_unidade * custo_medio_do_item)
base = custo_materiais + mao_de_obra_por_unidade + custo_fixo_rateado_por_unidade
perda = base * perda_percentual
custo_final_unidade = base + perda
```

### Preço sugerido

```txt
preco_sugerido = custo_final_unidade / (1 - margem_desejada - taxas_percentuais)
```

Exemplo: custo R$ 10, margem desejada 50%, taxa 5%:

```txt
preço = 10 / (1 - 0,50 - 0,05) = 22,22
```

### Venda

```txt
receita_bruta = quantidade * preco_unitario
receita_liquida = receita_bruta - desconto - taxa_fixa - taxa_percentual
cmv = quantidade * custo_unitario_no_momento
lucro_bruto = receita_liquida - cmv
margem = lucro_bruto / receita_liquida
```

---

## Regras para próximas alterações

Antes de alterar código:

1. Leia `docs/regras-negocio.md`.
2. Confira se a alteração afeta estoque, CMV, produção ou consignado.
3. Se afetar cálculo, altere primeiro `src/calculations.js`.
4. Se afetar estrutura de dados, atualize `docs/modelo-dados.md`.
5. Se criar novo fluxo, atualize `docs/fluxos-operacionais.md`.
6. Rode o checklist manual em `tests/checklist-manual.md`.

Não implemente recursos novos diretamente em `app.js` sem avaliar se a lógica pertence a `calculations.js` ou `state.js`.

---

## Não fazer

- Não preencher produtos, clientes ou fichas de exemplo.
- Não apagar histórico de movimentação ao corrigir estoque.
- Não misturar consignado com venda imediata.
- Não usar FIFO/LIFO nesta versão.
- Login e backend já existem (Supabase Auth + Postgres, ver seção "Atualização: multiusuário" no fim deste arquivo) — não adicionar um segundo mecanismo de autenticação nem outro backend (Firebase etc.) em paralelo.
- Não transformar serviços em estoque físico.
- Não permitir estoque negativo sem uma regra explícita de ajuste futuro.

---

## Ideias aprovadas para evolução

Prioridade alta:

1. Edição de registros com trilha de auditoria.
2. ~~Ajuste manual de estoque com motivo obrigatório.~~ Feito: aba Produtos,
   ação "Ajustar estoque" → `stock_movements` tipo `ajuste_manual`.
3. Multi-item por venda e pedido.
4. Relatório de contas a receber e a pagar.
5. Impressão/geração de etiqueta ou lista de separação.
6. Conversão para IndexedDB para maior volume de dados.
7. Exportação CSV por módulo.

Prioridade média:

1. Múltiplas tabelas de preço por canal.
2. Lotes e validade.
3. Comissão de vendedor ou consignado.
4. Anexar comprovante/foto/nota fiscal.
5. Controle de entregas e rastreio.

Prioridade futura:

1. SQLite local com app desktop.
2. Firebase/Supabase para multi-dispositivo.
3. App iOS/Android.
4. Painel web com login.

---

## Estado atual do MVP

Funciona localmente abrindo `index.html` no navegador.

Persistência atual: LocalStorage.

Inclui:

- cadastro de negócios;
- cadastro de produtos e custos;
- clientes;
- fornecedores;
- compras com custo médio;
- ficha técnica;
- cálculo de custo e preço sugerido;
- produção com baixa de insumos;
- vendas com CMV;
- pedidos em Kanban;
- tarefas em Kanban;
- consignado com venda, devolução e pagamento;
- relatórios básicos;
- backup JSON.

---

## Atualização: exportação/importação e interface

### Novos arquivos

```txt
src/xlsx-lite.js     # motor .xlsx em JS puro (escreve ZIP "stored", lê com a API nativa de descompressão)
src/exportImport.js  # camada de domínio: Excel completo, CSV por módulo e JSON (exportar/importar)
```

### Regras

- `src/xlsx-lite.js` é genérico e sem regra de negócio: só converte `[{name, rows}]` em `.xlsx` e de volta. Não colocar lógica de negócio aqui.
- `src/exportImport.js` define o mapa `COLLECTIONS` (coleção → aba → ordem de colunas) e os rótulos em português. Ao adicionar um campo novo a uma coleção, inclua a chave em `fields` e, se for número, em `NUMERIC_KEYS`; se for data, em `DATE_KEYS`.
- Excel é backup **completo e reversível**: a aba `Backup_NAO_EDITAR` carrega `settings`, `meta` e `activeBusinessId`. As abas de dados são a fonte de verdade dos registros.
- Importação (Excel ou JSON) passa por `state.replaceState`, que normaliza o estado. Sempre pedir confirmação antes de substituir.
- Não adicionar biblioteca externa para Excel: o motor próprio mantém o projeto offline e revisável.

### Interface

- Cabeçalho e barra de abas fixos; abas roláveis no celular; toasts para sucesso/erro (`window.C360.app.toast`).
- `window.C360.app = { refresh, toast }` é o ponto de reentrada usado por `exportImport.js` após importar.

---

## Atualização: Sistema de ajuda contextual (tooltips)

### Objetivo

Fornecer explicações simples e em linguagem acessível ("para leigos") sobre termos técnicos e campos do sistema, sem sobrecarregar a interface.

### Implementação

**CSS** (`styles/main.css`):

- `.help[data-tip]`: ícone circular verde com letra "i", 16×16px, cursor `help`.
- `.help-tip`: balão fixo (position: fixed) com fundo escuro, max-width 280px, texto branco pequeno, transição de opacidade/visibilidade.
- Viewport clamping: tooltip responde automaticamente se não couber acima (aparece abaixo), com margem de 10px da borda.
- Responsivo em mobile: max-width ajustado para `min(280px, calc(100vw - 24px))`.

**JavaScript** (`src/app.js`):

- `ensureTip()`: cria ou retorna singleton `<div class="help-tip">`.
- `showTip(target)`: lê `data-tip` do elemento, posiciona tooltip acima (ou abaixo se sem espaço), torna visível.
- `hideTip()`: remove classe `.show` (animação de saída).
- `bindHelpTips()`: escuta `mouseover`, `mouseout`, `focusin`, `focusout`, `click`, `scroll`, `resize`.

**Texto de ajuda** (`src/ui.js`):

- Dicionário `HELP` com ~22 chaves em português.
- Chaves: `valorEstoque`, `alertasEstoque`, `receitaLiquida`, `lucroBruto`, `consignadoAberto`, `pedidosPendentes`, `margemDesejada`, `taxasPadrao`, `tipoProduto`, `estoqueInicial`, `custoMedioInicial`, `precoVendaManual`, `estoqueMinimo`, `maoDeObra`, `custoFixo`, `perdaTecnica`, `margemDesejadaProduto`, `taxasProduto`, `valorTotalCompra`, `fichaTecnica`, `qtdPorUnidade`, `precoSugerido`, `qtdProduzida`, `canal`, `descontoTotal`, `taxaFixaTotal`, `taxaPercentual`, `cmv`, `precoCombinado`, `statusInicial`, `consignado`, `qtdEnviada`, `precoCombinadoConsig`.
- Função `help(keyOrText)`: gera `<span class="help" data-tip="...">i</span>`.
- Função `fieldLabel(text, helpKey)`: rótulo + ícone na mesma linha.
- Função `metric(label, value, helpKey)`: métrica do dashboard com ícone opcional.
- Função `section(title, description, content, titleHelp, right)`: seção com ícone no título (opcional).

### Como usar

**Adicionar ajuda a um campo:**

```js
// Em renderXyz():
UI.fieldLabel('Margem desejada (%)', 'margemDesejada')
```

**Adicionar ajuda a uma métrica:**

```js
UI.metric('Receita líquida', U.money(value), 'receitaLiquida')
```

**Adicionar ajuda ao título de uma seção:**

```js
UI.section('Vendas', 'Registre vendas e calcule CMV', content, 'cmv')
```

**Adicionar uma nova chave de ajuda:**

1. Edite `HELP` em `src/ui.js`.
2. Use a chave em qualquer `help(keyOrText)`, `fieldLabel`, `metric`, ou `section`.
3. Pronto: não precisa recompilar ou regenerar o arquivo mobile (veja abaixo).

### Acessibilidade

- Ícones têm `tabindex="0"` → acessíveis por teclado.
- `role="button"` + `aria-label` com texto completo.
- Funciona em desktop (hover), mobile (tap), e teclado (Tab + Enter/Space).

---

## Build mobile: sincronizar versões

### Arquivo de build

```txt
build-mobile.js    # Node.js script que inline CSS e todos os .js em um único HTML
```

### Como usar

```bash
node build-mobile.js [caminho/de/saida/controle360-mobile.html]
# Padrão: ./controle360-mobile.html
```

### O que faz

1. Lê `index.html`, `styles/main.css` e todos os `src/*.js`.
2. Substitui `<link href="styles/main.css">` por `<style>...</style>` com conteúdo inline.
3. Substitui cada `<script src="src/X.js">` por `<script>...</script>` com conteúdo inline.
4. Verifica se nenhuma referência externa restou (error se encontrar).
5. Salva em um arquivo HTML único (auto-contido, ~124 KB).

### Quando atualizar

**Sempre que alterar:**

- `styles/main.css`
- Qualquer arquivo em `src/` (utils, state, calculations, ui, app, exportImport, etc.)

**Depois rode:**

```bash
node build-mobile.js
```

Isso regenera `controle360-mobile.html` com as mudanças. Ambas as versões (desktop = index.html + arquivos, mobile = arquivo único) ficam sincronizadas.

### Verificação

- ✅ Desktop: abrir `index.html` (carrega CSS e JS de arquivo).
- ✅ Mobile: abrir `controle360-mobile.html` (carrega tudo inline, funciona offline 100%).
- ✅ Console: nenhuma referência externa, nenhum erro 404.

---

## Atualização: multiusuário com Supabase (admin/vendedor)

### O que mudou

O sistema deixou de ser 100% local/single-user. Agora existe um backend
Supabase (Auth + Postgres + RLS) e dois papéis de usuário:

- **admin**: dono do negócio. Acesso total a todos os módulos do próprio
  negócio, cria/gerencia contas de vendedor, define preço padrão/piso por
  produto e preços específicos por vendedor, aprova ou rejeita pedidos de
  reposição.
- **vendedor**: só enxerga o que é seu (`seller_id = auth.uid()`), aplicado
  pela RLS no banco — nunca vê dados de outro vendedor nem tabelas
  admin-only (fornecedores, compras, fichas técnicas, produção, tarefas,
  relatórios).

O `localStorage` deixou de ser a fonte de verdade: agora é só um espelho de
cache (`src/state.js`) que é repovoado por `refresh()` a partir da rede a
cada login. `C360.state.add/update/remove` (e `recordMovement`) **são
assíncronos** — todo call-site em `src/app.js` usa `await`/`.then()` antes de
reler o resultado ou re-renderizar.

### Arquivo de contrato do backend

`docs/backend.md` é a referência completa (tabelas, colunas, RLS, Edge
Function `create-seller`, regra do piso de preço). `docs/goals-contract.md`
documenta especificamente a tabela/view de metas de vendas. Não duplicar
essas informações aqui — só resumir o que muda no comportamento do app.

### Novas abas (ver `index.html` e `src/app.js`)

| Aba | Papel | Módulo |
|---|---|---|
| Vendedores | admin | `src/auth.js` (`renderSellers`/`mountSellers`) |
| Preços | admin | `src/pricing.js` |
| Aprovações | admin | `src/salesCart.js` (`mountApprovals`, reposição em carrinhos) + `src/sellerStock.js` (`mountGrantStock`, concessão direta de estoque) |
| Débitos dos vendedores | admin | `src/sellerLedger.js` (`mountAdmin`) |
| Meu saldo com admin | vendedor | `src/sellerLedger.js` (`mountSeller`) |
| Devoluções, desperdícios e brindes | admin | `src/operationalMovements.js` (`mountAdmin`, fila de conferência) |
| Devoluções e brindes | vendedor | `src/operationalMovements.js` (`mountSeller`, solicitar + acompanhar) |
| Meu estoque | vendedor | `src/sellerStock.js` (`mountMyStock`) |
| Calculadora | admin + vendedor | `src/calculator.js` |
| Metas | admin + vendedor | `src/goals.js` (`mountAdmin`/`mountSeller` conforme o papel) |
| Ajuda | vendedor | `src/sellerHelp.js` |

A visibilidade de aba por papel fica em `TAB_ROLES` (`src/app.js`) — é só
defesa em profundidade de interface; a garantia real de acesso é a RLS no
banco.

### Devolução, desperdício e piso de preço

- Cada linha de venda (aba Vendas) ganhou um botão "Devolução/Desperdício"
  que abre o painel de `src/returns.js` (venda de estorno com
  `quantity < 0` e `parentSaleId` preenchido, ou movimentação
  `saida_desperdicio`).
- No formulário de venda, ao escolher o produto, o preço unitário é
  pré-preenchido com `C360.calc.resolveSellerPrice(...)` e o piso é validado
  no envio com `C360.calc.validatePriceFloor(...)` antes de chamar a API —
  UX apenas; o trigger no banco (`docs/backend.md` §7) é a garantia final.

### Portão de autenticação

`index.html` tem `#authRoot` (tela de login, `src/auth.js`) e `#appShell`
(dashboard/abas), alternados por `src/app.js` conforme haja sessão válida
(`C360.auth.restoreSession()` no carregamento, `onSuccess` do formulário de
login, e `signOut()` no botão "Sair" do cabeçalho).

### Pendências conhecidas (não travam a integração, mas exigem decisão do time)

- **Resolvido**: a Edge Function `create-seller` está implantada (`ACTIVE`
  no projeto Supabase em uso) e testada de ponta a ponta (login funciona
  imediatamente após a criação, sem confirmação de e-mail pendente).
- **Resolvido**: a tabela `businesses` não tem policy de INSERT/DELETE para
  usuários autenticados (bootstrap é manual, via service role, 1 negócio por
  conta) — a aba Negócios virou edição do negócio já vinculado (nome,
  segmento, margens padrão), sem criar/excluir.
- **Resolvido (QA)**: `addPurchase`/`addSale`/`addOrder`/`taskForm` enviavam
  string vazia (`''`) em vez de `null` para colunas `uuid`/`date` opcionais
  (`supplierId`, `clientId`, `originId`, `dueDate`, `convertedSaleId`) quando
  o campo ficava em branco. O Postgres rejeita `''` num `uuid`/`date` com
  `invalid input syntax` — isso fazia **todo pedido** falhar (o código sempre
  mandava `convertedSaleId: ''`) e qualquer venda/compra/tarefa sem
  cliente/fornecedor/prazo selecionado também falhar. Corrigido em
  `src/app.js` para usar `|| null`.
- **Resolvido (QA)**: vendedor que lançava venda manual (aba Vendas) ou dava
  baixa em pedido (`convertOrderToSale`) de um produto **físico** (não
  serviço) criava a linha em `sales` e só depois descobria, via erro de RLS,
  que não tem permissão de alterar `products.current_stock` nem inserir
  `stock_movements` tipo `saida_venda` — resultado: venda órfã sem
  movimentação, e uma mensagem de erro técnica ilegível. `addSale()` agora
  barra essa combinação antes de criar a venda, com mensagem clara apontando
  para "Meu estoque" (fluxo correto: vira consignado).
- **Resolvido (QA)**: `sellFromOwnStock` (venda do estoque próprio do
  vendedor) sempre gravava `consignments.cost_at_send = null`, porque o
  vendedor não tem acesso a `products.avg_cost` (RLS) — isso corrompia
  CMV/margem desse tipo de venda nos relatórios do admin. Nova migração
  `0005_fix_seller_consignment_cost.sql` adiciona um trigger
  `SECURITY DEFINER` que preenche `cost_at_send` no servidor a partir do
  custo médio real do produto, sem expor esse dado ao cliente.
- **Achado (QA), não corrigido — decisão de produto pendente**: `S.update`/
  `S.remove` agora lançam erro quando o RLS filtra a linha (0 resultados em
  vez de sucesso silencioso — ver `src/api.js`). Isso expôs que os botões
  "Excluir" de `orders`/`clients`/`consignments`, quando clicados por um
  vendedor, sempre falhavam silenciosamente antes (a policy de DELETE
  dessas tabelas é só para admin) — agora aparece um erro em vez de "sumir
  da tela e voltar no próximo refresh". Falta decidir: dar ao vendedor
  permissão de excluir os próprios registros pendentes, ou esconder o botão
  "Excluir" para o papel vendedor nessas telas.
- **Resolvido (produção)**: admin criava vendedor e a tela "Vendedores"
  sempre mostrava "—" no e-mail (`listSellers()` nunca buscava e-mail —
  `auth.users` não é exposto via PostgREST). Sem conseguir conferir o e-mail
  salvo, o admin não percebia quando o autopreenchimento do navegador
  alterava o que foi digitado no formulário, e depois não tinha como saber
  qual e-mail usar para logar como aquele vendedor (relatado: "senha
  inválida" — na real o e-mail salvo era diferente do que o admin achava
  que tinha digitado). Corrigido: migração `0006_profiles_email.sql`
  denormaliza `profiles.email` (RLS de `profiles` já restringe a leitura ao
  próprio admin do negócio ou ao próprio usuário — nenhuma policy nova
  necessária); `create-seller` agora grava esse e-mail; `listSellers()`
  retorna o valor real; formulário de criação ganhou
  `autocapitalize/autocorrect/spellcheck` desligados (reduz sugestão de
  domínio do navegador) e um alerta pós-criação confirmando o e-mail exato
  que ficou salvo no servidor (não o que foi digitado).

---

## Atualização: replicação v1 — mobile por perfil, reposição em carrinhos, ledger

Análise completa e sequenciamento em `docs/replication-v1/` (ler antes de mexer
nestas áreas). Fases 1–3 implementadas:

- **Fase 1 (navegação mobile por perfil)**: `index.html`/`src/app.js` geram a
  barra de abas do desktop, a bottom-nav mobile e o menu "Mais" a partir de
  uma única fonte (`TAB_ORDER`/`TAB_LABELS`/`TAB_ROLES` em `src/app.js`) —
  não existe mais lista de abas duplicada. Nova aba `hoje` (tela "Hoje") é a
  aberta por padrão para os dois papéis. Abaixo de 720px a bottom-nav fixa
  assume e o dashboard fixo (`#dashboard`) cede lugar à tela "Hoje"; acima
  disso o comportamento de desktop é o de sempre.
- **Fase 2 (reposição padronizada em carrinhos)**: a aprovação de pedido de
  reposição do vendedor vive só na aba "Aprovações", via
  `C360.salesCart.mountApprovals` — o antigo caminho binário de `orders`
  (`C360.sellerStock.mountApprovals`) saiu da navegação. `sale_carts` ganhou
  `paid_initial_amount` (migração `0010`): pagamento `parcial` agora tem
  valor real, e a aprovação calcula o que fica devendo sobre a quantidade
  **aprovada**, nunca a solicitada.
- **Fase 3 (conta corrente do vendedor)**: novo ledger dedicado
  (`seller_account_entries` + `seller_payments`, migração `0011`,
  `src/sellerLedger.js`) substitui o saldo implícito que reaproveitava
  `consignments`. Saldo é sempre a soma dos lançamentos — nunca sobrescrito.
  Débito de reposição consignado/parcial é lançado por
  `src/salesCart.js` (`approveCart`) no momento da aprovação. Só o admin
  registra pagamento recebido ("Débitos dos vendedores"); vendedor só
  enxerga o próprio saldo ("Meu saldo com admin"), sem escrita — decisão
  registrada em `docs/replication-v1/04-fase3-ledger-vendedor.md`.

- **Fase 4 (devolução com status, desperdício, brinde)**: nova tabela
  `operational_movements` (migração `0012`) + `src/operationalMovements.js`.
  Distinto de `src/returns.js` (devolução/desperdício **imediatos** a partir
  de uma venda direta): este módulo é para mercadoria física com o vendedor
  (reposição/consignado) voltando, se perdendo ou virando brinde. Regra
  central: status `a_devolver`/`pending` não mexe em estoque nem
  financeiro — só a conferência do admin dispara o impacto (baixa em
  `seller_stock` ou `products.current_stock`, `stock_movements` quando
  aplicável, e `return_credit` no ledger da Fase 3 se marcado "abater da
  dívida"). Vendedor só cria a solicitação; nunca confere (trigger de banco
  bloqueia).

- **Fase 5 (relatórios)**: `renderReplicationReports()` em `src/app.js`,
  dentro da aba "Relatórios" (admin). Sem tabela nova — só leitura do que as
  Fases 2-4 já criaram: saldo por vendedor, pedidos em aberto (carrinhos +
  orders), devoluções pendentes, desperdício por período (agrupado por
  mês), brindes por responsável, estoque em trânsito.

- **Fase 6 (revisão de segurança Supabase)**: migrations `0010`-`0012`
  aplicadas no projeto Supabase em uso (`zcwnfrhtlhjfprsjktlx`), confirmadas
  via `mcp__Supabase__list_migrations`. `get_advisors` (security +
  performance) rodado depois: nenhum achado novo além do mesmo padrão já
  presente nas tabelas anteriores (RLS `_all_admin` + `_select_seller`,
  triggers `SECURITY DEFINER` como `enforce_order_approval_lock`). Migration
  `0013_phase6_performance_indexes.sql` corrige os índices de FK faltando e
  troca `auth.uid()` por `(select auth.uid())` nas policies de vendedor das
  3 tabelas novas — não mexeu nas tabelas antigas (fora do escopo desta
  fase, mesma limitação já documentada). Replicação v1 (Fases 1-6) concluída.

---

## Atualização: painel consolidado da aba Vendedores

Objetivo: reduzir troca de aba para as ações mais comuns do admin sobre um
vendedor específico. Cada card em "Vendedores" (`src/auth.js`,
`renderSellers`/`mountSellers`) ganhou um botão "Gerenciar" que expande um
painel inline com, tudo sem sair da aba:

- saldo devedor do vendedor + últimos 5 lançamentos do ledger;
- "Enviar estoque consignado" (produto + quantidade + preço) — chama
  `C360.salesCart.sendConsignmentToSeller`, que reaproveita
  `createAdminSellerConsignment`/`transferAdminStockToSeller` (mesma baixa de
  estoque central, `stock_movements`, `consignments` e `seller_stock` que o
  envio consignado feito pela aba Vendas);
- estoque atual do vendedor (leitura de `seller_stock`);
- "Registrar pagamento" — chama `C360.sellerLedger.registerPayment` (mesma
  escrita usada pela aba "Débitos dos vendedores", extraída para ser
  reaproveitável em vez de duplicada);
- contadores de pedidos aguardando aprovação e devoluções pendentes, com
  atalho (`C360.app.setTab`) para as abas correspondentes quando > 0.

**Correção de bug encontrada nesta mudança**: `createAdminSellerConsignment`
(`src/salesCart.js`, usado pela aba Vendas quando o admin escolhe forma de
pagamento "Consignado" e um vendedor destino) baixava o estoque central e
criava o registro em `consignments`, mas **nunca lançava o débito
correspondente em `seller_account_entries`** — só a aprovação de carrinho via
`approveCart()` fazia isso. Resultado: consignado enviado direto pelo admin
(fora da fila de aprovação) não aparecia como dívida em "Débitos dos
vendedores". Corrigido: agora lança `debit_replenishment` (mesma fórmula
`quantidade × preço unitário` usada em `approveCart`) para qualquer envio de
consignado admin→vendedor, direto ou via aprovação de carrinho.

`window.C360.app` passou a exportar `setTab` (antes só `refresh`/`toast`) e
`window.C360.sellerLedger` passou a exportar `balanceFor`/`entriesForSeller`/
`registerPayment`, para este painel poder reaproveitar as duas telas sem
duplicar lógica de negócio.

---

## Atualização: correções de UX mobile (calculadora flutuante e painel de devolução)

Dois problemas encontrados testando o app com a skill `run-controlevendasgold`
(ver `.claude/skills/run-controlevendasgold/SKILL.md`), ambos reportados pelo
usuário como "site confuso" / "abre em janela separada sem botão de fechar":

- **Calculadora flutuante (`.calc-fab`) sobrepondo botões no mobile**
  (`styles/main.css`): o botão redondo "R$" é `position: fixed` no canto
  inferior direito e cobria a última linha de "Ações rápidas" da tela "Hoje"
  (ex.: "Meus pedidos") e itens do sheet "Mais" (ex.: "Metas"). Corrigido com
  duas regras: `.quick-actions` ganha `padding-right` no mobile (empurra o
  grid para 1 coluna, liberando o canto onde o FAB fica) e o FAB/painel
  somem via `body:has(#moreMenu:not([hidden]))` enquanto o sheet "Mais"
  estiver aberto.
- **Painel de devolução/desperdício "aparece em outro lugar da tela"**
  (`src/returns.js`, `src/app.js`): `#returnsPanel` sempre renderiza no fim
  da seção Vendas, depois do carrinho e da tabela inteira de vendas — se o
  admin clica em "Devolução/Desperdício" numa venda no topo de uma lista
  longa, o formulário abre longe do que foi clicado, sem indicação visual de
  para onde foi. A única forma de fechar era voltar até a mesma linha e
  clicar de novo no botão (que virava "Fechar"). Corrigido:
  `returns.mount()` agora faz `scrollIntoView` no painel ao abrir e ganhou um
  cabeçalho com botão "Fechar" próprio (`data-role="close-returns"`, novo
  `options.onClose` além do `onDone` já existente) — fecha sem precisar
  achar a linha de novo.

---

## Atualização: simplificação do fluxo de venda

Objetivo: reduzir o quanto a aba "Vendas" exige pra registrar uma venda
simples de 1 produto — pedido explícito do usuário ("precisa fazer muita
coisa pra realizar uma venda").

- **Duplicação removida** (`src/salesCart.js`): a seção "Permissões dos
  vendedores" (checkboxes de consignado/estoque do admin/link público por
  vendedor) estava implementada **duas vezes** — uma vez como
  `mountSettings`/`renderAdminSettings`, dedicada à aba "Aprovações"
  (`src/app.js`, case `aprovacoes`), e de novo inteira dentro do `paint()`
  de `mount()`, o construtor de carrinho compartilhado pelas abas "Vendas" e
  "Pedidos". Resultado: todo admin via esse bloco (que nada tem a ver com
  vender) três vezes — uma em Vendas, uma em Pedidos, uma em Aprovações.
  Removida a cópia embutida em `mount()` (render + handler de submit do
  formulário + handler de clique de "Liberar 1 acerto de estoque"); a versão
  de `mountSettings` na aba Aprovações continua sendo a única fonte.
- **"Venda rápida (1 produto)" enxuta** (`src/app.js`, `renderSales`): os
  campos raramente alterados (Data, Canal, Desconto total, Taxa fixa total,
  Taxa percentual, Observações) foram para dentro de um `<details>`
  ("Mais opções") fechado por padrão, com os valores default de sempre
  (data = hoje, taxas = 0). O formulário visível agora é só Produto,
  Quantidade, Preço unitário e Cliente — os 4 campos que toda venda simples
  precisa. `<details>`/`<summary>` nativos: nenhum JS novo, funciona com
  teclado, e o campo Data continua `required` com valor pré-preenchido (não
  bloqueia envio mesmo fechado).

Nenhuma mudança na lógica de cálculo de venda (`Calc.saleMath`) nem no
formato salvo em `sales` — só remoção de duplicação de UI e reorganização
visual. Verificado via a skill `run-controlevendasgold`: lançar uma venda
rápida com o "Mais opções" fechado grava corretamente com os defaults, e a
aba Aprovações continua mostrando/salvando permissões normalmente.
