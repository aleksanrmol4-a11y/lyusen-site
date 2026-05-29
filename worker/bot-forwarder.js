/**
 * Cloudflare Worker для бота @Alexander_marketing_bot
 *
 * РОУТИНГ:
 *   POST /           — webhook Telegram (сообщения боту пересылаются админу)
 *   POST /lead       — приём заявки с формы сайта (фронт стучит сюда, Worker шлёт в Telegram)
 *   OPTIONS /lead    — CORS preflight
 *   GET /            — healthcheck
 *
 * Решает проблему: api.telegram.org заблокирован в РФ без VPN. Раньше форма ходила напрямую,
 * с российских IP не работало. Теперь форма стучит на Worker (Cloudflare CDN не блокируется),
 * а Worker уже сам идёт в Telegram с серверной стороны.
 *
 * Дополнительный плюс: токен бота больше не в публичном JS, а только в env Worker'а.
 *
 * Env vars:
 *   - BOT_TOKEN: токен бота от @BotFather
 *   - ADMIN_CHAT_ID: chat_id админа куда пересылать (666070596)
 *   - SECRET_TOKEN: секрет для верификации webhook от Telegram (X-Telegram-Bot-Api-Secret-Token)
 */

// CORS: открыт для всех Origin'ов. Защита от спама — honeypot-поле и валидация payload.
// Так нет рисков что какой-то Origin отвалится из-за whitelist.
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type, X-Lyusen-Source, Accept',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const origin = request.headers.get('Origin') || '';

    // ─── CORS preflight ───
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // ─── GET /lead?p=base64 — резервный канал (img-hack для обхода блокировок POST) ───
    if (request.method === 'GET' && path === '/lead') {
      return handleLeadGet(request, env, origin);
    }

    // ─── Healthcheck ───
    if (request.method === 'GET') {
      return new Response('OK — Lyusen bot forwarder. POST /lead для заявок, POST / для Telegram webhook.', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    // ─── Заявка с формы сайта ───
    if (request.method === 'POST' && path === '/lead') {
      return handleLead(request, env, origin);
    }

    // ─── Webhook от Telegram (по умолчанию) ───
    if (request.method === 'POST') {
      return handleTelegramWebhook(request, env);
    }

    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders(origin) });
  }
};

// ═══════════════════════════════════════════════════════════
// ─── GET /lead?p=base64payload — резервный канал (img-hack) ───
// ═══════════════════════════════════════════════════════════
// Простой GET не требует CORS preflight и не блокируется большинством корпоративных
// фильтров. Используется когда POST /lead зафейлился. Возвращает 1×1 прозрачный gif,
// чтобы можно было дергать через <img src=...>.
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
      '🔥 *Заявка через GET fallback*\n' +
      '_Источник: img-hack (POST не прошёл)_\n\n' +
      '👤 *Имя:* ' + escapeMd(name) + '\n' +
      '📱 *Контакт:* ' + escapeMd(contact) + '\n\n' +
      '💬 *Запрос:*\n' + escapeMd(message);

    // Шлём параллельно в TG и VK — но не ждём результата, сразу возвращаем gif
    // чтобы img загрузился у клиента без задержки.
    request.waitUntil = request.waitUntil || ((p) => p);
    Promise.all([
      tgSendMessage(env, env.ADMIN_CHAT_ID, text),
      vkSendIfConfigured(env, text)
    ]).catch((e) => console.error('GET /lead send error:', e));
  } catch (e) {
    console.error('GET /lead parse error:', e);
  }
  return gifResp();
}

// ═══════════════════════════════════════════════════════════
// ─── Обработчик заявки с формы (POST /lead) ───
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

  // ─── Honeypot против ботов: поле website должно быть пустым ───
  if (payload.website) {
    // Тихо отвечаем "ok" чтобы спам-бот не понял что попался
    return json(200, { ok: true });
  }

  const name = (payload.name || '').toString().trim().slice(0, 200);
  const contact = (payload.contact || '').toString().trim().slice(0, 200);
  const message = (payload.message || '').toString().trim().slice(0, 4000);
  const source = (payload.source || 'web').toString().trim().slice(0, 40);

  if (!name || !contact || !message) {
    return json(400, { ok: false, error: 'missing_fields' });
  }

  const text =
    '🔥 *Новая заявка с сайта Люсъен*\n' +
    '_Источник: ' + escapeMd(source) + '_\n\n' +
    '👤 *Имя:* ' + escapeMd(name) + '\n' +
    '📱 *Контакт:* ' + escapeMd(contact) + '\n\n' +
    '💬 *Запрос:*\n' + escapeMd(message);

  try {
    const tg = await tgSendMessage(env, env.ADMIN_CHAT_ID, text);
    const tgJson = await tg.json();
    if (!tgJson.ok) {
      console.error('TG error:', tgJson);
      // Если Telegram упал — пробуем VK. Хоть какой-то канал доставки.
      const vkOk = await vkSendIfConfigured(env, text);
      if (vkOk) return json(200, { ok: true, channel: 'vk' });
      return json(502, { ok: false, error: 'telegram_failed' });
    }
    // Параллельно дублируем в VK (если настроено) — для надёжности
    await vkSendIfConfigured(env, text);
    return json(200, { ok: true });
  } catch (err) {
    console.error('Worker error:', err);
    return json(500, { ok: false, error: 'server_error' });
  }
}

