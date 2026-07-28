-- =============================================================================
-- Controle360 - "patrocinio" como tipo proprio de saida sem venda.
--
-- Ate aqui, mercadoria dada como patrocinio (evento, influenciador, parceria)
-- so podia ser lancada como 'gift'. Isso funciona no estoque e no ledger, mas
-- apaga a diferenca no relatorio: brinde para fechar uma venda e patrocinio
-- de marketing sao decisoes diferentes, com donos diferentes, e o negocio
-- precisa ver as duas separadas para saber onde a mercadoria esta indo.
--
-- Mudanca minima e aditiva: so amplia o CHECK de operational_movements.type.
--
-- stock_movements NAO muda de proposito: quando a mercadoria sai do estoque
-- central, patrocinio continua gravando 'saida_brinde' — do ponto de vista do
-- estoque as duas saidas sao identicas (saiu sem venda, pelo custo medio). A
-- distincao entre brinde e patrocinio e uma informacao de negocio, e vive em
-- operational_movements.type, que e de onde o relatorio le.
--
-- Idem para seller_account_entries: patrocinio credita 'bonus_credit', o mesmo
-- de brinde — o efeito no saldo do vendedor e o mesmo.
-- =============================================================================

alter table public.operational_movements
  drop constraint if exists operational_movements_type_check,
  add constraint operational_movements_type_check
    check (type in ('return', 'waste', 'gift', 'sponsorship'));
