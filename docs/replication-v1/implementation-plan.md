# Controle360 — Plano de Implementação

## Fase 0 — Documentação

- Criar pasta `docs/replication-v1`.
- Registrar regras de domínio.
- Registrar UX por perfil.
- Registrar schema futuro em draft.

## Fase 1 — UX por perfil sem banco novo

- Bottom navigation admin/vendedor.
- Menu Mais por perfil.
- Tela Hoje por perfil.
- Cards mobile.
- Sem mexer em Supabase.

## Fase 2 — Pedido de reposição melhorado

- Pedido com `payment_mode`.
- Entrada/valor pago inicial.
- Aprovado x solicitado.
- Aprovação com ajuste.
- Aprovação parcial.

Usar estruturas existentes sempre que possível: `sale_carts`, `sale_cart_items`, `orders`.

## Fase 3 — Dívida do vendedor

- Criar ledger.
- Criar pagamentos fracionados.
- Saldo do vendedor.
- Admin recebe pagamento.
- Vendedor vê saldo simples.

## Fase 4 — Devoluções, desperdícios e brindes

- Criar movimentos operacionais.
- Status de devolução.
- Baixa de desperdício.
- Baixa de brinde.
- Abatimento financeiro apenas quando aplicável.

## Fase 5 — Relatórios

- saldo por vendedor;
- pedidos em aberto;
- devoluções pendentes;
- desperdício por período;
- brindes por responsável;
- estoque em trânsito.

## Fase 6 — Segurança Supabase

- revisar RLS;
- revisar functions;
- revisar índices;
- revisar performance.

## Contrato para agentes de IA

### Papel do Claude

Claude deve ser orquestrador:

- ler documentação;
- dividir tarefas;
- revisar riscos;
- validar consistência;
- escrever prompts de execução;
- impedir mudanças grandes demais.

### Papel do Codex

Codex deve ser executor:

- implementar tarefas pequenas;
- modificar poucos arquivos por PR;
- testar;
- reportar riscos.

## Proibido

- reescrever o app inteiro;
- trocar stack;
- criar framework;
- colocar service role no frontend;
- misturar lógica admin/vendedor;
- expor ferramentas de admin para vendedor;
- aplicar migrations sem revisão.

## Sempre fazer

- preservar `src/app.js` e renderizadores atuais;
- reaproveitar `TAB_ROLES`;
- criar nova camada incremental;
- manter desktop funcionando;
- testar admin e vendedor.
