# Arquitetura — Controle360 Multi (Replication v1)

## Visão geral

Controle360 é um **MVP local para múltiplos negócios** com separação de papéis (Admin/Vendedor), persistência em Supabase (Auth + Postgres + RLS), e sincronização de estado no cliente via cache (`C360.state`).

**Características principais:**
- Um negócio = múltiplos produtos/clientes/vendedores
- Admin = dono do negócio, acesso total
- Vendedor = visibilidade restrita ao próprio estoque/vendas/dívida (aplicado por RLS)
- Estoque único central (admin), vendedores retiram a prazo ou à vista
- Dívida do vendedor = ledger dedicado (nunca sobrescrito)
- Mobile-first: desktop + bottom-nav mobile + menu "Mais"

---

## Estrutura de Código

### Organização de Módulos

```
src/
├── utils.js          # Helpers puros: money, date, uid, HTML escape
├── api.js            # Cliente Supabase (Auth + PostgREST)
├── state.js          # Cache assíncrono (espelho de localStorage + rede)
├── calculations.js   # Cálculos: custo, preço, CMV, consignado, piso
├── ui.js             # Geradores HTML reutilizáveis + HELP tooltips
├── app.js            # Portão, navegação, abas, orquestração
├── auth.js           # Login/logout, sessão, papel, vendedores (admin)
├── pricing.js        # Preço padrão/piso por produto e por vendedor
├── calculator.js     # Calculadora flutuante
├── goals.js          # Metas de vendas semanais/mensais
├── sellerHelp.js     # Central de ajuda/onboarding (vendedor)
├── salesCart.js      # Carrinho de vendas + reposição + aprovações
├── sellerStock.js    # Estoque próprio do vendedor + pedido de reposição
├── sellerLedger.js   # Conta corrente do vendedor (saldo + ledger + pagamento)
├── operationalMovements.js  # Devoluções/desperdício/brinde com status
├── returns.js        # Devolução/desperdício imediato de uma venda
├── xlsx-lite.js      # Motor .xlsx em JS puro
└── exportImport.js   # Excel/CSV/JSON export/import
```

### Padrão de Módulo

Cada módulo é uma IIFE (Immediately Invoked Function Expression) que expõe uma API em `window.C360.{module}`:

```javascript
(function () {
  'use strict';
  
  // Dependências
  const U = window.C360.utils;
  const S = window.C360.state;
  const Calc = window.C360.calc;
  const UI = window.C360.ui;
  
  // Funções internas privadas (não exportadas)
  function _helper() { ... }
  
  // Funções públicas
  function render() { return _helper(); }
  function mount(container) { container.innerHTML = render(); }
  
  // Exportação
  window.C360.{module} = { render, mount };
})();
```

---

## Estado e Sincronização

### `window.C360.state`

Cache assíncrono que espelha o banco de dados:

```javascript
// Leitura
const products = C360.state.getState().products;

// Escrita (assíncrono)
const newSale = await C360.state.add('sales', { ... });
await C360.state.update('sales', id, { ... });
await C360.state.remove('sales', id);

// Refresh tudo (após login ou operação de escrita)
await C360.state.refresh();
```

**Flow:**
1. Login → `C360.state.refresh()` busca todas as coleções da rede
2. Cache em LocalStorage (`controle360_multi_v2`)
3. Operação de escrita → atualiza banco → `refresh()` recarrega cache
4. Leitura sempre consulta cache local (rápido)

### Coleções Principais

| Coleção | BusinessId? | RLS | Descrição |
|---|---|---|---|
| `businesses` | N/A | Admin-only | Um por usuário (gestão de nome, segmento) |
| `products` | ✅ | Admin full, Vendedor read `type != 'servico'` | Matéria-prima, embalagem, produto final, etc. |
| `sales` | ✅ | Admin full, Vendedor own + consignado | Vendas registradas |
| `sale_carts` | ✅ | Admin full, Vendedor own | Carrinhos (aprovação, reposição, etc.) |
| `sale_cart_items` | ✅ | Herda de `sale_carts` | Itens do carrinho |
| `seller_stock` | ✅ | Seller-scoped + Admin | Estoque do vendedor |
| `seller_account_entries` | ✅ | Seller-scoped + Admin | Ledger (débito/crédito) |
| `seller_payments` | ✅ | Seller-scoped + Admin | Pagamentos fracionados |
| `orders` | ✅ | Admin full, Vendedor own | Pedidos logísticos (gerados de `sale_carts`) |
| `consignments` | ✅ | Seller-scoped + Admin | Consignado ativo |
| `stock_movements` | ✅ | Admin full, Vendedor own | Histórico de estoque (entrada/saída) |
| `clients` | ✅ | Admin full, Vendedor read | Clientes cadastrados |
| `suppliers` | ✅ | Admin-only | Fornecedores |
| `recipes` | ✅ | Admin full, Vendedor read | Fichas técnicas |
| `productions` | ✅ | Admin-only | Produção (baixa de insumos) |
| `operational_movements` | ✅ | Seller request, Admin approve | Devoluções/desperdício/brinde com status |
| `tasks` | ✅ | Admin-only | Kanban de tarefas |

