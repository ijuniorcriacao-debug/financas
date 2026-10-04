// Lê uma foto ou PDF (fatura, extrato, cupom, comprovante) e devolve os gastos encontrados.
// Segredos (Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY  (obrigatório)  chave da API da Anthropic
//   ALLOWED_EMAILS     (recomendado)  e-mails que podem usar, separados por vírgula
//   AI_MODEL           (opcional)     padrão: claude-haiku-4-5
import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const ORIGINS = ['https://ijuniorcriacao-debug.github.io'];
const DAILY_LIMIT = 40;
const MAX_B64 = 9_000_000; // ~6,7 MB de arquivo
const IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const corsHeaders = (req: Request) => {
  const o = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
};
const reply = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== 'POST') return reply(req, 405, { error: 'method' });

  // 1) quem está chamando? (login obrigatório)
  const auth = req.headers.get('Authorization') ?? '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY') ?? req.headers.get('apikey') ?? '', {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user }, error: uerr } = await sb.auth.getUser();
  if (uerr || !user) return reply(req, 401, { error: 'unauthorized' });

  // 2) só os e-mails permitidos, e só quem já pertence a uma casa
  const allowed = (Deno.env.get('ALLOWED_EMAILS') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes((user.email ?? '').toLowerCase())) return reply(req, 403, { error: 'not_allowed' });
  const { data: member } = await sb.from('members').select('user_id').maybeSingle();
  if (!member) return reply(req, 403, { error: 'not_member' });

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return reply(req, 503, { error: 'ai_not_configured' });

  // 3) entrada
  let body: { mime?: string; data?: string; today?: string; cats?: { id: string; name: string }[] };
  try { body = await req.json(); } catch { return reply(req, 400, { error: 'bad_json' }); }
  const { mime = '', data = '', today = '' } = body;
  const isPdf = mime === 'application/pdf';
  if (!isPdf && !IMAGES.includes(mime)) return reply(req, 400, { error: 'bad_type' });
  if (!data || data.length > MAX_B64) return reply(req, 413, { error: 'too_big' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return reply(req, 400, { error: 'bad_today' });
  const cats = (body.cats ?? []).filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string').slice(0, 40);
  if (!cats.length) return reply(req, 400, { error: 'no_cats' });
  const catIds = cats.map((c) => c.id);

  // 4) limite diário por pessoa (protege o custo)
  const { data: okQuota, error: qerr } = await sb.rpc('take_ai_quota', { p_limit: DAILY_LIMIT });
  if (qerr) return reply(req, 500, { error: 'quota_error' });
  if (okQuota === false) return reply(req, 429, { error: 'quota' });

  const tool = {
    name: 'registrar_gastos',
    description: 'Registra os gastos (saídas de dinheiro) encontrados no documento.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tipo: { type: 'string', enum: ['fatura', 'extrato', 'cupom', 'comprovante', 'outro'] },
        itens: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              data: { type: 'string', description: 'Data da compra no formato AAAA-MM-DD' },
              descricao: { type: 'string', description: 'Estabelecimento ou descrição curta' },
              valor: { type: 'number', description: 'Valor em reais, positivo, com ponto decimal' },
              categoria: { type: 'string', enum: catIds },
            },
            required: ['data', 'descricao', 'valor', 'categoria'],
          },
        },
      },
      required: ['tipo', 'itens'],
    },
  };

  const system = `Você extrai gastos de documentos financeiros brasileiros (fatura de cartão, extrato bancário, cupom fiscal, comprovante de Pix ou de pagamento).
Hoje é ${today}. Responda SOMENTE chamando a ferramenta registrar_gastos.
Regras:
- Inclua apenas saídas de dinheiro (compras, débitos, Pix enviados, pagamentos de contas). Ignore pagamentos de fatura, estornos, créditos, saldos, totais, rendimentos e entradas.
- Cupom fiscal ou nota: um único item com o nome do estabelecimento e o valor TOTAL pago (não liste cada produto).
- Comprovante: um item com o favorecido e o valor.
- Fatura ou extrato: um item por linha de compra/débito. Em compras parceladas mantenha "3/10" na descrição e use o valor da parcela.
- Se a data não tiver ano, use o ano mais provável sem passar de hoje. Se não houver data legível, use ${today}.
- Valor sempre positivo, em reais (ex.: 59.9). Se o documento estiver ilegível ou não tiver gastos, devolva a lista de itens vazia.
Categorias disponíveis (escolha o id mais adequado, ou o de "Outros"):
${cats.map((c) => `- ${c.id}: ${c.name}`).join('\n')}`;

  const block = isPdf
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: mime as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data } };

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: Deno.env.get('AI_MODEL') ?? 'claude-haiku-4-5',
      max_tokens: 8000,
      system,
      tools: [tool],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: [block, { type: 'text', text: 'Extraia os gastos deste documento chamando registrar_gastos.' }] }],
    });
    const use = msg.content.find((b) => b.type === 'tool_use');
    if (!use || use.type !== 'tool_use') return reply(req, 502, { error: 'ai_no_result' });
    const raw = use.input as { tipo?: string; itens?: Array<{ data?: string; descricao?: string; valor?: number; categoria?: string }> };
    const fallback = catIds.includes('outros') ? 'outros' : catIds[0];
    const itens = (raw.itens ?? []).slice(0, 300).flatMap((i) => {
      const valor = Number(i.valor);
      if (!Number.isFinite(valor) || valor <= 0 || valor > 1_000_000) return [];
      const d = /^\d{4}-\d{2}-\d{2}$/.test(i.data ?? '') ? i.data! : today;
      return [{ data: d, descricao: String(i.descricao ?? '').trim().slice(0, 80) || 'Sem descrição', valor: Math.round(valor * 100) / 100, categoria: catIds.includes(i.categoria ?? '') ? i.categoria! : fallback }];
    });
    return reply(req, 200, { tipo: raw.tipo ?? 'outro', itens });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401 || status === 403) return reply(req, 502, { error: 'ai_key_invalid' });
    if (status === 429 || status === 529) return reply(req, 503, { error: 'ai_busy' });
    console.error('anthropic error', status, (e as Error).message);
    return reply(req, 502, { error: 'ai_error' });
  }
});
