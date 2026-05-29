/**
 * Cloudflare Worker для сайта Люсъен — VK-only режим.
 *
 * РОУТИНГ:
 *   POST /lead       — приём заявки с формы. Шлёт в VK (messages.send) и возвращает {ok}.
 *   GET  /lead?p=... — резервный канал через img-hack. Распаковывает base64 payload и шлёт в VK.
 *   OPTIONS /lead    — CORS preflight (открыт для всех).
 *   GET  /           — healthcheck.
 *
 * Env vars:
 *   - VK_GROUP_TOKEN: токен сообщества VK (vk1.a....)
 *   - VK_PEER_ID:     peer_id куда слать (user_id админа, которому сообщество может писать)
 */

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // GET /lead?p=... — резервный img-канал
    if (request.method === 'GET' && path === '/lead') {
      return handleLeadGet(request, env, origin);
    }

    // Healthcheck
    if (request.method === 'GET') {
      return new Response('OK — Lyusen lead forwarder (VK-only). POST /lead для заявок.', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    // POST /lead — заявка с формы
    if (request.method === 'POST' && path === '/lead') {
      return handleLead(request, env, origin);
    }

    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders(origin) });
  }
};

// ═══════════════════════════════════════════════════════════
// POST /lead — основной путь
// ═══════════════════════════════════════════════════════════
async function handleLead(request, env, origin) {
  const cors = corsHeaders(origin);
  const json = (status, body) => new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' }
  });

  let payload;
  try { payload = await request.json(); }
  catch { return json(400, { ok: false, error: 'bad_json' }); }

  // Honeypot: поле website должно быть пустым. Бот его заполнит — тихо игнорируем.
  if (payload.website) return json(200, { ok: true });

  const name = (payload.name || '').toString().trim().slice(0, 200);
  const contact = (payload.contact || '').toString().trim().slice(0, 200);
  const message = (payload.message || '').toString().trim().slice(0, 4000);
  const source = (payload.source || 'web').toString().trim().slice(0, 40);

  if (!name || !contact || !message) {
    return json(400, { ok: false, error: 'missing_fields' });
  }

  const text =
    '🔥 Новая заявка с сайта Люсъен\n' +
    'Источник: ' + source + '\n\n' +
    '👤 Имя: ' + name + '\n' +
    '📱 Контакт: ' + contact + '\n\n' +
    '💬 Запрос:\n' + message;

  try {
    const ok = await vkSend(env, text);
    if (!ok) return json(502, { ok: false, error: 'vk_failed' });
    return json(200, { ok: true });
  } catch (err) {
    console.error('Worker error:', err);
    return json(500, { ok: false, error: 'server_error' });
  }
}

// ═══════════════════════════════════════════════════════════
// GET /lead?p=base64 — img-hack для обхода блокировок POST
// ═══════════════════════════════════════════════════════════
async function handleLeadGet(request, env, origin) {
  const url = new URL(request.url);
  const p = url.searchParams.get('p');
  // Прозрачный 1×1 GIF
  const gif = new Uint8Array([
    0x47,0x49,0x46,0x38,0x39,0x61, 0x01,0x00,0x01,0x00, 0x80,0x00,0x00,
    0xff,0xff,0xff, 0x00,0x00,0x00,
    0x21,0xf9,0x04, 0x01,0x00,0x00,0x00,0x00,
    0x2c, 0x00,0x00,0x00,0x00, 0x01,0x00,0x01,0x00, 0x00, 0x02,0x02, 0x44,0x01, 0x00,0x3b
  ]);
  const gifResp = () => new Response(gif, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': origin || '*'
    }
  });

  if (!p) return gifResp();

  try {
    const b64 = p.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
    const decoded = decodeURIComponent(escape(atob(padded)));
    const data = JSON.parse(decoded);
    const name = (data.n || '').toString().trim().slice(0, 200);
    const contact = (data.c || '').toString().trim().slice(0, 200);
    const message = (data.m || '').toString().trim().slice(0, 4000);
    if (!name || !contact || !message) return gifResp();

    const text =
      '🔥 Заявка через GET fallback (img-hack)\n\n' +
      '👤 Имя: ' + name + '\n' +
      '📱 Контакт: ' + contact + '\n\n' +
      '💬 Запрос:\n' + message;

    // Не ждём результата отправки — сразу возвращаем gif, чтобы img загрузился без задержки
    vkSend(env, text).catch((e) => console.error('GET /lead VK error:', e));
  } catch (e) {
    console.error('GET /lead parse error:', e);
  }
  return gifResp();
}

// ═══════════════════════════════════════════════════════════
// VK messages.send — единственный канал доставки
// ═══════════════════════════════════════════════════════════
async function vkSend(env, text) {
  if (!env.VK_GROUP_TOKEN || !env.VK_PEER_ID) {
    console.error('VK env not configured: VK_GROUP_TOKEN, VK_PEER_ID required');
    return false;
  }
  try {
    const params = new URLSearchParams({
      access_token: env.VK_GROUP_TOKEN,
      v: '5.199',
      peer_id: String(env.VK_PEER_ID),
      message: text,
      random_id: String(Math.floor(Math.random() * 2147483647)),
      dont_parse_links: '1'
    });
    const res = await fetch('https://api.vk.com/method/messages.send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    const j = await res.json().catch(() => ({}));
    if (j.error) {
      console.error('VK error:', j.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('VK send failed:', err);
    return false;
  }
}
