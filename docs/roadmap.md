# Roadmap

## Versão atual

Multiusuário com Supabase Auth + Postgres + RLS (papéis admin/vendedor);
`localStorage` agora é só cache espelho, não fonte de verdade. Ver
`docs/backend.md` e a seção "Atualização: multiusuário" em `CLAUDE.md`.

## Concluído na integração multiusuário

1. Login/logout e papéis (admin/vendedor) com portão de autenticação.
2. Gestão de vendedores (criar/desativar) pelo admin.
3. Preço padrão/piso por produto e por vendedor, com validação client-side
   no formulário de venda.
4. Devolução e desperdício por venda.
5. Estoque próprio do vendedor -> consignado, e aprovação de pedidos.
6. Metas de vendas semanais/mensais com premiação.
7. Calculadora e central de ajuda do vendedor.
8. Aba Negócios virou edição do negócio já vinculado à conta (nome,
   segmento, margens padrão) em vez de criar/excluir — não há policy de
   INSERT/DELETE para `businesses` (bootstrap é manual, 1 negócio por conta).
9. Ajuste manual de estoque (produto físico), com motivo obrigatório,
   gerando `stock_movements` tipo `ajuste_manual`.

## Pendências abertas desta integração (ver CLAUDE.md para detalhes)

1. Deploy da Edge Function `create-seller` (bloqueada por permissão) —
   confirmar se já está publicada no projeto Supabase em uso antes de
   liberar a criação de vendedores pela aba Vendedores.

## Próxima versão recomendada

1. Botão de edição para produtos, clientes, fornecedores, pedidos e tarefas.
2. Venda com múltiplos itens.
3. Pedido com múltiplos itens.
4. Relatório financeiro simples:
   - a receber;
   - a pagar;
   - lucro por período;
   - margem por produto.
5. Exportação CSV.
6. Filtro por data.
7. Busca nas tabelas.

## Versão profissional local

1. IndexedDB no navegador para maior volume.
2. Migração de schema.
3. Histórico de edição/auditoria.
4. Lotes e validade.
5. Impressão de pedido/romaneio.
6. Backup automático em arquivo.

## Versão com servidor

1. SQLite ou PostgreSQL.
2. Login.
3. Multiusuário.
4. Permissões.
5. Dashboard web.
6. Integração com WhatsApp/planilhas.

## Aplicativo

1. PWA instalável.
2. App iOS/Android via wrapper.
3. Sincronização em nuvem.

## Concluído nesta versão

1. Exportação completa para Excel (.xlsx), uma aba por módulo.
2. Importação de Excel (.xlsx), inclusive planilha editada à mão.
3. Exportação CSV por módulo.
4. Backup/restauração JSON com configurações.
5. Interface revisada (cabeçalho fixo, abas roláveis, cartões, avisos/toasts).

Itens ainda abertos do roadmap original seguem válidos (edição de registros com auditoria, ajuste manual de estoque, multi-item, contas a pagar/receber, IndexedDB).
