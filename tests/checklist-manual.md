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

## Vendedor — devolução, brinde, desperdício e correção (aba Vendedores)

Tudo isto acontece dentro de **Vendedores → Abrir** no card do vendedor. Não
existe passo de conferência separado: o admin registra e já vale.

1. **Enviar consignado**: em "Enviar estoque consignado", envie 10 un a R$ 25.
   Confirme: estoque central cai 10, "Mercadoria em mãos" sobe, e o histórico
   ganha um débito de R$ 250.
2. **Brinde abatendo a dívida**: em "Devolução, brinde ou desperdício",
   escolha "Virou brinde", 4 un, valor unitário 25, deixe "Abater esse valor
   da dívida" marcado. Confirme: dívida cai R$ 100, mercadoria em mãos cai 4
   un, e o estoque **central não muda** (já tinha saído no envio).
3. **Desperdício**: mesmo caminho com "Perdeu / quebrou". Se desmarcar
   "abater", a mercadoria sai das mãos do vendedor e a dívida **continua** —
   é o caso em que o prejuízo é do vendedor.
4. **Devolução ao central**: escolha "Devolveu ao estoque central", 2 un a
   R$ 25. Confirme: dívida cai R$ 50, mercadoria em mãos cai 2 un, estoque
   central **sobe** 2 un e aparece um `entrada_devolucao_consignado` em
   movimentações.
5. **Ajuste manual**: em "Ajuste manual / correção", lance R$ 10 como
   "Reduzir a dívida" com um motivo. O saldo cai R$ 10 e o lançamento aparece
   no histórico como "Ajuste manual".
6. **Corrigir lançamento**: clique em "Corrigir" numa linha do histórico. O
   formulário de ajuste abre preenchido com o valor daquele lançamento e a
   direção **invertida**. Confirme e veja o saldo voltar. O lançamento
   original **continua no histórico** — corrigir nunca apaga nada.
7. **Visão do vendedor**: entre como o vendedor e abra "Minha conta". Saldo,
   estoque em mãos e histórico devem bater com o que o admin vê, e não pode
   existir nenhum formulário de escrita na tela.
8. **Lista enxuta**: com pelo menos um vendedor desativado, a lista mostra só
   os ativos e um botão "Mostrar N desativado(s)".

## Saiu sem venda (desperdício, brinde, patrocínio)

1. Com mercadoria em mãos de um vendedor, registre um **patrocínio** em
   Vendedores → Abrir → "Devolução, brinde, patrocínio ou desperdício".
2. Na tela **Hoje**, o cartão "Saiu sem venda (mês)" deve somar o custo dessa
   saída (quantidade × custo médio do produto) e contar a ocorrência.
3. Em **Relatórios**, o painel "Saiu sem venda" deve listar a linha
   Patrocínio com custo e "abatido da dívida", mais o total e o detalhe por
   responsável.
4. Repita com brinde e desperdício: cada um aparece na sua própria linha, sem
   se misturar.
