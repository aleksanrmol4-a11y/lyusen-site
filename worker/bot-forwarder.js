/**
 * Cloudflare Worker для сайта Люсъен.
 *
 * РОУТИНГ:
 *   POST /lead       — приём заявки с формы. Шлёт в VK (messages.send) + Telegram админу.
 *   GET  /lead?p=... — резервный канал через img-hack. Распаковывает base64 payload и шлёт в VK + TG.
 *   POST /           — webhook от Telegram. Пересылает админу всё что пишут боту + дублирует в VK.
 *   OPTIONS /lead    — CORS preflight (открыт для всех).
 *   GET  /           — healthcheck.
 *
 * Env vars:
 *   - VK_GROUP_TOKEN: токен сообщества VK
 *   - VK_PEER_ID:     peer_id куда слать в VK
 *   - BOT_TOKEN:      токен Telegram-бота
 *   - ADMIN_CHAT_ID:  chat_id админа в Telegram
 *   - SECRET_TOKEN:   секрет для верификации webhook
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

    // POST / — webhook от Telegram
    if (request.method === 'POST' && (path === '/' || path === '')) {
      return handleTelegramWebhook(request, env);
    }

    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders(origin) });
  }
};

// ═══════════════════════════════════════════════════════════
// Telegram webhook — пересылка сообщений боту админу
// ═══════════════════════════════════════════════════════════
async function handleTelegramWebhook(request, env) {
  // Верификация что POST реально от Telegram
  if (env.SECRET_TOKEN) {
    const sec = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (sec !== env.SECRET_TOKEN) return new Response('Forbidden', { status: 403 });
  }

  let update;
  try { update = await request.json(); } catch { return new Response('Bad request', { status: 400 }); }

  const msg = update.message;
  if (!msg) return new Response('OK');

  const from = msg.from || {};
  const chatId = msg.chat.id;
  const isFromAdmin = String(chatId) === String(env.ADMIN_CHAT_ID);

  // /start с возможным payload (deep link)
  if (msg.text && msg.text.indexOf('/start') === 0) {
    const arg = msg.text.replace(/^\/start\s*/, '').trim();
    if (arg) {
      // Deep link с заявкой
      try {
        const b64 = arg.replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
        const data = JSON.parse(decodeURIComponent(escape(atob(padded))));
        const name = (data.n || '').toString().trim().slice(0, 200);
        const contact = (data.c || '').toString().trim().slice(0, 200);
        const message = (data.m || '').toString().trim().slice(0, 4000);
        if (name && contact && message) {
          await tgSendMessage(env, chatId,
            '✅ Спасибо! Заявка получена. Александр свяжется с вами в течение дня.\n\n' +
            'Если хотите добавить что-то — просто напишите следующим сообщением.'
          );
          const adminText =
            '🔥 *Заявка через Telegram deep link*\n\n' +
            '👤 *Имя:* ' + escapeMd(name) + '\n' +
            '📱 *Контакт:* ' + escapeMd(contact) + '\n\n' +
            '💬 *Запрос:*\n' + escapeMd(message) + '\n\n' +
            '🆔 TG: `' + (from.id || '?') + '`';
          await tgSendMessage(env, env.ADMIN_CHAT_ID, adminText,
            from.id ? { inline_keyboard: [[{ text: '💬 Ответить', url: 'tg://user?id=' + from.id }]] } : undefined);
          await vkSend(env, '🔥 Заявка через TG deep link\n\n👤 ' + name + '\n📱 ' + contact + '\n\n💬 ' + message);
          return new Response('OK');
        }
      } catch (_) {}
    }
    // Обычный /start
    await tgSendMessage(env, chatId,
      '👋 Здравствуйте! Это бот агентства *Люсъен*.\n\n' +
      'Напишите ваш вопрос — Александр Молчанов, основатель агентства, ответит лично в течение дня.\n\n' +
      'Опишите задачу: какой у вас бизнес, какая задача (продвижение / реклама / сайт / контент), какой бюджет.\n\n' +
      '🌐 [Сайт агентства](https://lyusen18.ru/)'
    );
    return new Response('OK');
  }

  // Сообщение от админа боту — не пересылаем, просто отвечаем подсказкой
  if (isFromAdmin) {
    await tgSendMessage(env, chatId,
      'ℹ️ Это бот для приёма обращений с сайта. Когда вам кто-то напишет — пересылка прилетит сюда. Чтобы ответить — откройте профиль клиента по ссылке `tg://user?id=...` в каждой пересылке.'
    );
    return new Response('OK');
  }

  // Пересылка обычного сообщения админу
  const senderName = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'без имени';
  const senderUsername = from.username ? '@' + from.username : '_username не указан_';
  const senderId = from.id;
  const text = msg.text || '_[фото/видео/файл — см. оригинал ниже]_';

  const forwardText =
    '💬 *Новое сообщение боту*\n\n' +
    '👤 *От:* ' + escapeMd(senderName) + '\n' +
    '🔗 *Username:* ' + senderUsername + '\n' +
    '🆔 *ID:* `' + senderId + '`\n\n' +
    '📝 *Сообщение:*\n' + escapeMd(text);

  await tgSendMessage(env, env.ADMIN_CHAT_ID, forwardText,
    { inline_keyboard: [[{ text: '💬 Ответить в Telegram', url: 'tg://user?id=' + senderId }]] }
  );

  // Дублирование в VK
  await vkSend(env, '💬 Новое сообщение боту\n\n👤 ' + senderName + ' ' + senderUsername + '\n🆔 ' + senderId + '\n\n📝 ' + text);

  // Если медиа — пересылаем оригинал
  if (!msg.text) {
    await tgForwardMessage(env, env.ADMIN_CHAT_ID, chatId, msg.message_id);
  }

  // Подтверждение отправителю
  await tgSendMessage(env, chatId,
    '✅ Спасибо, ваше сообщение принято. Александр свяжется с вами в течение дня.'
  );

  return new Response('OK');
}

async function tgSendMessage(env, chatId, text, replyMarkup) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function tgForwardMessage(env, toChatId, fromChatId, messageId) {
  return fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/forwardMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: toChatId, from_chat_id: fromChatId, message_id: messageId })
  });
}

function escapeMd(s) {
  return String(s).replace(/[_*`\[\]()]/g, m => '\\' + m);
}

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
    // Шлём параллельно в VK и Telegram
    const [vkOk, tgOk] = await Promise.all([
      vkSend(env, text),
      tgSendMessage(env, env.ADMIN_CHAT_ID, '🔥 *Заявка с сайта Люсъен*\n_Источник: ' + escapeMd(source) + '_\n\n👤 *Имя:* ' + escapeMd(name) + '\n📱 *Контакт:* ' + escapeMd(contact) + '\n\n💬 *Запрос:*\n' + escapeMd(message)).then(r => r.ok).catch(() => false)
    ]);
    if (!vkOk && !tgOk) return json(502, { ok: false, error: 'all_channels_failed' });
    return json(200, { ok: true, vk: vkOk, tg: tgOk });
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
    Promise.all([
      vkSend(env, text),
      tgSendMessage(env, env.ADMIN_CHAT_ID, '🔥 *Заявка через GET fallback (img-hack)*\n\n👤 *Имя:* ' + escapeMd(name) + '\n📱 *Контакт:* ' + escapeMd(contact) + '\n\n💬 *Запрос:*\n' + escapeMd(message))
    ]).catch((e) => console.error('GET /lead send error:', e));
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
