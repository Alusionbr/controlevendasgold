# Checklist manual de teste

Use este checklist antes de considerar uma alteração aprovada.

## Negócios

- [ ] Sistema abre sem dados preenchidos.
- [ ] É possível criar um negócio.
- [ ] Trocar negócio ativo filtra os dados corretamente.

## Produtos

- [ ] Produto é cadastrado com tipo e unidade.
- [ ] Produto final aceita margem, taxa, mão de obra, custo fixo e perda.
- [ ] Serviço não deve movimentar estoque físico.

## Compras

- [ ] Compra aumenta estoque.
- [ ] Compra recalcula custo médio.
- [ ] Compra cria movimentação `entrada_compra`.

## Ficha técnica

- [ ] Produto final recebe matéria-prima e embalagem.
- [ ] Sistema bloqueia item duplicado na mesma ficha.
- [ ] Simulador mostra custo final e preço sugerido.

## Produção

- [ ] Produção sem ficha é bloqueada.
- [ ] Produção com estoque insuficiente é bloqueada.
- [ ] Produção baixa insumos.
- [ ] Produção entra produto final.
- [ ] Produção cria movimentos de saída e entrada.

## Venda

- [ ] Venda com estoque insuficiente é bloqueada.
- [ ] Venda baixa estoque.
- [ ] Venda calcula CMV.
- [ ] Venda calcula lucro bruto.

## Pedido

- [ ] Pedido aparece no Kanban.
- [ ] Pedido pode ser arrastado.
- [ ] Baixar venda cria venda e baixa estoque.

## Consignado

- [ ] Envio consignado baixa estoque central.
- [ ] Venda informada gera venda sem baixar estoque novamente.
- [ ] Devolução volta para estoque.
- [ ] Pagamento reduz valor em aberto.

## Vendedores — consignado, ajuste e correção (pós-reestruturação)

- [ ] Vendedor logado só vê a aba "Minha conta" (sem venda/pedido em lugar nenhum).
- [ ] "Minha conta" mostra saldo, "O que está com você" (leitura) e histórico batendo com o lado do admin.
- [ ] Admin → Vendedores → Gerenciar → "Enviar estoque consignado" baixa o central, sobe o estoque do vendedor e gera dívida.
- [ ] "Devolver, desperdício ou brinde" (tipo Devolução) sobe `products.currentStock`, baixa o estoque do vendedor e credita o ledger quando marcado.
- [ ] "Ajuste manual" (crédito e débito, motivo obrigatório) muda o saldo e aparece no histórico.
- [ ] "Corrigir" num lançamento pré-preenche o ajuste manual com direção/valor invertidos; nenhum lançamento antigo é editado ou apagado.

## Backup

- [ ] Exportar backup gera JSON.
- [ ] Importar backup restaura dados.

## Backup e exportação

1. Com pelo menos um negócio e alguns produtos, abra a aba **Dados**.
2. Clique em **Baixar Excel completo**. Confirme que o arquivo abre no Excel/Google Sheets com uma aba por módulo e os valores corretos.
3. Edite um valor numérico numa aba de dados, salve, e use **Importar Excel**. Confirme o aviso de substituição e veja o valor atualizado no sistema.
4. Clique em **Baixar JSON** e depois **Importar JSON** do mesmo arquivo: os dados devem permanecer iguais.
5. Exporte um **CSV** de Produtos e confira acentuação e separador no Excel.
6. Importe um Excel sem a aba `Backup_NAO_EDITAR`: os dados devem entrar e as configurações locais atuais devem ser mantidas.