// ─── VK дублирование ───
// VK API работает в РФ без блокировок. Если в env заданы VK_GROUP_TOKEN и VK_PEER_ID,
// заявка дополнительно уходит в VK-сообщение (например, в личку группы или диалог менеджера).
// Без этих переменных — функция тихо ничего не делает.
async function vkSendIfConfigured(env, text) {
  if (!env.VK_GROUP_TOKEN || !env.VK_PEER_ID) return false;
  try {
    const params = new URLSearchParams({
      access_token: env.VK_GROUP_TOKEN,
      v: '5.199',
      peer_id: String(env.VK_PEER_ID),
      message: text.replace(/\*/g, '').replace(/_/g, '').replace(/`/g, ''), // VK не поддерживает Markdown
      random_id: String(Math.floor(Math.random() * 1e9)),
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

// ═══════════════════════════════════════════════════════════
// ─── Webhook Telegram (POST /, секрет в заголовке) ───
// ═══════════════════════════════════════════════════════════
async function handleTelegramWebhook(request, env) {
  // Верификация что POST реально от Telegram
  const secretHeader = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (env.SECRET_TOKEN && secretHeader !== env.SECRET_TOKEN) {
    return new Response('Forbidden', { status: 403 });
  }

  let update;
  try { update = await request.json(); } catch { return new Response('Bad request', { status: 400 }); }
  const msg = update.message;
  if (!msg) return new Response('OK');

  const from = msg.from || {};
  const chatId = msg.chat.id;
  const isFromAdmin = String(chatId) === String(env.ADMIN_CHAT_ID);

  // ─── /start [payload] ───
  // Если форма на сайте не смогла достучаться до Worker'а напрямую,
  // она открывает бот через deep link https://t.me/bot?start=<base64url>
  // где payload = base64url(JSON({n,c,m})). Распаковываем и админу.
  if (msg.text && msg.text.indexOf('/start') === 0) {
    const arg = msg.text.replace(/^\/start\s*/, '').trim();
    if (arg) {
      try {
        const b64 = arg.replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
        const decoded = decodeURIComponent(escape(atob(padded)));
        const data = JSON.parse(decoded);
        const name = (data.n || '').toString().trim().slice(0, 200);
        const contact = (data.c || '').toString().trim().slice(0, 200);
        const message = (data.m || '').toString().trim().slice(0, 4000);
        if (name && contact && message) {
          // Подтверждаем отправителю что заявка принята
          await tgSendMessage(env, chatId,
            '✅ Спасибо, ' + escapeMd(name) + '! Заявка получена.\n\n' +
            'Александр свяжется с вами в течение дня. ' +
            'Если хотите добавить что-то к заявке — просто напишите следующим сообщением.'
          );
          // Шлём админу
          const adminText =
            '🔥 *Заявка через TG fallback*\n' +
            '_Источник: deep link (форма не дошла до Worker)_\n\n' +
            '👤 *Имя:* ' + escapeMd(name) + '\n' +
            '📱 *Контакт:* ' + escapeMd(contact) + '\n\n' +
            '💬 *Запрос:*\n' + escapeMd(message) + '\n\n' +
            '🆔 Telegram ID отправителя: `' + (from.id || '?') + '`';
          const replyMarkup = from.id ? {
            inline_keyboard: [[{ text: '💬 Ответить в Telegram', url: 'tg://user?id=' + from.id }]]
          } : undefined;
          await tgSendMessage(env, env.ADMIN_CHAT_ID, adminText, replyMarkup);
          // Параллельно — VK дублирование
          await vkSendIfConfigured(env, adminText);
          return new Response('OK');
        }
      } catch (_) { /* битый payload — упадём на обычный /start */ }
    }
    // Обычный /start без payload
    await tgSendMessage(env, chatId,
      '👋 Здравствуйте! Это бот агентства *Люсъен*.\n\n' +
      'Напишите ваш вопрос — Александр Молчанов, основатель агентства, ответит лично в течение дня.\n\n' +
      'Или сразу опишите задачу:\n' +
      '• какой у вас бизнес\n' +
      '• какая задача (продвижение / реклама / сайт / контент)\n' +
      '• какой бюджет на маркетинг в месяц\n\n' +
      '🌐 [Сайт агентства](https://lyusen18.ru/)'
    );
    return new Response('OK');
  }

  if (isFromAdmin) {
    await tgSendMessage(env, chatId,
      'ℹ️ Это бот для приёма заявок. Когда вам кто-то напишет — сообщение прилетит сюда. ' +
      'Чтобы ответить — откройте профиль клиента (ссылка `tg://user?id=...` в каждой пересылке).'
    );
    return new Response('OK');
  }

  const senderName = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'без имени';
  const senderUsername = from.username ? '@' + from.username : '_username не указан_';
  const senderId = from.id;
  const text = msg.text || '_[не текст — фото/видео/файл, см. оригинал ниже]_';

  const forwardText =
    '💬 *Новое сообщение боту*\n\n' +
    '👤 *От:* ' + escapeMd(senderName) + '\n' +
    '🔗 *Username:* ' + senderUsername + '\n' +
    '🆔 *ID:* `' + senderId + '`\n\n' +
    '📝 *Сообщение:*\n' + escapeMd(text);

  const replyMarkup = {
    inline_keyboard: [[{ text: '💬 Ответить в Telegram', url: 'tg://user?id=' + senderId }]]
  };

  await tgSendMessage(env, env.ADMIN_CHAT_ID, forwardText, replyMarkup);

  if (!msg.text) {
    await tgForwardMessage(env, env.ADMIN_CHAT_ID, chatId, msg.message_id);
  }

  await tgSendMessage(env, chatId,
    '✅ Спасибо, ваше сообщение принято. Александр свяжется с вами в течение дня.'
  );

  return new Response('OK');
}

// ═══════════════════════════════════════════════════════════
// ─── helpers ───
// ═══════════════════════════════════════════════════════════
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
