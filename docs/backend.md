# Backend Supabase — contrato para os agentes de frontend

Este documento é o **contrato**. Qualquer agente que for escrever
`src/api.js`, adaptar `src/state.js`, `src/app.js` etc. para o modo
multi-usuário deve seguir exatamente os nomes, rotas e regras descritos aqui.
O schema real está em `supabase/migrations/0001_init.sql`; este arquivo
resume o que importa para quem consome a API.

---

## 1. Configuração do projeto

O orquestrador preenche estes dois valores (via MCP `get_project_url` /
`get_publishable_keys`) em `src/api.js`:

```js
const SUPABASE_URL = '__SUPABASE_URL__';        // ex.: https://xxxxxxxx.supabase.co
const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__'; // chave pública "anon"
```

Nunca colocar a **service role key** em código de frontend. Ela só existe
dentro da Edge Function `create-seller` (variável de ambiente do lado do
servidor).

Toda requisição HTTP ao Supabase (Auth, PostgREST, Functions) precisa do
header `apikey: SUPABASE_ANON_KEY`. Depois de login, some-se
`Authorization: Bearer <access_token>` (o token do usuário, não a anon key).

---

## 2. Autenticação (GoTrue)

Base: `${SUPABASE_URL}/auth/v1`

### 2.1 Login (e-mail + senha)

```http
POST /auth/v1/token?grant_type=password
apikey: SUPABASE_ANON_KEY
Content-Type: application/json

{ "email": "vendedor@exemplo.com", "password": "..." }
```

Resposta (200):

```json
{
  "access_token": "eyJ...",
  "token_type": "bearer",
  "expires_in": 3600,
  "expires_at": 1710000000,
  "refresh_token": "...",
  "user": { "id": "uuid...", "email": "vendedor@exemplo.com", "...": "..." }
}
```

Erro (400): `{ "error": "invalid_grant", "error_description": "Invalid login credentials" }`.

Guardar `access_token` e `refresh_token` (ex.: `localStorage`, chave nova,
separada de `controle360_multi_v2`).

### 2.2 Renovar sessão

```http
POST /auth/v1/token?grant_type=refresh_token
apikey: SUPABASE_ANON_KEY
Content-Type: application/json

{ "refresh_token": "..." }
```

Mesmo formato de resposta do login. Chamar quando o `access_token` expirar
(ver `expires_at`) antes de uma requisição, ou reagir a um 401 de PostgREST
tentando renovar uma vez antes de deslogar o usuário.

### 2.3 Dados do usuário logado

```http
GET /auth/v1/user
apikey: SUPABASE_ANON_KEY
Authorization: Bearer <access_token>
```

Retorna o objeto `user` (id, email, metadata). Para saber o **papel**
(admin/vendedor) e o **negócio**, isso não vem daqui — vem de uma consulta a
`profiles` via PostgREST (seção 3), usando esse mesmo `id` como filtro
(`id=eq.<user.id>`), já que RLS deixa cada usuário ler a própria linha.

### 2.4 Logout

```http
POST /auth/v1/logout
apikey: SUPABASE_ANON_KEY
Authorization: Bearer <access_token>
```

Resposta 204. Depois disso, descartar os tokens salvos localmente.

---

## 3. Dados (PostgREST)

Base: `${SUPABASE_URL}/rest/v1/<tabela>`

Headers padrão em toda chamada autenticada:

```http
apikey: SUPABASE_ANON_KEY
Authorization: Bearer <access_token>
Content-Type: application/json
Prefer: return=representation
```

`Prefer: return=representation` faz INSERT/UPDATE devolverem a linha
resultante (sem isso, PostgREST responde 201/204 sem corpo).

### 3.1 Ler (GET)

```http
GET /rest/v1/products?business_id=eq.<uuid>&order=name.asc
```

- Filtros: `coluna=eq.valor`, `coluna=neq.valor`, `coluna=in.(a,b,c)`,
  `coluna=is.null`, etc. (sintaxe PostgREST padrão).
- `select=col1,col2` para limitar colunas.
- `order=coluna.asc` / `coluna.desc`.
- RLS **sempre** se aplica por cima do filtro pedido: mesmo se o app
  esquecer `business_id=eq...` ou `seller_id=eq...`, o banco nunca devolve
  linha de outro negócio/vendedor. Ainda assim, o app DEVE mandar esses
  filtros explicitamente — é mais rápido e evita depender só do banco para
  UX (ex.: evitar mostrar "0 resultados" confuso).

### 3.2 Inserir (POST)

```http
POST /rest/v1/sales
Prefer: return=representation

{ "business_id": "...", "product_id": "...", "seller_id": "...", "quantity": 2, "unit_price": 25, "origin": "manual" }
```

