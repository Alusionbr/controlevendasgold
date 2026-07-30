# Checklist manual de teste

Use este checklist antes de considerar uma alteração aprovada.

## Negócios

- [ ] Sistema abre sem dados preenchidos.
- [ ] É possível criar um negócio.
- [ ] Trocar negócio ativo filtra os dados corretamente.

## Produtos

- [ ] Botão **+ Novo produto** aparece no cabeçalho da aba Produtos e leva o foco ao campo Nome.
- [ ] Cadastro básico exige somente nome, tipo e unidade; estoque, custo e preço podem ficar em zero.
- [ ] **Mais opções** abre estoque mínimo, custos, margem, taxas e observações.
- [ ] Após salvar, o produto aparece na tabela e fica disponível em compras, vendas e consignados.
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

## Conta do vendedor por pedido

- [ ] Envio com vários produtos aparece como um único pedido nas telas do admin e do vendedor.
- [ ] O cartão mostra total, pagamentos e saldo em aberto corretos.
- [ ] Pagamento parcial muda o pedido para **Parcial** e reduz o saldo geral pelo mesmo valor.
- [ ] **Usar saldo total** quita exatamente o pedido e muda o status para **Quitado**.
- [ ] O banco rejeita pagamento maior que o saldo do pedido.
- [ ] Vendedor visualiza apenas as próprias contas e não vê formulários de pagamento.
- [ ] Saldo antigo sem pedido aparece separado e pode ser acertado pelo administrador.
- [ ] Backup Excel contém a aba **Pagamentos por pedido**.

## Receita recebida e saída a prazo

- [ ] Informar venda consignada não aumenta **Receita recebida**.
- [ ] O valor informado aparece em **Vendido a prazo**.
- [ ] Registrar pagamento aumenta a receita exatamente pelo valor pago.
- [ ] **Saiu a prazo** separa clientes de vendedores.
- [ ] Pedido de vendedor aparece por carrinho com total, pago, saldo e status.
## Alinhamento, tarefa de login e senha

- [ ] Sem liberação do admin, o alinhamento de saldo não aparece para o vendedor.
- [ ] Após liberar, o vendedor informa o saldo; a diferença aparece no histórico e o formulário desaparece.
- [ ] Uma segunda tentativa direta ao RPC é rejeitada sem alterar a conta.
- [ ] Recarregar várias vezes no mesmo dia não aumenta a sequência.
- [ ] O 15º dia consecutivo gera exatamente 1 brinde; o admin consegue marcar a entrega uma vez.
- [ ] A troca de senha rejeita senha atual incorreta e confirma a nova senha em novo login.
- [ ] O vendedor não enxerga dados, saldos ou recompensas de outro vendedor.
## Pagamento informado pelo vendedor

- [ ] Vendedor escolhe pedido, informa data/hora, valor e envia foto ou PDF.
- [ ] Arquivo acima de 10 MB ou com tipo diferente dos permitidos é rejeitado.
- [ ] Informe pendente não reduz o saldo nem aumenta a receita.
- [ ] Admin abre o comprovante e vê os dados informados.
- [ ] Admin corrige o valor e lança com um clique; saldo e receita usam o valor corrigido.
- [ ] Banco rejeita valor maior que o saldo aberto e uma segunda aprovação do mesmo informe.
- [ ] Recusar preserva o histórico e não cria pagamento.
- [ ] Vendedor e administrador não conseguem acessar comprovantes de outro negócio.
- [ ] Backup Excel contém a aba **Pagamentos informados**.