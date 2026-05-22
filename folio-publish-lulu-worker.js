/**
 * folio-publish-lulu — Cloudflare Worker
 * ------------------------------------------------------------------
 * Print-on-demand bridge between Folio and the Lulu API. The browser
 * cannot call Lulu directly (no CORS, and the client-credentials
 * secret must stay server-side), so this worker:
 *   • mints + caches a Lulu OAuth token,
 *   • GET  /cost   — print-job cost estimate,
 *   • GET  /token  — short-lived Lulu token so the browser can upload
 *                    the interior PDF straight to Lulu,
 *   • POST /job    — create a Lulu print job from a hosted PDF URL,
 *   • GET  /job/:id — job status,
 *   • GET  /        — health check, GET /debug — auth probe.
 *
 * Variables (Cloudflare dashboard → Settings → Variables & Secrets):
 *   LULU_CLIENT_ID      (Secret)
 *   LULU_CLIENT_SECRET  (Secret)
 *   LULU_SANDBOX        "true" / "false"
 *   ALLOWED_ORIGIN      Plain text. CSV accepted, e.g.
 *                       "https://www.onfolio.press, https://onfolio.press"
 *                       Defaults to https://www.onfolio.press when unset.
 *
 * CORS: this worker uses an allow-list that ECHOES the caller's
 * Origin back when it matches, instead of hardcoding a single domain.
 * A future domain change is then just an ALLOWED_ORIGIN edit — no
 * code change — and multiple origins (www + apex + localhost) work
 * at once. (Matches the folio-paywall / folio-tts workers.)
 *
 * Shipping level: NOT hardcoded. The caller chooses (MAIL,
 * PRIORITY_MAIL, GROUND, EXPEDITED, EXPRESS) — /cost takes a
 * ?shipping= query param, /job takes a shipping_level body field.
 * Both default to MAIL. MAIL is cheapest but is not offered for
 * every destination; when Lulu rejects it the author can pick
 * another level instead of being stuck.
 */

const LULU_BASE         = 'https://api.lulu.com';
const LULU_SANDBOX_BASE = 'https://api.sandbox.lulu.com';
const TOKEN_PATH        = '/auth/realms/glasstree/protocol/openid-connect/token';
const DEFAULT_ORIGIN    = 'https://www.onfolio.press';

const PAPER_THICKNESS = { white: 0.00225, cream: 0.00245 };
const POD_PACKAGES    = {
  'bw-white-60': '0600X0900.BW.STD.PB.060UW444.MXX',
  'bw-cream-60': '0600X0900.BW.STD.PB.060UC444.MXX',
};

// Dummy addresses per country for cost estimation
const COUNTRY_ADDRESSES = {
  IE: { street1: '1 Main Street',       city: 'Dublin',    postcode: 'D01 F5P2',  phone_number: '+353 1 555 0100' },
  GB: { street1: '1 High Street',       city: 'London',    postcode: 'SW1A 1AA',  phone_number: '+44 20 7946 0100' },
  US: { street1: '1 Main Street',       city: 'New York',  postcode: '10001',     phone_number: '+1 212 555 0100', state_code: 'NY' },
  CA: { street1: '1 Main Street',       city: 'Toronto',   postcode: 'M5H 2N2',   phone_number: '+1 416 555 0100', state_code: 'ON' },
  AU: { street1: '1 George Street',     city: 'Sydney',    postcode: '2000',      phone_number: '+61 2 5550 0100', state_code: 'NSW' },
  DE: { street1: 'Hauptstraße 1',       city: 'Berlin',    postcode: '10115',     phone_number: '+49 30 555 0100' },
  FR: { street1: '1 Rue de Rivoli',     city: 'Paris',     postcode: '75001',     phone_number: '+33 1 55 50 0100' },
  NL: { street1: 'Damrak 1',            city: 'Amsterdam', postcode: '1012 LG',   phone_number: '+31 20 555 0100' },
  ES: { street1: 'Calle Mayor 1',       city: 'Madrid',    postcode: '28013',     phone_number: '+34 91 555 0100' },
  IT: { street1: 'Via Roma 1',          city: 'Rome',      postcode: '00184',     phone_number: '+39 06 555 0100' },
  JP: { street1: '1 Chiyoda',           city: 'Tokyo',     postcode: '100-0001',  phone_number: '+81 3 5550 0100' },
  BR: { street1: 'Rua da Consolação 1', city: 'São Paulo', postcode: '01301-000', phone_number: '+55 11 5550 0100', state_code: 'SP' },
};
const DEFAULT_ADDRESS = COUNTRY_ADDRESSES.IE;

