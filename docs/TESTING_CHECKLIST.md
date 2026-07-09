# Testing Checklist — Replication v1 Implementation

## Antes de testar

- [ ] Abrir `index.html` no navegador (ou `controle360-mobile.html` para versão mobile auto-contida)
- [ ] Verificar que não há erros no console (F12)
- [ ] Logar como admin (credenciais de teste)

---

## Fase 1: Navegação Mobile por Perfil

### Desktop (>720px)
- [ ] Abas horizontais sempre visíveis no topo
- [ ] Tab bar rolávelmente horizontalmente se necessário
- [ ] Tela "Hoje" abre ao carregar

### Mobile (<720px)
- [ ] Bottom-nav com 5 abas principais aparece
- [ ] Menu "Mais" (sheet) lista abas adicionais
- [ ] FAB "R$" não sobrepõe os botões de ações rápidas
- [ ] FAB some quando "Mais" está aberto
- [ ] Tela "Hoje" é o landing page padrão

### Tela "Hoje"
- [ ] Mostra métricas do admin (total vendido, saldo em aberto, estoque crítico)
- [ ] Mostra ações rápidas (Vender, Novo pedido, etc.) — não sobrepõem FAB
- [ ] Vendedor vê suas metas e últimas vendas

---

## Fase 2: Reposição Padronizada em Carrinhos

### Aba "Meu Estoque" (Vendedor)
- [ ] Seção "Pedir mais estoque" visível com form
- [ ] Campo Produto: dropdown com todos os produtos disponíveis
- [ ] Campo Quantidade: aceita número > 0
- [ ] Campo Preço unitário: auto-preenchido ao escolher produto
- [ ] Campo Forma de pagamento: À vista / A prazo
- [ ] Botão "Pedir": cria carrinho com status `pending_approval`
- [ ] Tabela "Aguardando aprovação" lista pedidos próprios não aprovados

### Aba "Aprovações" (Admin)
- [ ] Carrinhos pendentes aparecem em lista/tabela
- [ ] Botão "Aprovar": permite editar quantidade e preço por item antes de confirmar
- [ ] Botão "Rejeitar": descarta carrinho sem impacto em estoque/financeiro
- [ ] Após aprovação: carrinho desaparece da lista de pendentes
- [ ] `paid_initial_amount` gravado corretamente para forma `parcial`

### Aba "Vendas" (Admin)
- [ ] Forma de pagamento "Consignado" + vendedor destino ainda funciona (via `createAdminSellerConsignment`)
- [ ] Débito é lançado em `seller_account_entries` (tipo `debit_replenishment`)

---

## Fase 3: Ledger de Dívida do Vendedor

### Aba "Vendedores" (Admin)
- [ ] Card por vendedor com nome, e-mail, status
- [ ] Métrica "Total em aberto (todos)" no topo — soma de todos os saldos
- [ ] Botão "Gerenciar" expande painel com:
  - [ ] Saldo devedor atual
  - [ ] Últimos 5 lançamentos do ledger (data, tipo, valor)
  - [ ] Form "Registrar pagamento" (valor, forma, nota)
  - [ ] Botão "Enviar estoque consignado" (produto, qtd, preço)
  - [ ] Tabela "Estoque do vendedor" (produtos em `seller_stock`)
  - [ ] Contadores "Pedidos aguardando: X" e "Devoluções pendentes: Y"

### Painel "Registrar Pagamento" (Admin)
- [ ] Valor obrigatório > 0
- [ ] Forma de pagamento (PIX, Dinheiro, Transferência, etc.)
- [ ] Após submit: cria registro em `seller_payments`
- [ ] Cria lançamento `payment` (crédito) em `seller_account_entries`
- [ ] Saldo devedor cai corretamente
- [ ] Tabela de lançamentos atualiza com novo pagamento

### Aba "Meu saldo com admin" (Vendedor)
- [ ] Mostra saldo atual ("Você deve: R$ XXX" ou "Situação: Quitado")
- [ ] Histórico lista últimos 30 lançamentos (data, tipo, nota, valor com sinal)
- [ ] Tabela "Pagamentos registrados" lista últimos 10 pagamentos (forma, data, nota, valor)
- [ ] Não há form de escrita (vendedor só lê)

---

## Fase 4: Devoluções, Desperdício, Brinde

### Aba "Devoluções, desperdícios e brindes" (Admin)
- [ ] Fila de conferência com movimentos `operational_movements`
- [ ] Botão "Conferir" por movimento abre formulário
- [ ] Após conferência: status muda para `recebido`/`devolvido_parcialmente`/`recusado`
- [ ] Impacto no estoque só ocorre em status `recebido` ou `devolvido`
- [ ] `return_credit` é lançado no ledger do vendedor

### Aba "Devoluções e brindes" (Vendedor)
- [ ] Pode criar solicitação de devolução/brinde
- [ ] Vê status de suas solicitações (pendente, recebido, recusado, etc.)
- [ ] Não pode conferir/mudar status (servidor bloqueia via RLS)

### Em uma venda (Aba "Vendas", admin clica "Devolução/Desperdício")
- [ ] Painel de devolução abre próximo, não longe
- [ ] Painel tem botão "Fechar" próprio (não precisa achar a linha de novo)
- [ ] Pode escolher "Devolução" ou "Desperdício"
- [ ] Cria movimentação `saida_venda` (negativa) e entrada correspondente se devolução
- [ ] CMV/margem recalculam corretamente

