/**
 * folio-tts — Cloudflare Worker
 * ------------------------------------------------------------------
 * Stateless TTS proxy for Folio's audiobook feature.
 *
 * The worker does NOT store any API keys. Each request must include
 * the user's own API key for the requested provider. The worker simply
 * forwards the request to the provider and returns the audio, so that:
 *   (a) usage is billed to the user's own Google / ElevenLabs account
 *   (b) no shared quota / rate-limit coupling between users
 *   (c) the worker can be deployed from the Cloudflare dashboard with
 *       no secrets at all — only the ALLOWED_ORIGIN binding.
 *
 * Endpoints:
 *   GET  /                       Health check
 *   POST /google                 Google Cloud TTS → { audioContent: base64 }
 *                                Body: { text, voice, speakingRate, apiKey }
 *   POST /elevenlabs             ElevenLabs TTS  → raw MP3 binary
 *                                Body: { text, voiceId, apiKey, modelId? }
 *   GET  /voices/google?apiKey=… Neural2 + WaveNet en-* voices
 *   GET  /voices/elevenlabs?apiKey=… User's ElevenLabs voices
 *
 * Bindings (set in Cloudflare dashboard → Settings → Variables):
 *   ALLOWED_ORIGIN  Plain text var. Origin allowed to call this worker.
 *                   Defaults to https://folio.jacobsiler.com
 *
 * No secrets are required.
 *
 * Caller is responsible for chunking input text ≤ 4500 chars per /google call.
 */

const DEFAULT_ORIGIN = 'https://folio.jacobsiler.com';

/**
 * Parse ALLOWED_ORIGIN into an array of allowed origins.
 * The binding can be either a single origin or a comma-separated list:
 *   "https://folio.jacobsiler.com"
 *   "https://folio.jacobsiler.com, https://jacobdsiler.github.io, http://localhost:5173"
 * Entries are trimmed and empties dropped. The literal "*" disables the
 * allow-list entirely and echoes back whatever Origin the request supplied.
 */
function allowedOrigins(env) {
  const raw = (env && env.ALLOWED_ORIGIN) || DEFAULT_ORIGIN;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Pick the origin to echo back on Access-Control-Allow-Origin:
 *   - If the list contains "*", return the request Origin (or "*" if none).
 *   - If the request Origin is in the list, echo it back (exact match).
 *   - Otherwise fall back to the first configured origin. The browser will
 *     still block the response since it won't match the caller's Origin,
 *     which is the correct outcome.
 */
function pickOrigin(request, env) {
  const list = allowedOrigins(env);
  const reqOrigin = request.headers.get('Origin') || '';
  if (list.indexOf('*') !== -1) return reqOrigin || '*';
  if (reqOrigin && list.indexOf(reqOrigin) !== -1) return reqOrigin;
  return list[0] || DEFAULT_ORIGIN;
}

function corsHeaders(request, env, extra) {
  const h = {
    'Access-Control-Allow-Origin': pickOrigin(request, env),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (extra) for (const k in extra) h[k] = extra[k];
  return h;
}

function json(data, status, request, env) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: corsHeaders(request, env, { 'Content-Type': 'application/json' }),
  });
}

function errorJson(msg, status, request, env) {
  return json({ error: msg }, status || 500, request, env);
}

async function handleGoogleSynthesize(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorJson('Invalid JSON body', 400, request, env);
  }

  const text = (body && body.text) || '';
  const voice = (body && body.voice) || 'en-US-Neural2-F';
  const speakingRate = Number((body && body.speakingRate) || 1.0);
  const apiKey = (body && body.apiKey) || request.headers.get('X-API-Key') || '';

  if (!apiKey) return errorJson('Missing "apiKey" (Google Cloud TTS API key)', 400, request, env);
  if (!text || typeof text !== 'string') {
    return errorJson('Missing "text"', 400, request, env);
  }
  if (text.length > 4800) {
    return errorJson('Text too long for a single call (max 4500 chars)', 400, request, env);
  }

  // Language code is everything up through the second hyphen of the voice name.
  const m = voice.match(/^([a-z]{2}-[A-Z]{2})/);
  const languageCode = m ? m[1] : 'en-US';

  const payload = {
    input: { text },
    voice: { languageCode, name: voice },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: isFinite(speakingRate) ? speakingRate : 1.0,
    },
  };

  const url =
    'https://texttospeech.googleapis.com/v1/text:synthesize?key=' +
    encodeURIComponent(apiKey);

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    return errorJson(
      'Google TTS error: ' + resp.status + ' ' + txt.slice(0, 500),
      resp.status,
      request, env
    );
  }

  const data = await resp.json();
  return json({ audioContent: data.audioContent || '' }, 200, request, env);
}

async function handleElevenLabsSynthesize(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorJson('Invalid JSON body', 400, request, env);
  }

  const text = (body && body.text) || '';
  const voiceId = (body && body.voiceId) || '';
  const apiKey = (body && body.apiKey) || request.headers.get('X-API-Key') || '';
  const modelId = (body && body.modelId) || 'eleven_multilingual_v2';

  if (!text) return errorJson('Missing "text"', 400, request, env);
  if (!voiceId) return errorJson('Missing "voiceId"', 400, request, env);
  if (!apiKey) return errorJson('Missing "apiKey"', 400, request, env);

  const url =
    'https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voiceId);

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    return errorJson(
      'ElevenLabs error: ' + resp.status + ' ' + txt.slice(0, 500),
      resp.status,
      request, env
    );
  }

  return new Response(resp.body, {
    status: 200,
    headers: corsHeaders(request, env, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
    }),
  });
}

