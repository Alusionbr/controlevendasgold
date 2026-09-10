# Histórico de atualizações

Versão em texto do que a tela **Novidades** mostra dentro do sistema.

- Fonte de verdade da tela: `src/changelog.js` (constante `RELEASES`).
- Este arquivo existe para quem precisa do histórico fora do sistema
  (enviar para alguém, revisar em pull request, continuar o projeto).

## Como registrar uma atualização nova

1. Abra `src/changelog.js` e adicione um item no release do topo — ou crie um
   release novo, com a data de hoje (`AAAA-MM-DD`), no começo da lista.
2. Tipos aceitos em `kind`: `novo`, `correcao`, `melhoria`, `tecnico`.
3. Copie o mesmo texto para este arquivo, no mesmo formato.
4. Rode `node build-mobile.js` para a versão de celular sair com o histórico
   atualizado.
5. A versão exibida no cabeçalho (`v2026.09.04`, por exemplo) é a data do
   release mais recente — ela se atualiza sozinha.

---

## 2026-09-04 — Histórico de atualizações e revisão geral

- **Novo**: tela "Novidades", com a lista das atualizações do sistema por data.
- **Novo**: selo de versão no cabeçalho, com aviso quando há novidade não lida.
- **Correção**: receita recebida contava duas vezes a entrada de um pedido de
  revenda pago à vista/parcial (uma vez pelo lado do vendedor, outra pelo
  evento de pagamento da consignação gerada no despacho).
- **Correção**: mensagens de sucesso/erro do painel de Vendas e da conferência
  de devoluções sumiam no mesmo instante em que apareciam.
- **Correção**: permissões e liberações do vendedor ficaram sem tela quando a
  aba "Aprovações" saiu da navegação; voltaram para a aba Vendedores.
- **Correção**: falha ao carregar as contas por pedido derrubava o
  carregamento inteiro e a tela abria zerada.
- **Correção**: na aba Preços, salvar preço padrão/piso gravava no servidor mas
  a tela seguia mostrando o valor antigo.
- **Melhoria**: backup em Excel passou a incluir piso de preço, preço padrão e
  valor pago na entrada do carrinho.
- **Correção**: na tela do vendedor, título e explicação de cada quadro
  apareciam grudados ("Informar pagamentoO saldo muda...").
- **Melhoria**: acentuação corrigida no acompanhamento de pagamento.

## 2026-08-10 — Conta do vendedor mais direta

- **Novo**: acompanhamento de pagamento no topo da tela do vendedor.
- **Novo**: "Incluir dívida sem carrinho" na aba Vendedores.
- **Melhoria**: saldo do vendedor simplificado ("Total pendente" / "Em dia").
- **Correção**: sequência de logins diários exibia número errado.
- **Correção**: conta do vendedor podia abrir sem carregar os lançamentos.

## 2026-07-30 — Pagamentos com comprovante e senha do vendedor

- **Novo**: vendedor informa pagamento com comprovante (foto ou PDF).
- **Novo**: fila de conferência de pagamentos na aba Vendedores.
- **Novo**: troca de senha pelo vendedor e redefinição pelo administrador.
- **Novo**: tarefa de entrar 15 dias seguidos, com brindes.
- **Correção**: envio de comprovante falhava em alguns casos.

## 2026-07-29 — Conta por pedido, login por usuário e receita só quando paga

- **Novo**: contas por pedido (itens, pagamentos e saldo separados).
- **Novo**: login do vendedor por nome de usuário.
- **Novo**: histórico de alterações por registro (produtos e clientes).
- **Melhoria**: consignado só vira receita quando o pagamento é registrado.
- **Melhoria**: cadastro de produto reduzido ao essencial.

## 2026-07-28 — Backup completo

- **Correção**: o Excel exportado deixava de fora dívida dos vendedores,
  pagamentos, estoque em mãos, devoluções, preços por vendedor e metas.

## 2026-07-27 — Recebimentos do dia, custos e correções de gravação

- **Novo**: "Recebimentos do dia" na tela Hoje.
- **Correção**: editar produto/cliente e baixar lançamento não salvavam.
- **Correção**: estoque sem custo ficava valendo R$ 0 para sempre.
- **Correção**: números do painel do topo ficavam parados após gravação.
- **Correção**: consignado enviado ao vendedor não aparecia na aba Consignado.
- **Melhoria**: relatórios com gráficos e filtros; interface desktop compacta.

## 2026-07-25 — Despacho de pedido à prova de falha

- **Correção**: despacho podia gravar pela metade e travar o pedido.
- **Melhoria**: dívida da revenda nasce na aprovação do pedido.

## 2026-07-24 — Painel do vendedor somente leitura

- **Melhoria**: vendedor passou a ter uma única tela de consulta; toda
  movimentação de estoque e dinheiro é do administrador.

## 2026-07-14 — Financeiro, compras com vários itens e visão 360

- **Novo**: aba Financeiro (contas a pagar e a receber, baixa parcial).
- **Novo**: compra com vários itens no mesmo lançamento.
- **Novo**: visão 360 de cliente e produto.
- **Novo**: relatórios operacionais com filtro por período.

## 2026-07-08 — Conta corrente do vendedor, devoluções e relatórios

- **Novo**: conta corrente do vendedor (saldo = soma dos lançamentos).
- **Novo**: devolução com status, desperdício e brinde, com conferência.
- **Novo**: reposição em carrinhos com pagamento parcial real.
- **Novo**: navegação por celular (barra inferior, menu "Mais", tela "Hoje").
- **Novo**: relatórios de saldo, pedidos, devoluções, desperdício e brindes.

## 2026-07-07 — Carrinho de vendas, aprovações e links públicos

- **Novo**: carrinho de produtos em Vendas e Pedidos, com aprovação.
- **Novo**: link público de carrinho para o cliente montar o pedido.
- **Correção**: pedidos, vendas, compras e tarefas falhavam ao salvar com
  campo opcional em branco.
- **Correção**: e-mail do vendedor invisível na tela de gestão.
