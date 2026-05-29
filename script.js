// ---- config ----
// Многоуровневая стратегия доставки заявки в РФ:
//  1) пробуем Worker (быстро, у большинства работает)
//  2) если не получилось — открываем Telegram-бот с предзаполненной заявкой через deep link ?start=base64
//     бот сам пересылает её админу
//  3) параллельно — резервные кнопки WhatsApp и mailto
// Так заявка не теряется даже если Cloudflare режут провайдеры.
const LEAD_ENDPOINT       = 'https://lyusen-bot-forwarder.lyusen-agency.workers.dev/lead';
const TG_BOT_USERNAME     = 'Alexander_marketing_bot';
const SEND_TIMEOUT_MS     = 6000;  // короче чем раньше — быстрее переходим к fallback

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


if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitLeadForm(form, submitBtn, statusEl);
  });
}

// ---- floating contact widget ----
const fabWrap = document.getElementById('fabWrap');
const fabToggle = document.getElementById('fabToggle');
const fabMenu = document.getElementById('fabMenu');
const fabModal = document.getElementById('fabModal');

function setFabOpen(open) {
  if (!fabWrap || !fabMenu) return;
  fabWrap.dataset.open = open ? 'true' : 'false';
  fabToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  fabMenu.hidden = !open;
}

function setModalOpen(open) {
  if (!fabModal) return;
  fabModal.hidden = !open;
  document.body.style.overflow = open ? 'hidden' : '';
  if (open) {
    const first = fabModal.querySelector('input, textarea');
    if (first) setTimeout(() => first.focus(), 60);
  }
}

if (fabToggle) {
  fabToggle.addEventListener('click', () => {
    const isOpen = fabWrap.dataset.open === 'true';
    setFabOpen(!isOpen);
  });
}

if (fabMenu) {
  fabMenu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-action="form"]');
    if (item) {
      e.preventDefault();
      setFabOpen(false);
      setModalOpen(true);
    }
  });
}

if (fabModal) {
  fabModal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close="1"]')) setModalOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !fabModal.hidden) setModalOpen(false);
  });
}

// Кодирует {name,contact,message} в base64url-payload для deep link Telegram-бота.
// Бот принимает payload через /start=<payload> и шлёт админу.
function lcEncodeLead(name, contact, message) {
  const json = JSON.stringify({ n: name, c: contact, m: message });
  // utf-8 → base64 → base64url
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Резервная плашка с тремя кнопками: TG-бот (с deep link), WhatsApp, mailto.
// Заявка не теряется ни в одном из этих сценариев.
function lcFallbackHtml(name, contact, message) {
  const tgPayload = lcEncodeLead(name, contact, message);
  // Telegram ограничивает start-параметр 64 символами. Если влезает — используем deep link,
  // иначе просто открываем чат с ботом, пользователь увидит подсказку и пришлёт текст вручную.
  const tgUrl = tgPayload.length <= 64
    ? 'https://t.me/' + TG_BOT_USERNAME + '?start=' + tgPayload
    : 'https://t.me/' + TG_BOT_USERNAME;
  const waText = encodeURIComponent('Здравствуйте! Хочу обсудить:\n\nИмя: ' + name + '\nКонтакт: ' + contact + '\n\n' + message);
  const mailBody = encodeURIComponent('Имя: ' + name + '\nКонтакт: ' + contact + '\n\n' + message);
  return (
    '<strong>Сеть подвела — выберите альтернативный способ:</strong><br>' +
    '<div class="form-fallback-actions">' +
    '<a class="form-fallback-btn fb-tg" href="' + tgUrl + '" target="_blank" rel="noopener">Открыть в Telegram</a>' +
    '<a class="form-fallback-btn fb-wa" href="https://wa.me/79068161172?text=' + waText + '" target="_blank" rel="noopener">WhatsApp</a>' +
    '<a class="form-fallback-btn fb-mail" href="mailto:compalekks@gmail.com?subject=' + encodeURIComponent('Заявка с сайта') + '&body=' + mailBody + '">Email</a>' +
    '</div>' +
    '<small>Заявка уже подготовлена — просто нажмите «Отправить» в выбранном приложении.</small>'
  );
}

// shared submit handler (reused for main form and modal form)
// Returns true if доставка точно подтверждена Worker'ом.
async function submitLeadForm(formEl, btnEl, statusBox) {
  if (!formEl.reportValidity()) return false;

  const data = new FormData(formEl);
  const name = (data.get('name') || '').toString().trim();
  const contact = (data.get('contact') || '').toString().trim();
  const message = (data.get('message') || '').toString().trim();
  const honeypot = (data.get('website') || '').toString().trim();

  const setBox = (kind, html) => {
    if (!statusBox) return;
    statusBox.className = 'form-status ' + kind;
    statusBox.innerHTML = html;
    statusBox.style.display = html ? 'block' : 'none';
  };

  if (!name || !contact || !message) {
    setBox('err', 'Заполните все поля.');
    return false;
  }

  btnEl.classList.add('is-loading');
  btnEl.disabled = true;
  setBox('', '');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  try {
    const res = await fetch(LEAD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name, contact: contact, message: message,
        website: honeypot,
        source: formEl.id || 'web'
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error(json.error || 'Send failed');
    setBox('ok', '✅ Заявка отправлена. Свяжемся в течение дня.');
    formEl.reset();
    btnEl.classList.remove('is-loading');
    btnEl.disabled = false;
    return true;
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn('Worker недоступен, показываем fallback:', err);
    setBox('err', lcFallbackHtml(name, contact, message));
    btnEl.classList.remove('is-loading');
    btnEl.disabled = false;
    return false;
  }
}

const fabForm = document.getElementById('fabForm');
const fabSubmitBtn = document.getElementById('fabSubmitBtn');
const fabFormStatus = document.getElementById('fabFormStatus');
if (fabForm) {
  fabForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = await submitLeadForm(fabForm, fabSubmitBtn, fabFormStatus);
    if (ok) {
      setTimeout(() => setModalOpen(false), 1800);
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