---

## Navegação e Abas

### TAB_ROLES (Fonte única de permissão)

```javascript
// src/app.js
const TAB_ROLES = {
  hoje: ['admin', 'vendedor'],
  vender: ['admin', 'vendedor'],
  clientes: ['admin', 'vendedor'],
  estoque: ['admin'],
  'meu-estoque': ['vendedor'],
  // ... (22 abas no total)
};
```

- **Admin vê**: 22 abas (Hoje, Vender, Clientes, Estoque, Aprovações, Vendedores, Preços, Meu saldo, Devoluções admin, Relatórios, etc.)
- **Vendedor vê**: 8 abas (Hoje, Vender, Clientes, Meu estoque, Meu saldo, Devoluções, Calculadora, Ajuda)

### Responsividade

**Desktop (> 720px):**
- Abas horizontais no topo (roláveismente)
- Conteúdo em `#appShell`

**Mobile (≤ 720px):**
- Bottom-nav com 5 abas principais (por perfil)
- Menu "Mais" (sheet) com abas restantes
- FAB "R$" canto inferior direito (calculadora flutuante)

---

## Modelo de Dados — Decisões Chave

### 1. Estoque Único Central

**Regra**: Só existe 1 estoque físico — do admin.

**Fluxo:**
- Admin compra → entra em `products.current_stock` + `stock_movements` (`entrada_compra`)
- Vendedor pede → cria `sale_carts` (pendente)
- Admin aprova → baixa `products.current_stock` + `stock_movements` (`saida_venda`)
  - Se `payment_mode = 'avista'` → `orders.payment_status = 'paid'`
  - Se `payment_mode = 'consignado'` ou `'parcial'` → lança débito em `seller_account_entries`
- Vendedor vira `seller_stock` apenas após movimentação confirmada

### 2. Dívida = Ledger Dedicado

**Regra**: Saldo é sempre `Σ(débitos) - Σ(créditos)`. Nunca sobrescrito.

**Tipos de entrada:**
- `debit_replenishment`: replenição consignada/parcial
- `payment`: pagamento recebido (crédito)
- `return_credit`: devolução conferida
- `manual_adjustment`: ajuste admin
- `writeoff`: baixa de dívida
- `bonus_credit`: bonificação

**Tabelas:**
- `seller_account_entries`: ledger (imutável, append-only)
- `seller_payments`: fracionados recebidos (referência para auditoria)

**Funções:**
- `balanceFor(sellerId)`: calcula saldo real em tempo real
- `registerPayment(sellerId, amount, method, notes)`: lança payment + entry, RPC `SECURITY DEFINER`

### 3. Reposição Padronizada em Carrinhos

**Regra**: Todo pedido de estoque é um carrinho (`sale_carts`).

**Status:**
- `pending_approval`: vendedor pediu, aguarda admin
- `approved`: admin aprovou (converteu em `orders`)
- `rejected`: admin rejeitou

**Payment modes:**
- `avista`: débito imediato, `orders.payment_status = 'paid'`
- `consignado`: débito total no ledger
- `parcial`: débito de `(quantity_approved - paid_initial_amount / unit_price)` no ledger

### 4. Devoluções vs. Operações

**`returns.js`** (imediato):
- Devolução/desperdício de uma venda direta
- Cria `sales` negativa (`quantity < 0`) com `parent_sale_id`
- Movimentação `saida_venda` ou `saida_desperdicio`
- Impacto financeiro/estoque imediato

**`operationalMovements.js`** (workflow):
- Devolução/desperdício/brinde de mercadoria em trânsito (reposição)
- Status workflow: `a_devolver` → `enviado` → `recebido` (ou recusado)
- Impacto só em `recebido` (conferência do admin)
- Lança `return_credit` no ledger se marcado "abater dívida"

---

## Cálculos Centralizados

Todos em `src/calculations.js` — nunca duplicados:

### `saleMath(quantity, unitPrice, discount, taxFixed, taxPercentual)`
Retorna: `revenueGross`, `revenueLiquid`, `cmv`, `grossMargin`, `marginPercent`

### `costCalculation(recipe, products)`
Custo por ficha técnica: materiais + mão de obra + custo fixo − perda

### `resolveSellerPrice(productId, sellerId)`
Retorna: preço padrão ou específico do vendedor (se admin definiu floor/markup)

### `validatePriceFloor(productId, price, sellerId)`
Valida piso (lado cliente, lado servidor via trigger de fato)

### `sellerBalance(entries)`
Soma débitos - créditos (sempre executado no cliente, nunca no banco)

---

