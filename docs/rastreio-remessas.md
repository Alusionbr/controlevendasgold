# Rastreio 360 de remessas

A aba **Rastreio 360** acompanha mercadorias consignadas por produto e remessa. Ela cobre os dois
sentidos da operação:

- entrada de mercadoria recebida de fornecedor;
- saída de mercadoria enviada a vendedor ou cliente/parceiro.

Somente administradores registram ou alteram movimentos. Cada vendedor pode consultar apenas as
remessas destinadas à própria conta. O isolamento é aplicado pelas políticas RLS do banco, inclusive
nos itens, eventos e pagamentos da remessa.

## Ciclo da remessa

1. **Saída registrada:** a remessa fica `Em trânsito`. Numa saída, o estoque central já é baixado;
   numa entrada, nenhuma quantidade é recebida ainda.
2. **Entrega confirmada:** a remessa fica `Entregue`. Uma entrada soma estoque e recalcula o custo
   médio. Uma saída para vendedor passa a compor o estoque desse vendedor.
3. **Movimentos posteriores:** vendas informadas, devoluções e pagamentos parciais ficam no histórico
   da remessa, com data, quantidade, valor e observação.
4. **Encerramento:** quando não resta quantidade em mãos nem saldo financeiro, a remessa é fechada.

A entrega gera a obrigação financeira completa. Pagamentos reduzem o saldo e valores acima do total
ficam registrados como crédito. O vencimento pode ocorrer conforme as vendas ou em ciclos semanais e
mensais.

## Origem do produto

Ao criar uma saída, o administrador pode vinculá-la a um item de uma remessa de entrada. Esse vínculo
preserva a cadeia fornecedor → negócio → vendedor/cliente e impede alocar mais unidades do que o saldo
disponível naquela origem.

## Registros contábeis e de estoque

As rotinas são transacionais e idempotentes: uma tentativa repetida com o mesmo identificador não
duplica a operação. Toda mudança física gera um registro em `stock_movements`. Entregas e pagamentos
também atualizam `financial_entries`; remessas para vendedores integram `seller_stock`,
`seller_account_entries` e `seller_payments`.

As tabelas principais são `tracking_shipments`, `tracking_shipment_items`,
`tracking_shipment_events` e `tracking_shipment_payments`.
