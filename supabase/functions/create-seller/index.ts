// =============================================================================
// Controle360 — Edge Function: create-seller
// =============================================================================
// Cria um novo vendedor (usuário Supabase Auth + linha em `profiles`) para o
// negócio do admin autenticado que chama esta função.
//
// Fluxo:
//   1. Lê o JWT do header `Authorization: Bearer <token>` (o token do ADMIN
//      que está logado no app, enviado pelo cliente com a anon key).
//   2. Usa esse JWT para descobrir quem é o chamador (`auth.getUser`) e
//      confere na tabela `profiles` que ele é `role = 'admin'` e `active`.
//   3. Se for admin, usa a SERVICE ROLE KEY (nunca exposta ao navegador) para:
//      a) criar o usuário no Supabase Auth já com e-mail confirmado;
//      b) inserir a linha em `profiles` com role='vendedor', o mesmo
//         business_id do admin chamador, active=true.
//   4. Responde com { id, email } do novo vendedor.
//
// Variáveis de ambiente necessárias (configuradas no projeto Supabase, NÃO no
// código-fonte):
//   SUPABASE_URL              -> URL do projeto (https://xxxx.supabase.co)
//   SUPABASE_SERVICE_ROLE_KEY -> chave de service role (bypassa RLS; secreta,
//                                 nunca deve chegar ao navegador/cliente)
// Estas duas variáveis já existem automaticamente em toda Edge Function
// publicada no Supabase (não é preciso configurar manualmente na maioria dos
// casos), mas deixamos explícito aqui pois a função depende delas.
//
// CORS: o app é servido via GitHub Pages (origem estática, ex.:
// https://usuario.github.io). Por simplicidade inicial liberamos qualquer
// origem (`*`). TODO: restringir ao domínio real do GitHub Pages assim que
// ele for definido, trocando `*` por essa origem exata em ALLOWED_ORIGIN.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// TODO: restringir para o domínio real do GitHub Pages, ex.:
// const ALLOWED_ORIGIN = 'https://SEU_USUARIO.github.io';
const ALLOWED_ORIGIN = '*';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface CreateSellerPayload {
  email?: string;
  password?: string;
  name?: string;
}

Deno.serve(async (req: Request) => {
  // Preflight CORS.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Método não suportado. Use POST.' }, 405);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('create-seller: variáveis de ambiente ausentes (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
    return jsonResponse({ error: 'Configuração do servidor incompleta.' }, 500);
  }

  // ---------------------------------------------------------------------
  // 1) Identifica o chamador a partir do JWT enviado pelo cliente.
  // ---------------------------------------------------------------------
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return jsonResponse({ error: 'Cabeçalho Authorization com Bearer token é obrigatório.' }, 401);
  }
  const callerJwt = authHeader.slice(7).trim();
  if (!callerJwt) {
    return jsonResponse({ error: 'Token de autenticação vazio.' }, 401);
  }

  // Cliente com SERVICE ROLE, usado tanto para validar o JWT do chamador
  // (auth.getUser aceita um token explícito e o valida contra o servidor de
  // Auth independentemente dos headers do cliente) quanto para as operações
  // administrativas de criação do vendedor.
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: callerData, error: callerError } = await adminClient.auth.getUser(callerJwt);
  if (callerError || !callerData?.user) {
    return jsonResponse({ error: 'Token inválido ou expirado.' }, 401);
  }
  const callerId = callerData.user.id;

  // ---------------------------------------------------------------------
  // 2) Lê o profile do chamador (via service role, ignorando RLS de
  //    propósito aqui, pois já validamos a identidade acima) para confirmar
  //    que é admin ativo e para descobrir o business_id do vendedor novo.
  // ---------------------------------------------------------------------
  const { data: callerProfile, error: profileError } = await adminClient
    .from('profiles')
    .select('id, role, active, business_id')
    .eq('id', callerId)
    .maybeSingle();

  if (profileError) {
    console.error('create-seller: erro lendo profile do chamador', profileError);
    return jsonResponse({ error: 'Erro ao verificar permissões do usuário.' }, 500);
  }
  if (!callerProfile || callerProfile.role !== 'admin' || !callerProfile.active) {
    return jsonResponse({ error: 'Apenas administradores ativos podem criar vendedores.' }, 403);
  }
  if (!callerProfile.business_id) {
    return jsonResponse({ error: 'Este admin ainda não está vinculado a um negócio (business_id nulo).' }, 400);
  }

  // ---------------------------------------------------------------------
  // 3) Valida o payload.
  // ---------------------------------------------------------------------
  let payload: CreateSellerPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Corpo da requisição precisa ser JSON válido.' }, 400);
  }

  const email = (payload.email || '').trim().toLowerCase();
  const password = payload.password || '';
  const name = (payload.name || '').trim();

  if (!email || !email.includes('@')) {
    return jsonResponse({ error: 'E-mail inválido.' }, 400);
  }
  if (!password || password.length < 6) {
    return jsonResponse({ error: 'Senha precisa ter ao menos 6 caracteres.' }, 400);
  }
  if (!name) {
    return jsonResponse({ error: 'Nome do vendedor é obrigatório.' }, 400);
  }

  // ---------------------------------------------------------------------
  // 4) Cria o usuário de Auth (e-mail já confirmado, sem precisar de convite
  //    por e-mail) usando a service role.
  // ---------------------------------------------------------------------
  const { data: createdUser, error: createUserError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });

  if (createUserError || !createdUser?.user) {
    console.error('create-seller: erro criando usuário de auth', createUserError);
    const message = createUserError?.message || 'Erro ao criar usuário.';
    const status = /already registered|already exists/i.test(message) ? 409 : 400;
    return jsonResponse({ error: message }, status);
  }

  const newUserId = createdUser.user.id;

  // ---------------------------------------------------------------------
  // 5) Insere a linha de profile (role='vendedor', mesmo business_id do
  //    admin chamador). Se falhar, tenta desfazer a criação do usuário de
  //    Auth para não deixar um usuário "órfão" sem profile.
  // ---------------------------------------------------------------------
  const { error: insertProfileError } = await adminClient.from('profiles').insert({
    id: newUserId,
    role: 'vendedor',
    name,
    business_id: callerProfile.business_id,
    active: true,
  });

  if (insertProfileError) {
    console.error('create-seller: erro inserindo profile, desfazendo criação do usuário', insertProfileError);
    await adminClient.auth.admin.deleteUser(newUserId).catch((cleanupError) => {
      console.error('create-seller: falha ao desfazer criação do usuário órfão', cleanupError);
    });
    return jsonResponse({ error: 'Erro ao criar o perfil do vendedor.' }, 500);
  }

  return jsonResponse({
    id: newUserId,
    email,
    name,
    role: 'vendedor',
    business_id: callerProfile.business_id,
  }, 201);
});
