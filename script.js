// ---- config ----
// Прямой путь к api.vk.com через JSONP — обходит CORS и Cloudflare-блокировки в РФ.
// Иерархия каналов:
//  1) JSONP к api.vk.com/method/messages.send (основной, 3 сек)
//  2) POST на Worker (резерв если api.vk.com медленный)
//  3) Fallback кнопки: ВКонтакте / WhatsApp / Email
const VK_GROUP_TOKEN      = 'vk1.a.B-HPWpsVfZVI0SBPu5You3dS50UnE5fNPiOPlevFCwNSpov5SGZgNZIAk_8UjeF8bnK0WklaiDCI5RNetb0ptxt1t49zRXfTrN_TL0Fkg0s3wivVdGRFSTM67DDDmpImS4wz79PxPwb3-OleZFfcIAlCupUD1buV--SXePvwk8MzlO7QOxM84RG3eu9OracAgRRupd89aGfrqwG8hbeiCQ';
const VK_PEER_ID          = '389765912';
const VK_API_VERSION      = '5.199';
const LEAD_ENDPOINT       = 'https://lyusen-bot-forwarder.lyusen-agency.workers.dev/lead';
const VK_GROUP_URL        = 'https://vk.com/lusen_agency';
const VK_TIMEOUT_MS       = 4000;
const SEND_TIMEOUT_MS     = 6000;

// Прямая отправка в VK через JSONP — обход всех блокировок РФ.
// Возвращает {ok:true} если VK принял, {ok:false, err} иначе.
function lcVkSendDirect(name, contact, message, source) {
  return new Promise((resolve) => {
    const text =
      '🔥 Заявка с сайта Люсъен\n' +
      'Источник: ' + source + '\n\n' +
      '👤 ' + name + '\n' +
      '📱 ' + contact + '\n\n' +
      '💬 ' + message;
    const cb = 'lcVkCb_' + Date.now() + '_' + Math.floor(Math.random()*1e6);
    let done = false;
    const finish = (result) => {
      if (done) return; done = true;
      try { delete window[cb]; } catch(_){}
      if (script.parentNode) script.parentNode.removeChild(script);
      resolve(result);
    };
    window[cb] = (r) => {
      if (r && r.response) finish({ ok: true, msgId: r.response });
      else finish({ ok: false, err: (r && r.error) ? r.error.error_msg : 'unknown' });
    };
    const params = [
      'access_token=' + encodeURIComponent(VK_GROUP_TOKEN),
      'peer_id=' + VK_PEER_ID,
      'message=' + encodeURIComponent(text),
      'random_id=' + Math.floor(Math.random() * 2147483647),
      'dont_parse_links=1',
      'v=' + VK_API_VERSION,
      'callback=' + cb
    ].join('&');
    const script = document.createElement('script');
    script.src = 'https://api.vk.com/method/messages.send?' + params;
    script.onerror = () => finish({ ok: false, err: 'network' });
    document.head.appendChild(script);
    setTimeout(() => finish({ ok: false, err: 'timeout' }), VK_TIMEOUT_MS);
  });
}

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

// Кодирует {name,contact,message} в base64url для GET-резерва (img-hack)
function lcEncodeLead(name, contact, message) {
  const json = JSON.stringify({ n: name, c: contact, m: message });
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Fallback: ВКонтакте (написать в сообщество) + WhatsApp + Email с предзаполненным текстом.
function lcFallbackHtml(name, contact, message) {
  const waText = encodeURIComponent('Здравствуйте! Хочу обсудить:\n\nИмя: ' + name + '\nКонтакт: ' + contact + '\n\n' + message);
  const mailBody = encodeURIComponent('Имя: ' + name + '\nКонтакт: ' + contact + '\n\n' + message);
  return (
    '<strong>Сеть подвела — напишите напрямую:</strong><br>' +
    '<div class="form-fallback-actions">' +
    '<a class="form-fallback-btn fb-vk" href="' + VK_GROUP_URL + '" target="_blank" rel="noopener">ВКонтакте</a>' +
    '<a class="form-fallback-btn fb-wa" href="https://wa.me/79068161172?text=' + waText + '" target="_blank" rel="noopener">WhatsApp</a>' +
    '<a class="form-fallback-btn fb-mail" href="mailto:info@lyusen18.ru?subject=' + encodeURIComponent('Заявка с сайта') + '&body=' + mailBody + '">Email</a>' +
    '</div>' +
    '<small>В WhatsApp и Email заявка уже подготовлена — просто нажмите «Отправить».</small>'
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

  const source = formEl.id || 'web';

  // ───── ШАГ 1: Прямой JSONP к api.vk.com (быстро, без CORS, без Cloudflare) ─────
  try {
    const vk = await lcVkSendDirect(name, contact, message, source);
    if (vk.ok) {
      setBox('ok', '✅ Заявка отправлена. Свяжемся в течение дня.');
      formEl.reset();
      btnEl.classList.remove('is-loading');
      btnEl.disabled = false;
      return true;
    }
    console.warn('JSONP VK failed:', vk.err);
  } catch (e) {
    console.warn('JSONP VK exception:', e);
  }

  // ───── ШАГ 2: Резерв через Cloudflare Worker ─────
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(LEAD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name, contact: contact, message: message,
        website: honeypot,
        source: source + '+worker'
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.ok) {
      setBox('ok', '✅ Заявка отправлена. Свяжемся в течение дня.');
      formEl.reset();
      btnEl.classList.remove('is-loading');
      btnEl.disabled = false;
      return true;
    }
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn('Worker fallback тоже упал:', err);
  }

  // ───── ШАГ 3: Все каналы упали — тихо дёргаем img-hack + показываем кнопки ─────
  try {
    const p = lcEncodeLead(name, contact, message);
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.src = LEAD_ENDPOINT + '?p=' + p + '&t=' + Date.now();
  } catch (_) {}
  setBox('err', lcFallbackHtml(name, contact, message));
  btnEl.classList.remove('is-loading');
  btnEl.disabled = false;
  return false;
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
