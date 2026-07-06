# Supabase — Controle360

Este diretório contém tudo que define o backend Supabase do Controle360:

```txt
supabase/
├── config.toml                       # stub mínimo (ver comentários no arquivo)
├── migrations/
│   └── 0001_init.sql                 # schema completo + RLS + triggers
├── functions/
│   └── create-seller/index.ts        # Edge Function: admin cria vendedor
└── README.md                          # este arquivo
```

## O que já foi feito (por este agente, "backend")

Só **arquivos**. Nenhum comando de MCP do Supabase foi executado a partir
daqui — nenhuma migração foi aplicada em projeto nenhum, nenhuma função foi
publicada. Este agente não tem (nem deveria ter) acesso a um projeto Supabase
real.

A migração `0001_init.sql` foi validada localmente (Postgres 16 solto, fora
do Supabase) para garantir que:

- roda do zero sem erro;
- é reexecutável (`create table if not exists`, `drop trigger/policy if
  exists` + recriação) — rodar duas vezes seguidas não quebra;
- as policies de RLS realmente isolam vendedor de vendedor, escondem
  `suppliers`/`purchases`/`stock_movements`/custos de produto do vendedor, e
  liberam tudo para o admin dentro do próprio negócio;
- o trigger de piso de preço bloqueia venda abaixo do piso e libera venda no
  piso exato ou acima;
- o trigger de aprovação de pedido impede vendedor de criar pedido
  pré-aprovado ou de aprovar/rejeitar um pedido;
- o trigger de guarda de perfil impede vendedor de virar admin sozinho.

Um bug real de recursão de RLS (`stack depth limit exceeded` em
`is_admin()`/`my_business_id()`) e um bug real de bypass de trigger via
`SECURITY DEFINER` foram encontrados e corrigidos durante essa validação —
ver comentários extensos no próprio SQL (seção 4 e função
`is_privileged_role()`).

## O que falta (papel do orquestrador)

1. **Aplicar a migração no projeto real**, via MCP do Supabase:
   `apply_migration` com o conteúdo de `migrations/0001_init.sql`.
2. **Publicar a Edge Function**, via MCP: `deploy_edge_function` apontando
   para `functions/create-seller/index.ts`.
3. **Configurar os secrets da função** (`SUPABASE_URL` e
   `SUPABASE_SERVICE_ROLE_KEY`) — no Supabase gerenciado, essas duas variáveis
   já ficam disponíveis automaticamente para toda Edge Function do projeto;
   confirmar que é o caso também neste ambiente antes de assumir que "já
   funciona".
4. **Preencher `__SUPABASE_URL__` e `__SUPABASE_ANON_KEY__`** em
   `src/api.js` (arquivo que outro agente frontend vai criar) com os valores
   reais do projeto — usar `get_project_url` e `get_publishable_keys` do MCP.
5. **Bootstrap do primeiro admin + primeiro negócio.** Esta migração **não**
   cria um admin nem um `business` automaticamente (ver
   `docs/backend.md`, seção "Gaps conhecidos"). É preciso, uma vez:
   - criar o usuário admin no Supabase Auth (painel ou
     `auth.admin.createUser` via um script com service role);
   - inserir manualmente a linha em `businesses` (`owner_id` = id desse
     usuário) e a linha em `profiles` (`role='admin'`, `business_id` = id
     dessa business) — nessa ordem, ou com `business_id` nulo no profile
     inicialmente e um UPDATE depois, para não esbarrar na FK circular
     (ver comentário na seção 2 do SQL).
6. Depois disso, o fluxo normal passa a ser: admin loga, cria vendedores pela
   tela (que chama a Edge Function `create-seller`), cadastra produtos,
   define `seller_prices`/`seller_stock` por vendedor.

## Convenção de nomes

Tabelas e colunas no banco são `snake_case`. O app front-end trabalha em
`camelCase`. O mapeamento completo está em `docs/backend.md`.
