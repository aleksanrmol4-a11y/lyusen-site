// ---- config ----
const TELEGRAM_BOT_TOKEN = '7818572051:AAEoWoizhJybzlOgGmFmlJjrJ4A4AqQ2Lx0';
const TELEGRAM_CHAT_ID   = '666070596';

// ---- year ----
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// ---- mobile menu ----
const header = document.querySelector('.site-header');
const menuBtn = document.getElementById('menuToggle');
if (menuBtn && header) {
  menuBtn.addEventListener('click', () => {
    const open = header.classList.toggle('menu-open');
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.querySelectorAll('.nav a').forEach(a => {
    a.addEventListener('click', () => {
      header.classList.remove('menu-open');
      menuBtn.setAttribute('aria-expanded', 'false');
    });
  });
}

// ---- lead form ----
const form = document.getElementById('leadForm');
const submitBtn = document.getElementById('submitBtn');
const statusEl = document.getElementById('formStatus');

function setStatus(kind, text) {
  if (!statusEl) return;
  statusEl.className = 'form-status ' + kind;
  statusEl.textContent = text;
}

function escapeMarkdown(s) {
  return String(s).replace(/[_*`[\]()]/g, m => '\\' + m);
}

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;

    const data = new FormData(form);
    const name = (data.get('name') || '').toString().trim();
    const contact = (data.get('contact') || '').toString().trim();
    const message = (data.get('message') || '').toString().trim();

    if (!name || !contact || !message) {
      setStatus('err', 'Заполните все поля.');
      return;
    }

    const text =
      '🔥 *Новая заявка с сайта Люсъен*\n\n' +
      '👤 *Имя:* ' + escapeMarkdown(name) + '\n' +
      '📱 *Контакт:* ' + escapeMarkdown(contact) + '\n\n' +
      '💬 *Запрос:*\n' + escapeMarkdown(message);

    submitBtn.classList.add('is-loading');
    submitBtn.disabled = true;
    setStatus('', '');
    statusEl.style.display = 'none';

    try {
      const res = await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        })
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.description || 'Telegram API error');

      setStatus('ok', '✅ Заявка отправлена. Свяжемся в течение дня.');
      form.reset();
    } catch (err) {
      console.error(err);
      setStatus('err', 'Не получилось отправить. Напишите в Telegram или WhatsApp — кнопки выше.');
    } finally {
      submitBtn.classList.remove('is-loading');
      submitBtn.disabled = false;
    }
  });
}

// ---- intersection reveal (subtle fade-in) ----
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    for (const ent of entries) {
      if (ent.isIntersecting) {
        ent.target.classList.add('in-view');
        io.unobserve(ent.target);
      }
    }
  }, { threshold: 0.15 });
  document.querySelectorAll('.service-card, .case-card, .trust-item, .pricing-group').forEach(el => io.observe(el));
}
