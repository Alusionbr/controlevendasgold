# Controle360 — Replication & Implementation Pack v1

Pacote para outra IA entender o projeto Controle360, replicar a arquitetura e implementar a próxima fase com segurança.

Este pacote cobre:

- estrutura atual do projeto;
- separação entre Administrador e Vendedor;
- UX mobile;
- pedidos de reposição à vista, consignado e misto;
- dívida do vendedor com pagamentos fracionados;
- aprovação de pedido com ajuste/parcial;
- devoluções com status;
- desperdícios;
- brindes;
- drafts de Supabase/migrations futuras;
- prompts para Claude/Codex;
- tickets pequenos de implementação;
- checklist de teste.

## Regra central do produto

> Vendedor só vê ferramentas úteis para vender, atender cliente, controlar o próprio estoque, acompanhar pedidos/dívidas próprios e bater meta.

## Regra central do estoque/financeiro

> Produto entregue ao vendedor pode gerar estoque do vendedor e, dependendo da forma de pagamento, débito do vendedor com o administrador.

## Regra central de devolução

> “A devolver” não volta para o estoque nem quita dívida. Só “Devolvido/Conferido” impacta estoque e financeiro.

## Importante

Este pacote inclui **drafts** de banco. Não aplicar migrations automaticamente sem revisão humana.
