# Análise do sistema — o que dá para melhorar

Feita em **05/09/2026**, com o app rodando (perfis administrador e vendedor,
telas de celular e computador) e medindo o comportamento real, não só lendo o
código. Os números abaixo foram medidos nesta análise.

O que **já está bom** e não precisa mexer: o modelo de dados, as regras de
negócio (custo médio, CMV, consignado, regime de caixa), a separação entre
receita recebida e o que saiu a prazo, a RLS no banco, e a decisão de manter
JavaScript puro — o sistema é revisável por qualquer pessoa, sem ferramenta.

Os problemas abaixo estão em ordem de impacto.

---

## 1. Metade das operações de dinheiro/estoque não é atômica

Compra, despacho de pedido, pagamento de vendedor e devolução de venda já
rodam numa função no banco (uma transação: ou faz tudo, ou não faz nada).
**O resto ainda é uma sequência de gravações soltas feitas pelo navegador.**

| Operação | Gravações separadas | Se falhar no meio |
|---|---|---|
| Produção | 2 por insumo + 3 no fim (ficha com 5 itens = **13 idas ao servidor**) | Insumo baixado sem o produto final entrar |
| Consignado com cliente | 3 | Estoque sai sem registro de consignação |
| "Registrar venda" do consignado | 3 | Venda lançada sem baixar a consignação |
| Devolução de consignado | 4 | Estoque volta sem baixar a consignação |
| Venda manual | 3 | **Estoque baixado sem movimentação** (fere a regra central do projeto) |
| Ajuste de estoque | 2 | Estoque alterado sem o motivo registrado |
| Lançar pedido de revenda | 2 por item | Pedido sem a dívida correspondente |

Queda de internet no meio, celular que trava, ou um erro de permissão na
segunda chamada deixam o dado pela metade — e o sistema não tem como saber
que ficou.

**Proposta:** mover essas operações para funções no banco, na mesma linha do
que já foi feito com compra e despacho. Começar por **produção** e **venda
manual**, que são as de maior volume.

## 2. Cada gravação rebaixa o sistema inteiro da internet

Medido: **33 requisições** a cada `refresh()`, e ele roda depois de quase toda
gravação. Confirmar uma devolução dispara **36 requisições** (3 de gravação +
33 de recarga). Nenhuma consulta tem limite ou filtro de data: todo `refresh`
baixa **todas** as vendas, movimentações e pedidos desde o primeiro dia.

Consequências que aparecem com o tempo, não hoje:

- no celular em rede fraca, cada clique de salvar vira segundos de espera;
- o espelho local (`localStorage`) mede hoje **0,5 KB por linha**. O limite do
  navegador é ~5 MB, ou seja **~10 mil linhas**. Num ritmo de 30 vendas/dia
  (cada venda gera venda + movimentação + conta a receber), isso é atingido em
  **3 a 4 meses de uso**. Depois disso o espelho para de funcionar em silêncio
  e cada gravação ainda paga o custo de tentar.

**Proposta:** (a) limitar as consultas pesadas a uma janela (ex.: 90 dias) e
buscar histórico antigo só quando o relatório pedir; (b) trocar o `refresh()`
completo por recarga só da coleção afetada — a estrutura para isso já existe
(`state.onRefresh`). Nenhuma das duas muda regra de negócio.

## 3. `src/app.js` virou o arquivo de tudo

2.981 linhas: navegação, 14 telas, cálculo de venda, produção, consignado,
ajuste de estoque, atalhos de teclado e o delegador global de eventos. O
próprio `CLAUDE.md` pede "arquivos pequenos e com nome claro" — este é a
exceção que já atrapalha: foi nele que apareceram os dois bugs silenciosos
mais caros da revisão anterior (`form.id` e o painel congelado).

**Proposta:** extrair por tela, sem reescrever nada — `src/screens/produtos.js`,
`vendas.js`, `consignado.js`, `financeiro.js`. É recorte, não redesenho.

## 4. Erros aparecem em caixa do navegador

40 usos de `alert`, `confirm` e `prompt` no código. No celular eles travam a
tela, não têm o visual do sistema e — no caso de `prompt` (usado para registrar
venda, devolução e pagamento de consignado) — não aceitam vírgula decimal do
teclado numérico de forma confiável nem permitem revisar antes de enviar.

**Proposta:** trocar por diálogo próprio, como o de "Ajustar estoque" já faz.
Prioridade nos três `prompt` do consignado, que são fluxo de dinheiro.

## 5. Testes cobrem regras, não contas

O projeto tem **43 testes** rodando no CI — melhor do que eu havia registrado
antes. Mas quase todos leem o código-fonte e conferem que uma decisão não foi
desfeita; só um arquivo testa cálculo de verdade. Foi exatamente aí que passou
a receita contada duas vezes, corrigida nesta rodada.

**Proposta:** cobrir custo médio ponderado, ficha técnica, `saleMath` e
`businessMetrics` com números conferidos à mão. É barato: os cálculos já são
JavaScript puro, sem tela.

## 6. Riscos operacionais fora do código

- **O projeto no Supabase está hibernado.** No plano gratuito ele dorme após
  dias sem uso e precisa ser religado no painel — enquanto isso, ninguém
  consegue entrar no sistema. Vale saber disso antes de mostrar para alguém.
- **Restaurar backup ainda não grava no servidor** (detalhado em
  `docs/plano-melhorias.md`): exportar funciona, importar só mostra na tela.
- **A validade do cache dos arquivos é manual.** Cada `<script src="...?v=...">`
  no `index.html` tem uma data escrita à mão; esquecer de trocar faz o
  navegador do usuário continuar rodando a versão antiga depois de uma
  publicação. Já existiram datas diferentes entre arquivos alterados juntos.

## 7. Coisas pequenas que valem por serem baratas

- Busca/filtro nas listas de produtos, clientes e vendas (hoje só rolagem).
- "Consignado em aberto" é calculado de duas formas diferentes em painéis
  vizinhos e vai divergir quando houver ajuste manual no saldo.
- A aba **Ajuda** tem o conteúdo escrito para o vendedor, mas só o
  administrador enxerga — e descreve funções que o vendedor não tem mais.
- Dois módulos inteiros (`sellerStock.js` e a parte do vendedor de
  `operationalMovements.js`) estão sem uso desde que o painel dele virou
  somente leitura: religar ou remover.

---

## Ordem sugerida

1. Produção e venda manual viram operação única no banco (item 1).
2. Janela de datas nas consultas + recarga por coleção (item 2).
3. Testes de cálculo (item 5).
4. Diálogos próprios no lugar de `prompt` no consignado (item 4).
5. Quebrar `app.js` por tela (item 3).
6. Restaurar backup de verdade e resolver a ajuda do vendedor (itens 6 e 7).

Nada aqui muda regra de negócio. São mudanças de estrutura: o que o sistema
calcula continua igual, o que muda é a chance de ele errar quando a internet
cai, o tempo de resposta no celular e o custo de mexer no código depois.
