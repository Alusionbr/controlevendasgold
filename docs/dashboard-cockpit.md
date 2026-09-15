# Dashboard administrativo — cockpit de foco

Esta etapa substitui a composição administrativa da tela **Hoje** por um cockpit de baixo ruído. Ela não altera banco, regras financeiras nem fluxos das demais telas.

## Fontes reais

`Calc.dashboardCockpit` lê apenas coleções já carregadas no estado:

- recebíveis e contas a pagar: `financialEntries`, usando o saldo `amount - paidAmount`;
- lucro reconhecido: `recognizedRevenue`, no regime de caixa e pelas datas do ledger da Etapa 1;
- estoque baixo e custo ausente: `products`;
- pagamentos de vendedor para conferir: `sellerPaymentReports`;
- aprovações: `orders`;
- operações pendentes: `operationalMovements`;
- tarefas: `tasks`, incluindo `createdAt`, `dueDate` e `status` existentes.

O algoritmo ordena sinais por uma pontuação fixa e testada. Apenas os três primeiros alertas urgentes viram prioridades. Alertas adicionais ficam em **Outros alertas** e somente itens de baixa urgência entram em **Pode esperar**. Se houver menos de três alertas, os espaços restantes dizem que nenhuma prioridade adicional foi detectada; não são criadas tarefas fictícias.

## Limitações honestas

- `tasks` não possui campo de prioridade. A interface só mostra prioridade se esse campo vier a existir no registro; nenhuma migration foi criada.
- Não existe uma conta de caixa/banco nem saldo inicial no modelo atual. Por isso **Saldo disponível** aparece como **Não informado** em vez de calcular um falso saldo por entradas menos saídas.
- Movimentos de estoque não registram autor nem saldo anterior/posterior. Esses campos aparecem como **não informado** na rastreabilidade; notas existentes são usadas como motivo.

## Modo foco e acessibilidade

O modo foco mantém o cabeçalho, as três prioridades e o resumo financeiro. Atalhos, tarefas, alertas secundários, itens que podem esperar, rastreabilidade e painéis complementares são ocultados até o usuário sair do modo.

Todos os controles são botões ou inputs nativos, o estado do modo usa `aria-pressed`, os títulos têm associação por `aria-labelledby`, mensagens de carregamento usam `role=status` e falhas usam `role=alert`. O layout foi verificado em desktop e em viewport móvel de 390 × 844 px.
