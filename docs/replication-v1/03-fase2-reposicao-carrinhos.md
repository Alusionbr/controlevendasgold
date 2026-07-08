# 03 — Fase 2: reposição padronizada em carrinhos (com `parcial` real)

**Resumo:** consolidar o pedido de reposição no fluxo de carrinhos (que já tem `payment_mode` e aprovação
parcial/ajustada) e implementar de verdade o pagamento **parcial**, capturando o valor pago inicial. Toca o
banco de forma mínima (uma coluna) e reaproveita quase tudo que já existe em `src/salesCart.js`.

---

## Objetivo
Cobrir os docs `02-domain-logic/02-seller-replenishment.md` e `04-approval-with-adjustments.md` do pacote,
que pedem reposição **à vista / consignado / misto (parcial)** e aprovação **completa / com ajuste / parcial
/ rejeitar**, sempre com o efeito financeiro calculado sobre a **quantidade aprovada**, não a solicitada.

## O que já está pronto (não reimplementar)
- `payment_mode` = `avista | consignado | parcial` (`sale_carts`, constraint estendida em migration `0009`).
- Aprovação **ajustável e parcial por item**: `approveCart()` (`src/salesCart.js:462`) grava
  `sale_cart_items.approved_quantity` e `rejection_reason`; status final `approved`/`partially_approved`/
  `rejected` (`src/salesCart.js:508`).
- Aprovação consignado → `transferAdminStockToSeller()` (baixa estoque central, `saida_envio_consignado`,
  incrementa `seller_stock`, cria consignação admin→vendedor). Aprovação à vista → cria `orders` já
  `aprovado`.

## O que falta (o trabalho desta fase)

### 1. Aposentar o caminho antigo de aprovação (Decisão 2)
- Reposição do vendedor cria **carrinho** (multi-item), não `orders` diretos.
- A aba "Aprovações" do admin passa a ser a de carrinhos (`renderAdminApprovals`, `src/salesCart.js:244`);
  descontinuar `mountApprovals` de `orders` (`src/sellerStock.js:643`) da navegação.
- `orders` permanece como **registro logístico** pós-aprovação (não remover).

### 2. Pagamento `parcial` de verdade
Hoje `parcial` é só uma flag; não há onde guardar o **valor pago inicial**.
- **Banco:** adicionar `paid_initial_amount numeric not null default 0` em `sale_carts` (migration nova —
  ver draft). Alternativamente, registrar o valor pago diretamente como um **crédito no ledger** (Fase 3) no
  momento da aprovação; recomendação: guardar o valor no carrinho **e** refletir no ledger, para o carrinho
  continuar autoexplicativo.
- **UI (vendedor):** quando `payment_mode = parcial`, exibir campo "Valor pago agora"; o restante fica em
  aberto (vira dívida na Fase 3).
- **Efeito financeiro:** o valor é sempre sobre o **aprovado**. Fórmulas (do pacote):
  ```txt
  aprovado_total  = Σ (approved_quantity * unit_price)
  pago_inicial    = valor informado (0 no consignado puro; total no avista)
  divida_gerada   = aprovado_total - pago_inicial   (>= 0)
  ```
- No `avista`, `pago_inicial = aprovado_total` e `divida_gerada = 0`. No `consignado`, `pago_inicial = 0` e
  `divida_gerada = aprovado_total`. No `parcial`, algo entre os dois.

### 3. Status de pedido de reposição (opcional, alinhar com o pacote)
O pacote sugere status ricos (`pendente`, `aprovado`, `aprovado_com_ajuste`, `aprovado_parcialmente`,
`rejeitado`, `entregue`, `finalizado`). Os carrinhos já têm equivalentes (`pending_approval`, `approved`,
`partially_approved`, `rejected`, `converted`). **Recomendação:** reusar os status de carrinho existentes e
apenas mapear rótulos em português na UI, em vez de criar um enum novo — menos migração, mesmo resultado
para o usuário.

## Ligação com a Fase 3 (ledger)
A aprovação de carrinho **consignado/parcial** é exatamente o ponto onde o **débito** entra no ledger. Esta
fase deixa o gancho pronto (`divida_gerada` calculado na aprovação); a Fase 3 grava o `debit_replenishment`.

## Arquivos afetados (quando implementada)
- `src/salesCart.js` — captura de `paidInitialAmount`, cálculo de `divida_gerada`, rótulos PT dos status.
- `src/app.js` — remover a aba/entrada de aprovação antiga de `orders` da navegação.
- `src/state.js` / `docs/backend.md` / `docs/modelo-dados.md` — registrar a nova coluna `paid_initial_amount`.
- Migration nova (draft): `alter table sale_carts add column paid_initial_amount ...`.

## Critérios de aceite
- Vendedor pede reposição à vista, consignado e parcial; admin aprova completo/ajuste/parcial/rejeita.
- Valor financeiro sempre sobre o aprovado.
- `parcial` grava valor pago e deixa saldo devedor correto para a Fase 3.
- Um único ponto de aprovação (carrinhos).
