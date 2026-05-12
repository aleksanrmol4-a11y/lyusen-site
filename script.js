// ---- config ----
const TELEGRAM_BOT_TOKEN = '7818572051:AAEoWoizhJybzlOgGmFmlJjrJ4A4AqQ2Lx0';
const TELEGRAM_CHAT_ID   = '666070596';
const SEND_TIMEOUT_MS    = 12000;

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

// ---- prefill form from service / price click ----
const messageField = document.querySelector('textarea[name="message"]');
const contactSection = document.getElementById('contact');

function prefillAndScroll(serviceName) {
  if (!serviceName) return;
  if (messageField) {
    messageField.value = 'Интересует: ' + serviceName + '\n\n';
    // wait for scroll to start, then focus so iOS doesn't fight us
    setTimeout(() => {
      messageField.focus({ preventScroll: true });
      const end = messageField.value.length;
      messageField.setSelectionRange(end, end);
    }, 350);
  }
  if (contactSection) {
    contactSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// service cards: <a href="#contact" data-service="...">
document.querySelectorAll('.service-card[data-service]').forEach(card => {
  card.addEventListener('click', (e) => {
    e.preventDefault();
    prefillAndScroll(card.dataset.service);
  });
});

// price list rows
document.querySelectorAll('.price-list li[data-service]').forEach(li => {
  const trigger = () => prefillAndScroll(li.dataset.service);
  li.addEventListener('click', trigger);
  li.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger(); }
  });
});

// ---- lead form ----
const form = document.getElementById('leadForm');
const submitBtn = document.getElementById('submitBtn');
const statusEl = document.getElementById('formStatus');

function setStatus(kind, html) {
  if (!statusEl) return;
  statusEl.className = 'form-status ' + kind;
  statusEl.innerHTML = html;
  statusEl.style.display = html ? 'block' : 'none';
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

    const fallbackHtml =
      'Не получилось отправить через сайт. Напишите напрямую — ответим сразу: ' +
      '<a href="https://t.me/AlexLeonidovich1" target="_blank" rel="noopener">Telegram</a> · ' +
      '<a href="https://wa.me/79068161172" target="_blank" rel="noopener">WhatsApp</a>. ' +
      'Или скиньте на <a href="mailto:compalekks@gmail.com?subject=' +
      encodeURIComponent('Заявка с сайта') + '&body=' +
      encodeURIComponent('Имя: ' + name + '\nКонтакт: ' + contact + '\n\n' + message) +
      '">compalekks@gmail.com</a>.';

    submitBtn.classList.add('is-loading');
    submitBtn.disabled = true;
    setStatus('', '');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

    try {
      const res = await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const json = await res.json();
      if (!json.ok) throw new Error(json.description || 'Telegram API error');

      setStatus('ok', '✅ Заявка отправлена. Свяжемся в течение дня.');
      form.reset();
    } catch (err) {
      clearTimeout(timeoutId);
      console.error(err);
      setStatus('err', fallbackHtml);
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
