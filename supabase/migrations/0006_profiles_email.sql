-- =============================================================================
-- Controle360 — denormaliza e-mail em profiles
-- =============================================================================
-- Bug real encontrado em produção: o admin cria um vendedor, mas a tela
-- "Vendedores" sempre mostra "—" na coluna E-mail (src/api.js:listSellers()
-- nunca buscava e-mail — auth.users não é exposto via PostgREST para
-- authenticated). Sem conseguir conferir o e-mail salvo, o admin não percebe
-- quando o autopreenchimento do navegador altera o que foi digitado no
-- formulário de criação, e depois não consegue saber qual e-mail usar pra
-- logar como aquele vendedor.
--
-- Solução: guardar uma cópia do e-mail em `profiles` no momento da criação
-- (a Edge Function create-seller já roda com service role e conhece o
-- e-mail exato que foi de fato gravado no Auth). RLS de `profiles` já
-- restringe SELECT a "o próprio admin do negócio" ou "o próprio usuário"
-- (profiles_select_admin / profiles_select_own) — nenhuma policy nova é
-- necessária, a coluna herda a mesma proteção.
-- =============================================================================

alter table public.profiles add column if not exists email text;

-- Backfill dos vendedores/admins já existentes a partir de auth.users
-- (só roda aqui, com privilégio de owner da migração — nunca via cliente).
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id
  and p.email is null;