## Arquitetura Frontend (Orquestração)

### `app.js` — Portão

```
startup
  ├─ restaurar sessão (Local Storage + Auth)
  ├─ se autenticado
  │  └─ renderizar dashboard + abas (portão do app.js:1946)
  │     └─ refresh() → busca estado do banco
  │     └─ renderTab(tabName) → chama renderer correto
  │        ├─ salesCart.mount('vendas')
  │        ├─ auth.mountSellers('vendedores')
  │        ├─ sellerLedger.mountSeller('meu-saldo')
  │        └─ ...
  └─ se não
     └─ renderizar formulário de login (auth.render())
```

### Fluxo de Escrita

```
usuário clica "Vender"
  ↓
salesCart.mount() → renderiza form
  ↓
usuário enche form, clica "Vender"
  ↓
app.js handler de submit
  → validação local (cálculos)
  → S.add('sales', { ... })
     ├─ POST /rest/v1/sales (Supabase)
     ├─ trigger insere em stock_movements
     ├─ trigger lança débito/crédito conforme payment_mode
     └─ retorna id novo
  → S.refresh() (recarrega cache)
  → toast("Venda registrada")
  → renderTab('vender') (re-renderiza a aba)
```

---

## RLS (Row Level Security)

### Padrão de duas policies

Cada tabela operacional tem:
1. **`_all_admin`**: Admin vê todos os registros do próprio negócio
2. **`_select_seller`**: Vendedor vê só os próprios (`seller_id = auth.uid()`)

### Exemplo (`seller_account_entries`)

```sql
-- Apenas o admin pode ler/escrever
CREATE POLICY "_all_admin_seller_account_entries"
  ON seller_account_entries
  AS PERMISSIVE FOR ALL USING (
    is_admin()
  )
  WITH CHECK (
    is_admin()
  );

-- Vendedor só lê o próprio (write bloqueada)
CREATE POLICY "_select_seller_seller_account_entries"
  ON seller_account_entries
  AS PERMISSIVE FOR SELECT USING (
    seller_id = auth.uid()
  );
```

---

## Performance e Segurança

### Lado Cliente
- **Cache em localStorage**: evita re-fetch de estado não-alterado
- **Cálculos locais**: margin, price floor, balance (sem rede)
- **Validação dupla**: UI + banco (UI é só UX, banco é garantia)

### Lado Servidor
- **RLS**: filtro de dados automático (vendedor não consegue ler outro vendedor mesmo tentando)
- **Triggers**: garantem invariantes (estoque nunca negativo, débito sempre lançado, status transitávelmente válido)
- **Índices**: FK obrigatórios, `seller_id` em todas tabelas operacionais
- **SECURITY DEFINER**: RPCs como `registerPayment` rodam como admin (safe escalation)

### Advisors Supabase
- ✅ Nenhuma policy permitindo UPDATE em `auth.uid()` (imutável)
- ✅ Nenhuma pública policy (tudo requer autenticação)
- ✅ RLS ativo em todas tabelas com dados pessoais/operacionais

---

## Build Mobile

### Sincronização Automática

```bash
node build-mobile.js
```

Gera `controle360-mobile.html` (auto-contido):
- `index.html` inlined
- Todos os `src/*.js` inlined
- `styles/main.css` inlined
- Nenhuma referência externa (funciona offline 100%)

**Quando rodar:**
- Após alterar qualquer `src/*.js`
- Após alterar `styles/main.css`
- Após atualizar `index.html`

---

## Decisões Reversíveis vs. Estruturais

### Reversíveis (simples mudar)
- Nomes de abas
- Cores/layout CSS
- Campos de formulário
- Mensagens de erro

### Estruturais (exigem migration)
- Adicionar coluna em tabela
- Mudar tipo RLS (seller → admin)
- Novo tipo de entrada em ledger
- Status workflow de devolução

### Congeladas (não mudam mais)
- Um estoque central (admin)
- Ledger append-only
- `sale_carts` canônicos para reposição
- `payment_mode` parte integral do carrinho

---

## Próximas Melhorias

### Curto prazo (1-2 ciclos)
- [ ] Batch approve (admin aprova vários carrinhos de uma vez)
- [ ] Notificações em tempo real (pedido novo, pagamento recebido)
- [ ] Filtro/busca em relatórios

### Médio prazo (2-3 ciclos)
- [ ] Comissão de vendedor (% por venda)
- [ ] Integração com logística (rastreio de devolução)
- [ ] Lotes e validade de produto

### Longo prazo (roadmap)
- [ ] App mobile nativo (React Native)
- [ ] Multi-tenant true (negócios completamente isolados)
- [ ] Sincronia offline-first (service worker + IndexedDB)

---

**Data de escrita**: 9 de julho de 2026
**Versão**: Replication v1 (Fases 1-6 implementadas)
**Branch**: `claude/implementation-analysis-yl342s`
