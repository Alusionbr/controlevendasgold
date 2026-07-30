# Fluxos operacionais

> Fluxos 9-12 abaixo são novos desde a integração multiusuário (Supabase).
> Fluxos 1-8 continuam válidos para o papel **admin**; o papel **vendedor**
> só enxerga um subconjunto das abas (ver CLAUDE.md, seção "Atualização:
> multiusuário").

## Fluxo 1 — Configurar negócio

1. Acessar **Negócios**.
2. Criar nome do negócio.
3. Escolher segmento.
4. Definir margem padrão.
5. Definir taxa padrão, se existir.

Resultado: os próximos cadastros ficam vinculados ao negócio ativo.

---

## Fluxo 2 — Cadastrar essência aromática

1. Em **Produtos**, cadastrar a matéria-prima em ml, g, kg ou outra unidade.
2. Cadastrar vidro como embalagem.
3. Cadastrar rótulo como embalagem.
4. Cadastrar caixa como embalagem.
5. Cadastrar tampa/lacre/válvula como embalagem.
6. Cadastrar o produto final.
7. Informar no produto final:
   - mão de obra por unidade;
   - custo fixo rateado por unidade;
   - perda técnica;
   - margem desejada;
   - taxa de venda.
8. Em **Fichas e custos**, adicionar todos os itens usados por unidade.
9. Usar o simulador de custo.

---

## Fluxo 3 — Compra

1. Cadastrar fornecedor, se quiser.
2. Lançar compra em **Compras**.
3. O sistema aumenta estoque.
4. O sistema recalcula custo médio.
5. O sistema cria movimentação de entrada.

---

## Fluxo 4 — Produção

1. Ter produto final cadastrado.
2. Ter ficha técnica cadastrada.
3. Ter estoque dos insumos.
4. Lançar produção.
5. O sistema baixa insumos e embalagens.
6. O sistema calcula custo total.
7. O sistema entra com produto final em estoque.

---

## Fluxo 5 — Venda direta

1. Selecionar produto.
2. Informar quantidade e preço.
3. Informar desconto/taxas, se houver.
4. O sistema baixa estoque.
5. O sistema calcula CMV e lucro.

---

## Fluxo 6 — Pedido

1. Criar pedido em **Pedidos**.
2. Arrastar entre Pendente, Em preparo, Pronto, Despachado e Concluído.
3. Quando sair de fato, usar **Baixar venda**.
4. A baixa cria venda e reduz estoque.

---

## Fluxo 7 — Consignado

1. Cadastrar cliente.
2. Enviar consignado.
3. O sistema baixa estoque central.
4. Quando cliente vender, registrar venda.
5. Quando devolver, registrar devolução.
6. Quando pagar, registrar pagamento.

---

## Fluxo 8 — Tarefas

1. Criar tarefa.
2. Arrastar no Kanban.
3. Usar para controle de compras, produção, cobrança e despacho.

---

## Fluxo 9 — Login e papéis

1. Acessar o app: sem sessão válida, aparece a tela de login (`src/auth.js`).
2. Entrar com e-mail/senha. O admin cria a conta do vendedor na aba
   **Vendedores** (chama a Edge Function `create-seller`).
3. Depois do login, o app mostra só as abas permitidas para o papel do
   usuário (`TAB_ROLES` em `src/app.js`).

## Fluxo 10 — Devolução e desperdício

1. Na aba **Vendas**, clicar em "Devolução/Desperdício" na linha da venda.
2. Devolução: informar quantidade devolvida — gera venda de estorno
   (quantidade negativa) e volta o valor e o estoque.
3. Desperdício: informar quantidade perdida — só baixa estoque
   (`saida_desperdicio`), sem mexer em dinheiro.

## Fluxo 11 — Estoque próprio do vendedor e aprovação de pedidos

1. Admin repassa estoque a um vendedor na aba **Aprovações** (Repassar
   estoque).
2. Vendedor vende a partir do próprio estoque na aba **Meu estoque** — a
   venda gera uma consignação já 100% vendida, cujo saldo em aberto é o
   valor que o vendedor deve repassar ao negócio.
3. Vendedor pede reposição na aba **Pedidos** (fica `pendente_aprovacao`).
4. Admin aprova ou rejeita na aba **Aprovações**.

## Fluxo 12 — Metas de vendas

1. Admin cria meta semanal/mensal por vendedor na aba **Metas**, com
   premiação opcional.
2. Vendedor acompanha o próprio progresso na mesma aba (só leitura).

## Fluxo 13 — Carrinho de produtos (Vendas e Pedidos)

1. Nas abas **Vendas** e **Pedidos** (admin e vendedor), o mesmo carrinho
   (`src/salesCart.js`) fica disponível no topo da tela — é o mesmo
   rascunho independente de qual das duas abas você está vendo.
2. Para cada item, escolha produto, quantidade e preço unitário e clique em
   "Adicionar item".
3. Antes de salvar, defina: origem do estoque (próprio do vendedor ou do
   administrador), canal, tipo de venda (à vista/parcial/consignado) e,
   opcionalmente, o nome do cliente.
4. "Salvar pedido": se a origem for estoque do administrador, vira pedido
   `pendente_aprovacao` (aparece para o admin aprovar/ajustar quantidades em
   "Aprovações de carrinho"); se for estoque próprio, o vendedor confirma a
   baixa em "Baixar estoque próprio" na lista de carrinhos.
5. "Gerar link": cria um link público (só para pagamento à vista) que o
   cliente final abre sem login para confirmar o pedido e anexar
   comprovante.

## Fluxo 14 — Status do pedido e acerto de estoque (só admin decide)

1. Todo pedido criado (por admin ou vendedor) nasce com status `pendente` —
   o sistema não permite escolher outro status inicial.
2. Só o administrador arrasta o cartão do pedido no Kanban, usa "Mover
   para" ou clica em "Baixar venda"/"Excluir". Para o vendedor, o cartão do
   pedido aparece travado (sem arrastar, sem esses botões).
3. Se um vendedor antigo tem estoque próprio sem registro correto, o admin
   clica em "Liberar 1 acerto de estoque" (painel de permissões, abas
   Vendas/Pedidos). O vendedor então vê, em **Meu estoque**, a seção
   "Acerto de estoque" para corrigir a quantidade de um produto com motivo
   obrigatório — usa o crédito uma única vez.

## Fluxo 15 — Venda unificada + esteira (migração 0016)

Substitui a duplicação Vendas/Pedidos por um único painel na aba **Vendas**.

1. No topo do carrinho escolhe-se o **tipo de venda**:
   - **Venda minha (cliente final)** → `orders.sale_type = 'propria'`,
     `seller_id` = admin; campo Cliente disponível.
   - **Venda ao revendedor** → `orders.sale_type = 'revenda'`, com pagamento
     (À vista / Parcial / Consignado) e o vendedor de destino (`seller_id` =
     vendedor).
2. Monta-se o carrinho (vários produtos) e clica em **Lançar**. Cada item
   vira uma linha em `orders` com o mesmo `order_group_id`, `status =
   'pendente'`. Admin lança já `aprovado`; vendedor que pede reposição lança
   `pendente_aprovacao` (aparece na esteira do admin como card a aprovar).
3. **Só o admin** move o grupo pela esteira: Pendente → Em montagem → Pronto
   → Despachado → Concluído (arrastar ou "Mover para"). O grupo inteiro anda
   junto — ver `advanceOrderGroup()` em `src/salesCart.js`.
4. **No Despachado** a venda materializa (idempotente por linha):
   - `propria` → cria a venda (baixa estoque `saida_venda`, CMV, lucro);
   - `revenda` consignado → `transferAdminStockToSeller` + débito no ledger
     do vendedor (`seller_account_entries`);
   - `revenda` à vista → transfer com `amountPaid = total`, sem débito;
   - `revenda` parcial → transfer + débito de `total − paid_amount`.
5. **Concluído** só confirma a entrega, sem novo efeito de estoque/financeiro.

O vendedor vê a mesma esteira só leitura (status do que pediu) e continua
podendo **vender o próprio estoque** (baixa imediata, produto já está na mão)
direto na aba Vendas.

## Fluxo 16 — Estoque e conta do vendedor por pedido

1. Um envio de revenda aprovado mantém o mesmo `order_group_id` para todos os itens do carrinho.
2. Na tela **Minha conta**, o vendedor vê um cartão por pedido com itens enviados, quantidade ainda em mãos, pagamentos e saldo.
3. Na aba **Vendedores**, o administrador abre o vendedor e registra o recebimento dentro do pedido correspondente.
4. Para pagamento parcial, informa um valor menor que o saldo; o pedido muda para **Parcial**.
5. Para quitação, usa **Usar saldo total** e confirma; o pedido muda para **Quitado**.
6. O RPC `register_seller_order_payment` grava pagamento, alocação e crédito no ledger na mesma transação.
7. Valores históricos que não pertencem a um pedido aparecem separadamente como **Saldo anterior sem pedido**.

## Fluxo 17 — Receita recebida e saída a prazo

1. Venda direta à vista entra imediatamente em **Receita recebida**.
2. Ao informar a venda de um consignado, o valor passa para **Vendido a prazo** e continua fora da receita.
3. Ao registrar o pagamento do cliente, o valor pago entra na receita na data do recebimento.
4. Pedido de revenda despachado aparece em **Saiu a prazo — Vendedores**, por carrinho/pedido.
5. Ao registrar pagamento no pedido do vendedor, somente o valor recebido entra na receita.
6. Dashboard, tela Hoje e Relatórios usam a mesma fórmula e mostram separadamente as origens: à vista, pagamentos de clientes e pagamentos de vendedores.
## Fluxo 18 — Alinhamento de saldo, sequência e senha do vendedor

1. Na aba **Vendedores**, o administrador clica em **Liberar alinhamento de saldo**.
2. Em **Minha conta**, o vendedor informa o total devido e confirma. A diferença entra no histórico e o formulário desaparece imediatamente.
3. Ao entrar no aplicativo, o vendedor registra no máximo um dia da sequência. No 15º dia consecutivo recebe 1 brinde disponível.
4. O administrador usa **Marcar brinde entregue** para consumir um crédito e registrar a entrega.
5. Em **Alterar minha senha**, o vendedor informa senha atual, nova senha e confirmação; a sessão é reautenticada antes da alteração.
## Fluxo 19 — Pagamento informado pelo vendedor

1. Em **Minha conta**, o vendedor abre **Informar pagamento** e escolhe o pedido ou saldo anterior.
2. Informa data/hora, valor, forma, observação e anexa foto JPG/PNG/WebP ou PDF de até 10 MB.
3. O informe aparece como **Aguardando conferência** e ainda não altera saldo nem receita.
4. Na aba **Vendedores**, o administrador abre o vendedor, consulta o comprovante e confere os dados.
5. Se necessário, corrige valor, data, forma e deixa uma nota; depois clica em **Conferir e lançar pagamento**.
6. O banco valida o saldo e lança tudo atomicamente. O administrador também pode recusar, informando o motivo.