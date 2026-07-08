# 02 — Fase 1: navegação mobile por perfil (sem banco)

**Resumo:** transformar a barra única de 20 abas em uma navegação mobile por perfil — bottom-nav com as 5
funções principais, um menu "Mais" para o resto, e uma tela "Hoje" de abertura. É 100% frontend
(`index.html`, `src/app.js`, `styles/main.css`), reversível e de alto valor visual. Nenhuma mudança de
Supabase.

---

## Objetivo

Resolver os problemas nº 1 e nº 2 do resumo executivo do pacote: abas demais no mesmo nível e vendedor com
acesso visual a ferramentas demais. Meta visual: `assets/screens/01-hoje-dashboard.png` e mapas
`assets/maps/02-mapa-admin.png` / `03-mapa-vendedor.png`.

## Navegação alvo (de `docs/03-ux-mobile/01-navigation.md` do pacote)

**Admin — bottom-nav:** Hoje · Vender · Clientes · Estoque · **Mais**
Menu "Mais" (admin): Pedidos/Aprovações, Vendedores, Produtos, Produção, Compras, Fornecedores, Débitos dos
vendedores, Devoluções, Desperdícios, Brindes, Relatórios, Backup, Configurações.

**Vendedor — bottom-nav:** Hoje · Vender · Clientes · Meu estoque · **Metas**
Menu "Mais" (vendedor): Meus pedidos, Meu saldo com admin, Consignado com clientes, Devoluções, Brindes,
Informar desperdício, Ajuda, Perfil, Sair.

> Nota: alguns itens do menu "Mais" (Débitos, Devoluções com status, Brindes, Meu saldo) só ficam completos
> nas Fases 3–4. Na Fase 1 eles podem apontar para as abas atuais equivalentes ou ficar ocultos até a fase
> correspondente — decidir item a item, sem prometer tela que ainda não existe.

## Passos de implementação

### 1. Fonte única de navegação (elimina a duplicação)
Hoje a lista de abas existe duas vezes: `<button>` estáticos em `index.html:37-58` **e** `TAB_ROLES` em
`src/app.js:37`. Criar **um mapa único** — `TAB_ROLES` já tem o papel; falta acoplar rótulo, ícone e o
"slot" de navegação (bottom-nav vs. "Mais") a cada aba. Sugestão: estender `TAB_ROLES` para
`NAV_ITEMS = { tab: { roles, label, icon, slot } }`, e **gerar** os botões/itens a partir dele. `index.html`
passa a ter só os contêineres (`<nav class="bottom-nav">` e `<div class="more-menu">`), sem a lista fixa.

### 2. Bottom-nav
- Um `<nav class="bottom-nav">` fixo no rodapé (mobile), com os 5 itens do perfil corrente.
- Cada item chama o pipeline já existente: `setTab(dataTab)` (`src/app.js:153`). **Nada** do miolo de render
  muda — `renderTab()`/`LEGACY_RENDERERS`/`mountModuleTab` continuam iguais.
- O item ativo reflete `activeTab` (mesma lógica de `.active` de hoje).

### 3. Menu "Mais"
- Botão "Mais" na bottom-nav abre um painel (drawer/sheet) com o restante das funções do perfil.
- Itens gerados do mapa único, filtrados por `tabAllowed()` (`src/app.js:65`) — **função fora do perfil não
  renderiza**.
- Ao escolher um item, fecha o painel e chama `setTab(dataTab)`.

### 4. Tela "Hoje"
- Nova aba `hoje` (primeira do bottom-nav, ambos os perfis), virando o `firstAllowedTab()` padrão.
- Reaproveitar `renderDashboard()` (`src/app.js:126`, que já calcula métricas via `Calc.businessMetrics`) e
  compor com:
  - **Ações rápidas** (Nova venda, Novo cliente, Estoque, Aprovações para admin; Vender, Novo cliente, Meu
    estoque, Meus pedidos para vendedor) — cada uma é um atalho `setTab(...)`;
  - **Últimas movimentações** (vendas/pedidos/clientes recentes do estado já em cache);
  - **Estoque crítico** (produtos com `currentStock <= minStock` — já há `lowStockCount` em
    `businessMetrics`, `src/calculations.js:111`).
- Admin e vendedor têm composições diferentes (mapas `02`/`03`): o vendedor vê minhas vendas/minha meta/meu
  estoque/meus pedidos/clientes recentes.

### 5. Papel e defesa em profundidade
- `applyRoleVisibility()` (`src/app.js:74`) passa a esconder/mostrar itens da bottom-nav e do "Mais".
- Manter a regra de que a garantia real de acesso é a **RLS no banco** — a nav é só UX.

### 6. Estilos (`styles/main.css`)
- `.bottom-nav` fixa (`position: fixed; bottom: 0`), com `padding-bottom: env(safe-area-inset-bottom)` para
  iPhone; itens com alvo de toque ≥ 44px (já é o padrão de `.tab-button`).
- `.more-menu` como sheet deslizante; respeitar tema claro/escuro existente.
- No desktop, decidir: manter a barra de abas atual **ou** adaptar a mesma nav — recomendação: manter a
  navegação atual no desktop (largura ≥ 721px) e ativar bottom-nav só no mobile, via media query, para não
  regredir a experiência de desktop.

### 7. Build mobile
Ao final, rodar `node build-mobile.js` para regenerar `controle360-mobile.html` (o `CLAUDE.md` exige manter
as duas versões sincronizadas).

## Arquivos afetados (quando a fase for implementada)
- `index.html` — trocar a `<nav class="tabs">` estática por contêineres de bottom-nav + "Mais".
- `src/app.js` — `NAV_ITEMS`, geração da nav, aba `hoje`, `renderToday()` compondo `renderDashboard()`,
  ajustes em `applyRoleVisibility`/`firstAllowedTab`/wiring de clique.
- `styles/main.css` — `.bottom-nav`, `.more-menu`, `.today-*`, media queries.
- `controle360-mobile.html` — regenerado pelo build.

## Critérios de aceite (do `docs/06-testing/01-acceptance-tests.md` do pacote)
- Admin e vendedor veem **bottom-navs diferentes**; item fora do perfil não aparece.
- "Hoje" abre por padrão e mostra métricas + ações rápidas + listas.
- Nenhuma função nova de banco é chamada; nenhuma migration é aplicada.
- Desktop não regride.

## Fora de escopo desta fase
Qualquer lógica de dívida, devolução-com-status, desperdício/brinde ou pagamento parcial — só a **casca de
navegação** e a tela "Hoje". Os itens de "Mais" que dependem de fases futuras ficam ocultos ou apontam para
o equivalente atual.