let _token = null, _tokenExpiry = 0;

async function getToken(env) {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const base = env.LULU_SANDBOX === 'true' ? LULU_SANDBOX_BASE : LULU_BASE;
  const credentials = btoa(`${env.LULU_CLIENT_ID}:${env.LULU_CLIENT_SECRET}`);
  const res = await fetch(base + TOKEN_PATH, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     env.LULU_CLIENT_ID,
      client_secret: env.LULU_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Auth failed ${res.status}: ${await res.text()}`);
  const d = await res.json();
  _token = d.access_token;
  _tokenExpiry = Date.now() + (d.expires_in - 60) * 1000;
  return _token;
}

/* ── CORS — allow-list that echoes a valid caller origin ───────── */
function allowedOrigins(env) {
  const raw = (env && env.ALLOWED_ORIGIN) || DEFAULT_ORIGIN;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}
function pickOrigin(request, env) {
  const list = allowedOrigins(env);
  const reqOrigin = (request && request.headers.get('Origin')) || '';
  if (list.indexOf('*') !== -1) return reqOrigin || '*';
  if (reqOrigin && list.indexOf(reqOrigin) !== -1) return reqOrigin;
  return list[0] || DEFAULT_ORIGIN;
}
function corsHeaders(request, env) {
  return {
    'Access-Control-Allow-Origin':  pickOrigin(request, env),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age':       '86400',
    'Vary':                         'Origin',
  };
}
const respond = (data, status, request, env) =>
  new Response(JSON.stringify(data, null, 2), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
  });
const fail = (msg, status, request, env) => respond({ error: msg }, status || 400, request, env);

// GET / — health check
function handleRoot(request, env) {
  return respond({
    status: 'ok', worker: 'folio-publish-lulu',
    sandbox: env.LULU_SANDBOX === 'true',
    endpoints: [
      'GET  /cost?pages=N&paper=white&quantity=1&country=IE&shipping=MAIL',
      'POST /job    — body: { source_url, metadata, shipping, quantity, shipping_level }',
      'GET  /job/:id',
    ],
  }, 200, request, env);
}

// GET /debug
async function handleDebug(req, env) {
  let tokenStatus = 'not tested';
  try { await getToken(env); tokenStatus = 'OK'; }
  catch(e) { tokenStatus = 'FAILED: ' + e.message; }
  return respond({
    token_auth: tokenStatus,
    sandbox: env.LULU_SANDBOX === 'true',
    base_url: env.LULU_SANDBOX === 'true' ? LULU_SANDBOX_BASE : LULU_BASE,
    has_client_id: !!env.LULU_CLIENT_ID,
    has_client_secret: !!env.LULU_CLIENT_SECRET,
  }, 200, req, env);
}

// GET /cost
async function handleCost(req, env) {
  const u       = new URL(req.url);
  const pages   = parseInt(u.searchParams.get('pages') || '0');
  const paper   = u.searchParams.get('paper') || 'white';
  const qty     = parseInt(u.searchParams.get('quantity') || '1');
  const country = (u.searchParams.get('country') || 'IE').toUpperCase();
  const shipLevel = (u.searchParams.get('shipping') || 'MAIL').toUpperCase();
  if (pages < 24) return fail('pages must be >= 24', 400, req, env);

  const addr = COUNTRY_ADDRESSES[country] || DEFAULT_ADDRESS;
  const pkg  = POD_PACKAGES[`bw-${paper}-60`] || POD_PACKAGES['bw-white-60'];
  const base = env.LULU_SANDBOX === 'true' ? LULU_SANDBOX_BASE : LULU_BASE;
  const tok  = await getToken(env);

  const res = await fetch(base + '/print-job-cost-calculations/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      line_items: [{ page_count: pages, pod_package_id: pkg, quantity: qty }],
      shipping_address: { country_code: country, ...addr },
      shipping_option: shipLevel,
    }),
  });
  if (!res.ok) return fail(`Cost calc failed: ${await res.text()}`, 502, req, env);
  const d = await res.json();

  const item    = (d.line_items || [])[0] || {};
  const spineIn = ((pages / 2) * (PAPER_THICKNESS[paper] || 0.00225)).toFixed(3); // Lulu: sheets

  return respond({
    unit_price:       item.unit_price,
    cost_ex_shipping: item.total_cost_excl_tax,
    shipping_cost:    d.shipping_cost,
    total_cost:       d.total_cost_incl_tax,
    currency:         d.currency || 'USD',
    shipping_level:   shipLevel,
    spine_inches:     spineIn,
    spine_note:       parseFloat(spineIn) < 0.25
      ? 'Spine too narrow for text (< 0.25 in)'
      : `Spine width: ${spineIn} in — text will fit`,
    pod_package_id:   pkg,
    pages, quantity: qty,
    sandbox: env.LULU_SANDBOX === 'true',
  }, 200, req, env);
}

// GET /token — returns a short-lived bearer token so the browser can
// upload the PDF directly to Lulu (avoids routing a large blob through the worker)
async function handleGetToken(request, env) {
  const tok  = await getToken(env);
  const base = env.LULU_SANDBOX === 'true' ? LULU_SANDBOX_BASE : LULU_BASE;
  return respond({
    access_token:  tok,
    upload_url:    base + '/files/',
    expires_in:    300, // caller should treat as short-lived
    sandbox:       env.LULU_SANDBOX === 'true',
  }, 200, request, env);
}

// POST /job — body JSON: { source_url, metadata, shipping, quantity, shipping_level }
// source_url is a publicly accessible PDF URL (e.g. Firebase Storage download URL)
async function handleJob(req, env) {
  let body;
  try { body = await req.json(); }
  catch { return fail('Expected JSON body', 400, req, env); }

  const { source_url, cover_source_url, metadata: meta = {}, shipping = {}, quantity = 1, shipping_level } = body;

  if (!source_url)    return fail('source_url required', 400, req, env);
  if (!meta.title)    return fail('metadata.title required', 400, req, env);
  if (!shipping.name) return fail('shipping.name required', 400, req, env);

  const pkg  = POD_PACKAGES[`bw-${meta.paper || 'white'}-60`] || POD_PACKAGES['bw-white-60'];
  const base = env.LULU_SANDBOX === 'true' ? LULU_SANDBOX_BASE : LULU_BASE;
  const tok  = await getToken(env);

  const jobRes = await fetch(base + '/print-jobs/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contact_email: meta.email || 'orders@onfolio.press',
      external_id:   `folio-${Date.now()}`,
      shipping_address: {
        name:         shipping.name,
        street1:      shipping.street1,
        street2:      shipping.street2 || '',
        city:         shipping.city,
        state_code:   shipping.state_code || '',
        country_code: shipping.country_code || 'IE',
        postcode:     shipping.postcode,
        phone_number: shipping.phone || '',
      },
      shipping_option_level: (shipping_level || 'MAIL'),
      line_items: [{
        title:          meta.title,
        quantity:        parseInt(quantity),
        pod_package_id: pkg,
        interior:       { source_url: source_url },
        cover:          { source_url: cover_source_url || null },
      }],
    }),
  });

  if (!jobRes.ok) return fail(`Job creation failed: ${await jobRes.text()}`, 502, req, env);
  const job = await jobRes.json();

  return respond({
    job_id:   job.id,
    status:   job.status,
    lulu_url: 'https://developers.lulu.com/print-jobs', // Developer portal — where API jobs are paid for
    sandbox:  env.LULU_SANDBOX === 'true',
  }, 201, req, env);
}

// GET /job/:id
async function handleJobStatus(id, req, env) {
  const base = env.LULU_SANDBOX === 'true' ? LULU_SANDBOX_BASE : LULU_BASE;
  const tok  = await getToken(env);
  const res  = await fetch(`${base}/print-jobs/${id}/`, {
    headers: { Authorization: `Bearer ${tok}` },
  });
  if (!res.ok) return fail(`Job ${id} not found`, res.status, req, env);
  const d = await res.json();
  return respond({ job_id: d.id, status: d.status }, 200, req, env);
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: corsHeaders(req, env) });

    const path = new URL(req.url).pathname.replace(/\/$/, '') || '/';

    try {
      if (path === '/')                              return handleRoot(req, env);
      if (path === '/debug')                         return await handleDebug(req, env);
      if (req.method === 'GET'  && path === '/cost') return await handleCost(req, env);
      if (req.method === 'GET'  && path === '/token')return await handleGetToken(req, env);
      if (req.method === 'POST' && path === '/job')  return await handleJob(req, env);
      if (req.method === 'GET'  && path.startsWith('/job/'))
        return await handleJobStatus(path.slice(5), req, env);
      return fail('Not found', 404, req, env);
    } catch (e) {
      console.error('Worker error:', e);
      return fail(e.message || 'Internal server error', 500, req, env);
    }
  },
};