// Hardcoded fallback list, used when we can't list voices (no key, network blip, etc.)
const GOOGLE_VOICES = [
  { id: 'en-US-Neural2-F', label: 'Neural2 · Female (US)',   lang: 'en-US' },
  { id: 'en-US-Neural2-A', label: 'Neural2 · Male (US)',     lang: 'en-US' },
  { id: 'en-US-Neural2-C', label: 'Neural2 · Female 2 (US)', lang: 'en-US' },
  { id: 'en-US-Neural2-D', label: 'Neural2 · Male 2 (US)',   lang: 'en-US' },
  { id: 'en-GB-Neural2-A', label: 'Neural2 · Female (UK)',   lang: 'en-GB' },
  { id: 'en-GB-Neural2-B', label: 'Neural2 · Male (UK)',     lang: 'en-GB' },
  { id: 'en-AU-Neural2-A', label: 'Neural2 · Female (AU)',   lang: 'en-AU' },
  { id: 'en-AU-Neural2-B', label: 'Neural2 · Male (AU)',     lang: 'en-AU' },
];

async function handleGoogleVoices(request, env) {
  const url = new URL(request.url);
  const apiKey = url.searchParams.get('apiKey') || request.headers.get('X-API-Key') || '';
  if (!apiKey) {
    // No key — return the hardcoded set so the UI still has something to show.
    return json({ voices: GOOGLE_VOICES, dynamic: false }, 200, request, env);
  }
  try {
    const resp = await fetch(
      'https://texttospeech.googleapis.com/v1/voices?key=' + encodeURIComponent(apiKey)
    );
    if (!resp.ok) return json({ voices: GOOGLE_VOICES, dynamic: false }, 200, request, env);
    const data = await resp.json();
    const list = Array.isArray(data.voices) ? data.voices : [];
    const filtered = list
      .filter(v => {
        const n = v.name || '';
        const isEn = (v.languageCodes || []).some(lc => /^en[-_]/i.test(lc));
        const isGood = /Neural2|WaveNet/.test(n);
        return isEn && isGood;
      })
      .map(v => {
        const name = v.name;
        const lc = (v.languageCodes && v.languageCodes[0]) || 'en-US';
        const gender = (v.ssmlGender || '').toLowerCase();
        const kind = /Neural2/.test(name) ? 'Neural2' : 'WaveNet';
        const pretty =
          kind + ' · ' +
          (gender ? gender.charAt(0).toUpperCase() + gender.slice(1) : 'Voice') +
          ' (' + lc + ')';
        return { id: name, label: pretty, lang: lc };
      });
    filtered.sort((a, b) => {
      const aN = /Neural2/.test(a.id) ? 0 : 1;
      const bN = /Neural2/.test(b.id) ? 0 : 1;
      if (aN !== bN) return aN - bN;
      return a.id.localeCompare(b.id);
    });
    return json(
      { voices: filtered.length ? filtered : GOOGLE_VOICES, dynamic: filtered.length > 0 },
      200,
      request, env
    );
  } catch (e) {
    return json({ voices: GOOGLE_VOICES, dynamic: false }, 200, request, env);
  }
}

async function handleElevenLabsVoices(request, env) {
  const url = new URL(request.url);
  const apiKey = url.searchParams.get('apiKey') || request.headers.get('X-API-Key');
  if (!apiKey) return errorJson('Missing apiKey', 400, request, env);

  try {
    const resp = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
    });
    if (!resp.ok) {
      const txt = await resp.text();
      return errorJson(
        'ElevenLabs voices error: ' + resp.status + ' ' + txt.slice(0, 300),
        resp.status,
        request, env
      );
    }
    const data = await resp.json();
    const voices = Array.isArray(data.voices) ? data.voices : [];
    const mapped = voices.map(v => ({
      id: v.voice_id,
      label: v.name + (v.category ? ' · ' + v.category : ''),
      category: v.category || '',
      previewUrl: v.preview_url || '',
    }));
    return json({ voices: mapped }, 200, request, env);
  } catch (e) {
    return errorJson('ElevenLabs voices fetch failed: ' + e.message, 502, request, env);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/' || path === '') {
      return json(
        {
          ok: true,
          service: 'folio-tts',
          stateless: true,
          note: 'All requests require a user-supplied apiKey.',
          endpoints: [
            'POST /google          { text, voice, speakingRate, apiKey }',
            'POST /elevenlabs      { text, voiceId, apiKey, modelId? }',
            'GET  /voices/google?apiKey=…',
            'GET  /voices/elevenlabs?apiKey=…',
          ],
        },
        200,
        request, env
      );
    }

    if (path === '/google' && request.method === 'POST') {
      return handleGoogleSynthesize(request, env);
    }
    if (path === '/elevenlabs' && request.method === 'POST') {
      return handleElevenLabsSynthesize(request, env);
    }
    if (path === '/voices/google' && request.method === 'GET') {
      return handleGoogleVoices(request, env);
    }
    if (path === '/voices/elevenlabs' && request.method === 'GET') {
      return handleElevenLabsVoices(request, env);
    }

    return errorJson('Not found: ' + path, 404, request, env);
  },
};