`id`, `created_at`, `updated_at` são gerados pelo banco — não enviar.

### 3.3 Atualizar (PATCH)

```http
PATCH /rest/v1/orders?id=eq.<uuid>
Prefer: return=representation

{ "notes": "Entregar até sexta" }
```

### 3.4 Apagar (DELETE)

```http
DELETE /rest/v1/clients?id=eq.<uuid>
```

Só funciona se a policy de RLS permitir DELETE para o papel do usuário
(ver seção 6 — vendedor não tem DELETE em quase nada; a maioria das
exclusões é admin-only).

### 3.5 Erros comuns do PostgREST

- **`42501` / mensagem "permission denied" ou linha vazia sem erro**: RLS
  bloqueou. Não confundir com 404 — PostgREST geralmente devolve uma lista
  vazia (`[]`) para SELECT sem permissão, e erro 401/403 real para
  INSERT/UPDATE/DELETE fora de política.
- **Erro do trigger de piso de preço** (`check_violation`, mensagem "Preço
  unitário (...) abaixo do piso permitido (...)"): ver seção 7.
- **Erro do trigger de aprovação** ("Vendedor só pode criar pedidos com
  approval_status = pendente_aprovacao" / "Somente admin pode alterar
  approval_status de um pedido").

---

## 4. Edge Function: criar vendedor

Endpoint: `POST ${SUPABASE_URL}/functions/v1/create-seller`

Chamada pelo **admin logado** (usa o `access_token` do admin, não a service
role):

```http
POST /functions/v1/create-seller
apikey: SUPABASE_ANON_KEY
Authorization: Bearer <access_token do admin>
Content-Type: application/json

{ "email": "novo.vendedor@exemplo.com", "password": "senhaProvisoria123", "name": "Fulano" }
```

Resposta de sucesso (201):

```json
{
  "id": "uuid-do-novo-usuario",
  "email": "novo.vendedor@exemplo.com",
  "name": "Fulano",
  "role": "vendedor",
  "business_id": "uuid-do-negocio"
}
```

Erros possíveis:

| status | quando |
|---|---|
| 400 | JSON inválido, e-mail inválido, senha curta (<6), nome vazio, ou admin sem `business_id` |
| 401 | sem `Authorization`/token inválido ou expirado |
| 403 | chamador autenticado mas não é admin ativo |
| 409 | e-mail já cadastrado |
| 500 | erro interno (configuração do servidor, falha ao criar perfil) |

Corpo de erro sempre `{ "error": "mensagem em português" }`.

O frontend deve tratar 403 mostrando algo como "Você não tem permissão para
criar vendedores" e 409 como "Este e-mail já está em uso".

---

## 5. Tabelas, colunas e mapeamento camelCase ↔ snake_case

Todas as tabelas (exceto `profiles`, cujo id é o do Supabase Auth) usam
`id uuid` gerado pelo banco. Todas têm `business_id` (exceto `businesses`,
que é a raiz). `created_at`/`updated_at` são automáticos.

### businesses

| DB (snake_case) | JS (camelCase) | tipo |
|---|---|---|
| id | id | uuid |
| owner_id | — (não existia no MVP local) | uuid |
| name | name | text |
| segment | segment | text |
| default_target_margin | defaultTargetMargin | numeric |
| default_fee_percent | defaultFeePercent | numeric |
| notes | notes | text |

### profiles (NOVA — não existe no MVP local)

| DB | tipo | observação |
|---|---|---|
| id | uuid | = auth.users.id |
| role | text | `'admin'` \| `'vendedor'` |
| name | text | |
| business_id | uuid | negócio do usuário |
| active | boolean | admin pode desativar um vendedor (`active=false`) em vez de apagar |

### products

| DB | JS | tipo |
|---|---|---|
| id | id | uuid |
| business_id | businessId | uuid |
| name | name | text |
| type | type | text (materia_prima\|embalagem\|produto_final\|mercadoria\|kit\|servico) |
| unit | unit | text |
| current_stock | currentStock | numeric |
| avg_cost | avgCost | numeric — **admin only**, ver seção 6 |
| sale_price | salePrice | numeric |
| min_stock | minStock | numeric |
| labor_cost_per_unit | laborCostPerUnit | numeric — admin only |
| overhead_cost_per_unit | overheadCostPerUnit | numeric — admin only |
| loss_percent | lossPercent | numeric — admin only |
| target_margin_percent | targetMarginPercent | numeric — admin only |
| tax_fee_percent | taxFeePercent | numeric — admin only |
| notes | notes | text |
| **default_price** | **defaultPrice** | numeric — **NOVO**: preço padrão sugerido |
| **price_floor** | **priceFloor** | numeric — **NOVO**: piso mínimo de venda |

Vendedor não lê a tabela `products` diretamente — usa a **view**
`seller_products` (mesmas colunas, exceto as marcadas "admin only" acima,
que simplesmente não existem na view). Ver seção 6.

### seller_prices (NOVA)

| DB | tipo |
|---|---|
| id | uuid |
| business_id | uuid |
| seller_id | uuid (→ profiles) |
| product_id | uuid (→ products) |
| price | numeric — preço que este vendedor pratica |
| floor | numeric — piso específico deste vendedor (se nulo, cai no `products.price_floor`) |

`unique(seller_id, product_id)`: no máximo uma linha por par.

### seller_stock (NOVA)

| DB | tipo |
|---|---|
| id | uuid |
| business_id | uuid |
| seller_id | uuid |
| product_id | uuid |
| quantity | numeric, default 0 |

`unique(seller_id, product_id)`. Representa estoque sob responsabilidade do
vendedor (ex.: consignado/mochila do vendedor) — só admin escreve; vendedor
só lê o próprio saldo.

### clients

| DB | JS | tipo |
|---|---|---|
| id | id | uuid |
| business_id | businessId | uuid |
| name | name | text |
| phone | phone | text |
| type | type | text (cliente\|consignado\|ambos) |
| notes | notes | text |
| **seller_id** | **sellerId** | uuid — **NOVO**. `null` = cliente da casa (só admin vê) |

### suppliers

| DB | JS |
|---|---|
| id | id |
| business_id | businessId |
| name | name |
| phone | phone |
| notes | notes |

Tabela **admin-only** — vendedor não tem nenhum acesso (nem leitura).

### purchases

| DB | JS |
|---|---|
| id | id |
| business_id | businessId |
| date | date |
| supplier_id | supplierId |
| product_id | productId |
| quantity | quantity |
| total_cost | totalCost |
| unit_cost | unitCost |
| notes | notes |

Admin-only.

### stock_movements

| DB | JS |
|---|---|
| id | id |
| business_id | businessId |
| date | date |
| type | type — enum abaixo |
| product_id | productId |
| quantity | quantity — positivo=entrada, negativo=saída |
| unit_cost | unitCost |
| total_cost | totalCost |
| ref_type / ref_id | — (novo, rastreio opcional da origem) |
| notes | notes |

`type` aceita: `entrada_compra`, `saida_producao_insumo`,
`entrada_producao_produto_final`, `saida_venda`, `saida_envio_consignado`,
`entrada_devolucao_consignado`, `ajuste_manual`, e os **dois novos**:
`saida_desperdicio`, `entrada_devolucao_venda`.

Admin-only.

### recipes (ficha técnica)

| DB | JS |
|---|---|
| id | id |
| business_id | businessId |
| final_product_id | finalProductId |
| input_product_id | inputProductId |
| quantity_per_unit | quantityPerUnit |

Admin-only.

### productions

| DB | JS |
|---|---|
| id | id |
| business_id | businessId |
| date | date |
| final_product_id | finalProductId |
| quantity | quantity |
| total_cost | totalCost |
| unit_cost | unitCost |
| notes | notes |

Admin-only.

### sales

| DB | JS | tipo |
|---|---|---|
| id | id | uuid |
| business_id | businessId | uuid |
| date | date | date |
| channel | channel | text |
| client_id | clientId | uuid |
| product_id | productId | uuid |
| quantity | quantity | numeric |
| unit_price | unitPrice | numeric |
| discount | discount | numeric |
| fixed_fees | fixedFees | numeric |
| fee_percent | feePercent | numeric — taxa % configurada |
| percent_fees | percentFees | numeric — valor calculado da taxa |
| unit_cost | unitCost | numeric |
| gross_revenue | grossRevenue | numeric |
| net_revenue | netRevenue | numeric |
| cogs | cogs | numeric |
| gross_profit | grossProfit | numeric |
| margin | margin | numeric |
| notes | notes | text |
| origin | origin | text (manual\|pedido\|consignado) |
| origin_id | originId | uuid |
| **seller_id** | **sellerId** | uuid — **NOVO** |
| **parent_sale_id** | **parentSaleId** | uuid — **NOVO**: preenchido = é devolução/estorno de outra venda |

### orders (pedidos)

| DB | JS | tipo |
|---|---|---|
| id | id | uuid |
| business_id | businessId | uuid |
| client_id | clientId | uuid |
| product_id | productId | uuid |
| quantity | quantity | numeric |
| unit_price | unitPrice | numeric |
| due_date | dueDate | date |
| status | status | text (pendente\|em_preparo\|pronto\|despachado\|concluido) — **logística** |
| notes | notes | text |
| converted_sale_id | convertedSaleId | uuid |
| **seller_id** | **sellerId** | uuid — **NOVO** |
| **approval_status** | **approvalStatus** | text — **NOVO**: `pendente_aprovacao`\|`aprovado`\|`rejeitado` |

`status` (logística) só passa a ter efeito prático depois de
`approval_status = 'aprovado'` — é uma convenção de fluxo de tela, o banco
não bloqueia mudar `status` antes da aprovação (só bloqueia mudar
`approval_status` por quem não é admin). O frontend deve tratar pedidos com
`approval_status != 'aprovado'` como "aguardando aprovação", independente do
`status` logístico.

### consignments

| DB | JS |
|---|---|
| id | id |
| business_id | businessId |
| date | date |
| client_id | clientId |
| product_id | productId |
| quantity_sent | quantitySent |
| quantity_sold | quantitySold |
| quantity_returned | quantityReturned |
| amount_paid | amountPaid |
| unit_price | unitPrice |
| cost_at_send | costAtSend |
| notes | notes |
| status | status (com_cliente\|quitado\|encerrado) |
| **seller_id** | **sellerId** | **NOVO** (ver seção 8, gaps) |

### consignmentEvents → consignment_events

| DB | JS |
|---|---|
| id | id |
| business_id | businessId |
| consignment_id | consignmentId |
| type | type (envio\|venda_cliente\|devolucao\|pagamento) |
| date | date |
| quantity | quantity |
| amount | amount |

Sem `seller_id` próprio — segue o dono da consignação-pai (ver seção 6).

### tasks

| DB | JS |
|---|---|
| id | id |
| business_id | businessId |
| title | title |
| due_date | dueDate |
| status | status (a_fazer\|fazendo\|aguardando\|feito) |
| notes | notes |

Admin-only.

---

## 6. Papéis e o que cada um pode ler/escrever

### admin

- Acesso total (SELECT/INSERT/UPDATE/DELETE) a **todas** as tabelas do
  próprio negócio (`business_id = seu negócio`), incluindo `products` com
  todos os campos de custo, `suppliers`, `purchases`, `stock_movements`,
  `recipes`, `productions`, `tasks`.
- Vê e edita todos os `clients`/`sales`/`orders`/`consignments` do negócio,
  de qualquer vendedor.
- É o único que pode marcar `orders.approval_status` como `aprovado` ou
  `rejeitado`.
- É o único que escreve em `seller_prices` e `seller_stock` (define
  preço/piso/estoque de cada vendedor).
- Pode atualizar outros `profiles` do próprio negócio (ex.: desativar um
  vendedor via `active=false`), mas **não** pode ser criado por outro admin
  pela API pública — só a Edge Function `create-seller` cria vendedores, e
  o primeiro admin é provisionado manualmente (ver seção 8).

### vendedor

Só enxerga/edita o que é seu (`seller_id = auth.uid()`), e nunca vê dados de
outro vendedor:

| Tabela | Acesso do vendedor |
|---|---|
| `products` (tabela base) | **nenhum** — usar a view `seller_products` |
| `seller_products` (view) | SELECT, filtrado ao próprio negócio, sem colunas de custo |
| `seller_prices` | SELECT só das próprias linhas (`seller_id=auth.uid()`) |
| `seller_stock` | SELECT só das próprias linhas |
| `businesses` | SELECT do próprio negócio |
| `clients` | SELECT/INSERT/UPDATE só onde `seller_id=auth.uid()`. Cliente da casa (`seller_id null`) não aparece. |
| `sales` | SELECT/INSERT/UPDATE só onde `seller_id=auth.uid()`. INSERT é bloqueado pelo trigger de piso de preço se `unit_price` for baixo demais (seção 7). |
| `orders` | SELECT/INSERT/UPDATE só onde `seller_id=auth.uid()`. INSERT só aceito com `approval_status='pendente_aprovacao'` (qualquer outro valor é rejeitado). UPDATE não pode mudar `approval_status` (trigger bloqueia). |
| `consignments` | SELECT/INSERT/UPDATE só onde `seller_id=auth.uid()`. |
| `consignment_events` | SELECT/INSERT só de eventos cuja consignação (`consignment_id`) pertence a ele. |
| `suppliers`, `purchases`, `stock_movements`, `recipes`, `productions`, `tasks` | **nenhum acesso** (tabelas somem da API para o vendedor: SELECT devolve lista vazia, escrita devolve erro de permissão) |
| `profiles` | SELECT/UPDATE só da própria linha; **não** pode mudar `role`, `business_id` nem `active` — só `name` (trigger bloqueia o resto). |

DELETE não está liberado para vendedor em nenhuma tabela nesta versão — só
admin apaga registros. Se o produto precisar que vendedor "exclua" algo
(ex.: cancelar um cliente cadastrado errado), a tela deve, por ora,
oferecer edição/inativação em vez de DELETE, ou pedir ao admin.

---

## 7. Regra do piso de preço (price floor)

Toda tentativa de `INSERT`/`UPDATE` em `sales` passa por um trigger no
banco que calcula o piso aplicável e rejeita o preço abaixo dele:

1. Se existir `seller_prices.floor` para o par (`seller_id`, `product_id`)
   da venda, e não for nulo → esse é o piso.
2. Senão, usa `products.price_floor` do produto.
3. Se os dois forem nulos, não há piso e qualquer preço passa.

A checagem é **pulada** (não é venda nova, é ajuste/estorno) quando:

- `parent_sale_id` está preenchido (a venda referencia outra venda — é uma
  devolução/estorno vinculado), **ou**
- `quantity <= 0`, **ou**
- `unit_price <= 0`.

Erro devolvido pelo PostgREST quando o preço fica abaixo do piso:

```json
{
  "code": "23514",
  "message": "Preço unitário (10.00) abaixo do piso permitido (18.00) para este produto.",
  "details": null,
  "hint": null
}
```

### Como o frontend deve pré-validar (antes de bater no banco)

1. Ao montar a tela de venda para um vendedor, buscar `seller_products`
   (para pegar `price_floor` do produto) **e** `seller_prices` do vendedor
   logado para aquele produto (para pegar o `floor` específico, se
   existir).
2. Calcular `pisoEfetivo = seller_prices.floor ?? product.price_floor`
   (mesma prioridade do trigger).
3. Se o usuário digitar um `unit_price < pisoEfetivo`, bloquear o envio no
   próprio formulário com uma mensagem clara ("Preço mínimo para este
   produto: R$ X"), sem nem chamar a API — o servidor é a garantia final,
   não a única camada.
4. Devoluções/estornos (venda com `parent_sale_id` setado) não precisam
   dessa validação de piso no cliente, já que o servidor também as isenta.

---

## 8. Gaps conhecidos / o que o orquestrador deve revisar

- **Bootstrap do primeiro admin e do primeiro negócio não está automatizado.**
  Esta migração não cria um `business` nem um `profile` admin sozinha (isso
  exigiria uma segunda Edge Function tipo `create-business`/`sign-up-admin`,
  fora do escopo pedido). O orquestrador precisa inserir essas duas linhas
  manualmente (via SQL/service role) na primeira vez, seguindo a ordem
  descrita em `supabase/README.md` (profile sem business_id → business →
  UPDATE do business_id).
- **`consignments.seller_id` foi adicionado por inferência**, não estava na
  lista explícita de "colunas novas" do pedido original, mas é exigido pela
  regra de RLS "vendedor só vê o que é seu" para consignments. Confirmar que
  faz sentido no produto (ex.: o vendedor realmente "dono" de uma
  consignação, e não só do cliente).
- **Clientes "da casa" (`seller_id null`) ficam invisíveis para todos os
  vendedores** nesta versão — só o admin os vê/edita. Se o produto quiser
  "contas compartilhadas" visíveis a qualquer vendedor, é preciso uma policy
  adicional de SELECT em `clients` (`seller_id is null`) e decidir se
  vendedor pode vender para esses clientes.
- **`orders.status` (logística) não tem trava de banco** amarrada a
  `approval_status = 'aprovado'` — só a convenção descrita na seção 5. Se o
  produto quiser impedir despachar/concluir um pedido não aprovado, isso
  precisa de outro trigger (não implementado, para não extrapolar o pedido
  original).
- **DELETE é só admin** em tudo. Se alguma tela de vendedor precisar
  "excluir" (ex.: cliente cadastrado errado), hoje só dá para editar/inativar
  ou pedir para o admin apagar.
- **CORS da Edge Function está `*`** (aberto) — trocar por origem exata do
  GitHub Pages assim que o domínio publicado for conhecido (comentário
  `TODO` já deixado em `supabase/functions/create-seller/index.ts`).
- **`origin_id` em `sales` não tem FK** — pode apontar tanto para `orders`
  quanto `consignments`, então é `uuid` solto sem `references`. Mesma
  decisão do modelo local (`modelo-dados.md` já tratava assim).