---

## Fase 5: Relatórios

### Aba "Relatórios" (Admin)
- [ ] **Saldo por vendedor**: lista cada vendedor + saldo + status
- [ ] **Pedidos em aberto**: carrinhos + orders não convertidos
- [ ] **Devoluções pendentes**: `operational_movements` com status != `recebido`/`devolvido`
- [ ] **Desperdício por período**: agrupado por mês, com total de perda
- [ ] **Brindes por responsável**: quem autorizou, quantidade, valor
- [ ] **Estoque em trânsito**: produtos já mandados para vendedor mas não confirmado recebimento

---

## Fase 6: Segurança Supabase

### RLS (Row Level Security)
- [ ] Admin vê seus próprios negócios e todos os vendedores/pedidos/estoque
- [ ] Vendedor não vê dados de outro vendedor (RLS filtra `seller_id`)
- [ ] Vendedor não vê tabelas admin-only: fornecedores, compras, fichas técnicas, produção

### Índices de Performance
- [ ] Queries sem N+1 (lado do cliente, cache em `C360.state`)
- [ ] Foreign keys têm índices
- [ ] Consulta de ledger por vendedor é rápida (< 200ms)

### Triggers de Segurança
- [ ] Vendedor não consegue criar `seller_account_entries` (só admin via `registerPayment`)
- [ ] Estoque do vendedor não pode ser alterado por outro vendedor
- [ ] Aprovação de carrinho não pode mudar `payment_mode` para evitar fraude

---

## UX Mobile (Correções de Ciclo)

### Calculadora (FAB)
- [ ] Botão "R$" aparece no canto inferior direito
- [ ] Em mobile, não sobrepõe "Ações rápidas" (padding-right aplicado)
- [ ] Desaparece quando menu "Mais" está aberto
- [ ] Funciona em modo dark/light

### Painel de Devolução
- [ ] Abre e faz scroll automático para o painel (scrollIntoView)
- [ ] Tem cabeçalho com botão "Fechar" próprio
- [ ] Fechável sem precisar achar a linha de novo

### Venda Rápida ("Mais opções")
- [ ] Campos principais visíveis: Produto, Qtd, Preço unitário, Cliente
- [ ] `<details>` "Mais opções" contém: Data, Canal, Desconto, Taxas
- [ ] `<details>` fechado por padrão
- [ ] Data tem valor default (hoje), preenchida mesmo fechada
- [ ] Envio com "Mais opções" fechadas grava com defaults corretos

---

## Round-trip Completo (Fluxo fim-a-fim)

### Vendedor pede estoque a prazo
1. [ ] Vendedor entra em "Meu estoque"
2. [ ] Preenche "Pedir mais estoque": Produto X, 10 unidades, R$ 5/un, "A prazo"
3. [ ] Clica "Pedir"
4. [ ] Movimento aparece em "Aguardando aprovação"

### Admin aprova com ajuste
1. [ ] Admin entra em "Aprovações"
2. [ ] Vê carrinho do vendedor
3. [ ] Edita quantidade para 8 (em vez de 10)
4. [ ] Aprova
5. [ ] Carrinho sai da fila, virou `order` com `status: 'pronto'`

### Dívida aparece
1. [ ] Admin vai em "Vendedores"
2. [ ] Abre painel do vendedor
3. [ ] Vê dívida: 8 × R$ 5 = R$ 40
4. [ ] Último lançamento no histórico: `debit_replenishment`, R$ 40

### Vendedor vê o saldo
1. [ ] Vendedor entra em "Meu saldo com admin"
2. [ ] Vê "Você deve: R$ 40"
3. [ ] Histórico mostra lançamento `Reposição` (débito)

### Admin registra pagamento
1. [ ] Admin volta a "Vendedores"
2. [ ] Painel do vendedor → "Registrar pagamento"
3. [ ] Digita R$ 20, forma "PIX", nota "Recebido"
4. [ ] Envia
5. [ ] Dívida cai para R$ 20
6. [ ] Histórico ganhou linha `payment`, crédito R$ 20
7. [ ] "Pagamentos já registrados" mostra novo pagamento

### Vendedor vê atualização
1. [ ] Vendedor atualiza "Meu saldo com admin"
2. [ ] Vê "Você deve: R$ 20"
3. [ ] Histórico mostra pagamento recebido

---

## Sync Mobile Build

- [ ] Após alterar qualquer `src/*.js` ou `styles/main.css`, rodar `node build-mobile.js`
- [ ] `controle360-mobile.html` é gerado/atualizado com os novos arquivos
- [ ] Verificar tamanho (~ 124 KB compactado, ~455 KB descompactado)
- [ ] Abrir em navegador e verificar que funciona offline (sem console errors)

---

## Notas finais

- **Branch de referência**: `claude/implementation-analysis-yl342s`
- **Commits**: 6 PRs mergeados (todos em `main` agora via GitHub Pages auto-deploy)
- **Skill de teste**: `.claude/skills/run-controlevendasgold/driver.mjs` (backend mocado local)
- **Data de conclusão**: 9 de julho de 2026

Se algo falhar:
1. Verificar console (F12 → Console)
2. Verificar `C360.state.getState()` no console
3. Consultar `docs/replication-v1/` para entender o fluxo
4. Rodar skill `run-controlevendasgold` para testar isoladamente sem rede
