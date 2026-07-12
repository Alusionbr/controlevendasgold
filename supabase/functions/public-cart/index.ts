// =============================================================================
// Controle360 - Edge Function: public-cart
// =============================================================================
// Permite que um cliente sem login consulte um carrinho compartilhado e envie
// dados de contato + comprovante de pagamento. A funcao valida o token
// expiravel e usa service role somente no servidor.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGIN = '*';
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function cleanText(value: FormDataEntryValue | null, max = 160): string {
  return String(value || '').trim().slice(0, max);
}

function extensionForType(type: string): string {
  if (type === 'application/pdf') return 'pdf';
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ error: 'Configuracao do servidor incompleta.' }, 500);
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('token') || '';
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return jsonResponse({ error: 'Link invalido.' }, 400);
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: lookup, error: lookupError } = await adminClient.rpc('public_cart_lookup', { token });
  if (lookupError) {
    console.error('public-cart: lookup error', lookupError);
    return jsonResponse({ error: 'Erro ao abrir carrinho.' }, 500);
  }
  if (!lookup) {
    return jsonResponse({ error: 'Carrinho expirado ou indisponivel.' }, 404);
  }

  if (req.method === 'GET') {
    return jsonResponse(lookup);
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metodo nao suportado.' }, 405);
  }

  // O link pode continuar consultavel depois do envio para exibir o status,
  // mas os dados do cliente/comprovante so podem ser enviados uma vez.
  if (lookup.cart.status !== 'shared') {
    return jsonResponse({ error: 'Este carrinho ja foi enviado.' }, 409);
  }

  const form = await req.formData().catch(() => null);
  if (!form) return jsonResponse({ error: 'Envie os dados como formulario.' }, 400);

  const name = cleanText(form.get('customer_name'), 120);
  const phone = cleanText(form.get('customer_phone'), 60);
  const notes = cleanText(form.get('customer_notes'), 500);
  const proof = form.get('payment_proof');

  if (!name) return jsonResponse({ error: 'Informe o nome do cliente.' }, 400);

  let proofPath: string | null = null;
  const cartId = lookup.cart.id;

  if (proof instanceof File && proof.size > 0) {
    if (proof.size > MAX_FILE_BYTES) {
      return jsonResponse({ error: 'Comprovante muito grande. Limite: 8 MB.' }, 400);
    }
    if (!ALLOWED_TYPES.has(proof.type)) {
      return jsonResponse({ error: 'Comprovante deve ser imagem JPG/PNG/WebP ou PDF.' }, 400);
    }
    const ext = extensionForType(proof.type);
    proofPath = `${cartId}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await adminClient.storage
      .from('payment-proofs')
      .upload(proofPath, proof, { contentType: proof.type, upsert: false });

    if (uploadError) {
      console.error('public-cart: upload error', uploadError);
      return jsonResponse({ error: 'Nao foi possivel salvar o comprovante.' }, 500);
    }
  }

  const nextStatus = lookup.cart.source === 'admin_stock' ? 'pending_approval' : 'submitted';
  const patch: Record<string, unknown> = {
    customer_name: name,
    customer_phone: phone || null,
    customer_notes: notes || null,
    submitted_at: new Date().toISOString(),
    status: nextStatus,
  };
  if (proofPath) patch.payment_proof_path = proofPath;

  const { data: updatedCart, error: updateError } = await adminClient
    .from('sale_carts')
    .update(patch)
    .eq('id', cartId)
    .eq('status', 'shared')
    .select('id')
    .maybeSingle();

  if (updateError) {
    console.error('public-cart: update error', updateError);
    return jsonResponse({ error: 'Nao foi possivel enviar o carrinho.' }, 500);
  }

  // Protege contra dois POSTs simultaneos. Apenas o primeiro muda o status;
  // o segundo nao encontra uma linha ainda em `shared`. Se ele ja tiver feito
  // upload, remove o arquivo orfao antes de responder conflito.
  if (!updatedCart) {
    if (proofPath) {
      await adminClient.storage.from('payment-proofs').remove([proofPath]).catch((cleanupError) => {
        console.error('public-cart: falha removendo comprovante de envio duplicado', cleanupError);
      });
    }
    return jsonResponse({ error: 'Este carrinho ja foi enviado.' }, 409);
  }

  return jsonResponse({
    ok: true,
    status: nextStatus,
    message: nextStatus === 'pending_approval'
      ? 'Pedido enviado e aguardando aprovacao.'
      : 'Pedido enviado ao vendedor.',
  });
});

