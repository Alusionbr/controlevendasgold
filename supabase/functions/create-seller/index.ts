// Controle360 — criação de vendedor e redefinição de senha pelo administrador.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';

const WEB_ORIGIN = 'https://alusionbr.github.io';
const LOCAL_FILE_ORIGIN = 'null';
const TECHNICAL_EMAIL_DOMAIN = 'example.com';
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

function corsHeadersFor(req: Request): Record<string, string> {
  const requestOrigin = req.headers.get('Origin');
  const allowedOrigin = requestOrigin === LOCAL_FILE_ORIGIN ? LOCAL_FILE_ORIGIN : WEB_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function jsonResponse(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeUsername(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function technicalEmail(username: string): string {
  return `c360.${username}@${TECHNICAL_EMAIL_DOMAIN}`;
}

interface SellerPayload {
  action?: 'create' | 'reset-password';
  username?: string;
  password?: string;
  name?: string;
  sellerId?: string;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);
  const respond = (body: unknown, status = 200) => jsonResponse(body, status, corsHeaders);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return respond({ error: 'Método não suportado. Use POST.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return respond({ error: 'Configuração do servidor incompleta.' }, 500);

  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return respond({ error: 'Cabeçalho Authorization com Bearer token é obrigatório.' }, 401);
  }
  const callerJwt = authHeader.slice(7).trim();
  if (!callerJwt) return respond({ error: 'Token de autenticação vazio.' }, 401);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: callerData, error: callerError } = await adminClient.auth.getUser(callerJwt);
  if (callerError || !callerData?.user) return respond({ error: 'Token inválido ou expirado.' }, 401);

  const { data: callerProfile, error: profileError } = await adminClient
    .from('profiles')
    .select('id, role, active, business_id')
    .eq('id', callerData.user.id)
    .maybeSingle();
  if (profileError) return respond({ error: 'Erro ao verificar permissões do usuário.' }, 500);
  if (!callerProfile || callerProfile.role !== 'admin' || !callerProfile.active) {
    return respond({ error: 'Apenas administradores ativos podem gerenciar vendedores.' }, 403);
  }
  if (!callerProfile.business_id) return respond({ error: 'Administrador sem negócio vinculado.' }, 400);

  let payload: SellerPayload;
  try {
    payload = await req.json();
  } catch {
    return respond({ error: 'Corpo da requisição precisa ser JSON válido.' }, 400);
  }

  const action = payload.action || 'create';
  const password = String(payload.password || '');
  if (password.length < 8) return respond({ error: 'A senha precisa ter ao menos 8 caracteres.' }, 400);

  if (action === 'reset-password') {
    const sellerId = String(payload.sellerId || '').trim();
    const username = normalizeUsername(payload.username);
    if (!sellerId) return respond({ error: 'Vendedor não informado.' }, 400);
    if (!USERNAME_PATTERN.test(username)) {
      return respond({ error: 'Defina um usuário válido antes de redefinir a senha.' }, 400);
    }

    const { data: seller, error: sellerError } = await adminClient
      .from('profiles')
      .select('id, role, active, business_id, username, email')
      .eq('id', sellerId)
      .eq('business_id', callerProfile.business_id)
      .maybeSingle();
    if (sellerError) return respond({ error: 'Erro ao localizar o vendedor.' }, 500);
    if (!seller || seller.role !== 'vendedor') return respond({ error: 'Vendedor não encontrado.' }, 404);

    const { data: duplicate, error: duplicateError } = await adminClient
      .from('profiles')
      .select('id')
      .eq('username', username)
      .neq('id', seller.id)
      .maybeSingle();
    if (duplicateError) return respond({ error: 'Erro ao validar o usuário.' }, 500);
    if (duplicate) return respond({ error: 'Este usuário já está em uso.' }, 409);

    const email = technicalEmail(username);
    const { error: updateError } = await adminClient.auth.admin.updateUserById(seller.id, {
      email,
      password,
      email_confirm: true,
    });
    if (updateError) return respond({ error: 'Não foi possível atualizar o acesso do vendedor.' }, 500);

    const { error: profileUpdateError } = await adminClient
      .from('profiles')
      .update({ username, email })
      .eq('id', seller.id);
    if (profileUpdateError) {
      if (seller.email) {
        await adminClient.auth.admin.updateUserById(seller.id, { email: seller.email, email_confirm: true });
      }
      return respond({ error: 'Não foi possível atualizar o perfil do vendedor.' }, 500);
    }
    return respond({ id: seller.id, username, password_reset: true });
  }

  if (action !== 'create') return respond({ error: 'Ação inválida.' }, 400);

  const username = normalizeUsername(payload.username);
  const name = String(payload.name || '').trim();
  if (!USERNAME_PATTERN.test(username)) {
    return respond({ error: 'Usuário deve ter de 3 a 32 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.' }, 400);
  }
  if (!name) return respond({ error: 'Nome do vendedor é obrigatório.' }, 400);

  const { data: duplicate, error: duplicateError } = await adminClient
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (duplicateError) return respond({ error: 'Erro ao validar o usuário.' }, 500);
  if (duplicate) return respond({ error: 'Este usuário já está em uso.' }, 409);

  const email = technicalEmail(username);
  const { data: createdUser, error: createUserError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (createUserError || !createdUser?.user) {
    const message = createUserError?.message || 'Erro ao criar usuário.';
    const status = /already registered|already exists/i.test(message) ? 409 : 400;
    return respond({ error: status === 409 ? 'Este usuário já está em uso.' : message }, status);
  }

  const newUserId = createdUser.user.id;
  const { error: insertProfileError } = await adminClient.from('profiles').insert({
    id: newUserId,
    role: 'vendedor',
    name,
    username,
    email,
    business_id: callerProfile.business_id,
    active: true,
  });
  if (insertProfileError) {
    await adminClient.auth.admin.deleteUser(newUserId);
    return respond({ error: 'Erro ao criar o perfil do vendedor.' }, 500);
  }

  return respond({
    id: newUserId,
    username,
    name,
    role: 'vendedor',
    business_id: callerProfile.business_id,
  }, 201);
});