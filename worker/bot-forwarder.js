/**
 * Cloudflare Worker для бота @Alexander_marketing_bot
 *
 * Что делает:
 *   1. Принимает webhook от Telegram, когда кто-то пишет боту.
 *   2. Пересылает сообщение в личный чат админа (Александра) с понятным форматированием:
 *      кто написал, его username/id, сам текст, кнопка "Открыть чат".
 *   3. Команда /start у бота → выдаёт приветственное сообщение и ссылку на сайт.
 *
 * Что НЕ делает (можно добавить позже):
 *   - Не пересылает фото/видео/аудио — только текст. Media передаёт через forwardMessage.
 *   - Не сохраняет историю переписки.
 *   - Не позволяет админу отвечать через бота (нужен state, см. v2).
 *
 * Env vars (задаются в настройках Worker'а):
 *   - BOT_TOKEN: токен бота от @BotFather (7818572051:AAEoWoizhJybzlOgGmFmlJjrJ4A4AqQ2Lx0)
 *   - ADMIN_CHAT_ID: chat_id админа куда пересылать (666070596)
 *   - SECRET_TOKEN: секрет для верификации webhook (любая случайная строка)
 */

export default {
  async fetch(request, env) {
    // Только POST от Telegram
    if (request.method !== 'POST') {
      return new Response('OK — Lyusen bot forwarder. Use POST for webhook.', { status: 200 });
    }

    // Верификация что это реально Telegram (защита от чужих POST на наш URL)
    const secretHeader = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (env.SECRET_TOKEN && secretHeader !== env.SECRET_TOKEN) {
      return new Response('Forbidden', { status: 403 });
    }

    let update;
    try {
      update = await request.json();
    } catch (e) {
      return new Response('Bad request', { status: 400 });
    }

    const msg = update.message;
    if (!msg) return new Response('OK');

    const from = msg.from || {};
    const chatId = msg.chat.id;
    const isFromAdmin = String(chatId) === String(env.ADMIN_CHAT_ID);

    // ───── Команда /start ─────
    if (msg.text === '/start') {
      await tgSendMessage(env, chatId,
        '👋 Здравствуйте! Это бот агентства *Люсъен*.\n\n' +
        'Напишите ваш вопрос — Александр Молчанов, основатель агентства, ответит лично в течение дня.\n\n' +
        'Или сразу опишите задачу:\n' +
        '• какой у вас бизнес\n' +
        '• какая задача (продвижение / реклама / сайт / контент)\n' +
        '• какой бюджет на маркетинг в месяц\n\n' +
        '🌐 [Сайт агентства](https://aleksanrmol4-a11y.github.io/lyusen-site/)'
      );
      return new Response('OK');
    }

    // ───── Если пишет сам админ — не пересылаем себе же ─────
    if (isFromAdmin) {
      await tgSendMessage(env, chatId,
        'ℹ️ Это бот для приёма заявок. Когда вам кто-то напишет — сообщение прилетит сюда. ' +
        'Чтобы ответить — откройте профиль клиента (ссылка `tg://user?id=...` в каждой пересылке).'
      );
      return new Response('OK');
    }

    // ───── Пересылка админу ─────
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

    // Inline-кнопка "Открыть чат"
    const replyMarkup = {
      inline_keyboard: [[
        { text: '💬 Ответить в Telegram', url: 'tg://user?id=' + senderId }
      ]]
    };

    await tgSendMessage(env, env.ADMIN_CHAT_ID, forwardText, replyMarkup);

    // Если это медиа — отдельно пересылаем оригинал (forwardMessage даёт точную копию)
    if (!msg.text) {
      await tgForwardMessage(env, env.ADMIN_CHAT_ID, chatId, msg.message_id);
    }

    // Подтверждение отправителю
    await tgSendMessage(env, chatId,
      '✅ Спасибо, ваше сообщение принято. Александр свяжется с вами в течение дня.'
    );

    return new Response('OK');
  }
};

// ───── helpers ─────

async function tgSendMessage(env, chatId, text, replyMarkup) {
  const body = {
    chat_id: chatId,
    text: text,
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
    body: JSON.stringify({
      chat_id: toChatId,
      from_chat_id: fromChatId,
      message_id: messageId
    })
  });
}

function escapeMd(s) {
  return String(s).replace(/[_*`\[\]()]/g, m => '\\' + m);
}
