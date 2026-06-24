// Supabase Edge Function — purge-expired-ctpat-data
// Elimina filas de registros_ctpat con expires_at vencido (solo BD).
// Invocar vía pg_cron HTTP, Supabase Scheduled Functions o cron externo.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-purge-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

function isAuthorized(req: Request): boolean {
  const purgeSecret = Deno.env.get('PURGE_CRON_SECRET')?.trim();
  if (purgeSecret) {
    const header = req.headers.get('X-Purge-Secret')?.trim();
    return header === purgeSecret;
  }
  const auth = req.headers.get('Authorization')?.trim() ?? '';
  return auth === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  const { data, error } = await supabase.rpc('purge_expired_ctpat_registros');

  if (error) {
    console.error('[purge-expired-ctpat-data]', error.message);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  const deleted = typeof data === 'number' ? data : Number(data ?? 0);
  console.log('[purge-expired-ctpat-data] filas eliminadas:', deleted);

  return new Response(JSON.stringify({ ok: true, deleted }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
});
