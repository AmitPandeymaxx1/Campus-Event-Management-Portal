/*!
 * CampusConnect Interactive Pack v1.0
 * ---------------------------------------------------------------------------
 * Drop-in, zero-dependency enhancement for the CampusConnect events page.
 * It auto-detects event cards (any block that holds a YYYY-MM-DD date) and adds:
 *
 *   - live search (with highlight), category chips, sorting
 *   - saved events (heart), "saved only" filter  (stored in localStorage)
 *   - live countdown on every card + "Next up" ticker in the hero
 *   - quick-view modal with ticking countdown (days / hours / min / sec)
 *   - Add to calendar (.ics), copy link (deep link via #event-id)
 *   - Register button (AJAX if you give an endpoint, local demo otherwise)
 *   - dark mode, toasts, confetti, scroll reveal, card tilt, hero glow
 *   - keyboard: "/" focus search, "Esc" close modal
 *
 * Optional config (define BEFORE loading this file):
 *   window.CC_CONFIG = {
 *     cardSelector: '.event-card',        // skip auto-detect, use your own selector
 *     registerEndpoint: '/api/register',  // POST {event_id,title,date} -> {ok:true}
 *     loginUrl: '/login',                 // redirect here when endpoint returns 401/403
 *     startHour: 9                        // countdown target hour (24h clock)
 *   };
 * Optional attributes on a card: data-event-id, data-category, data-date, data-title
 */
(() => {
  'use strict';
  if (window.__ccInteractive) return;
  window.__ccInteractive = true;

  const CFG = Object.assign(
    { cardSelector: null, registerEndpoint: null, loginUrl: null, startHour: 9, storagePrefix: 'cc:' },
    window.CC_CONFIG || {}
  );

  /* ------------------------------------------------------------------ utils */
  const DATE_FIND = /(\d{4})-(\d{2})-(\d{2})/;
  const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const FINE = !!(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches);
  let EMOJI_RE;
  try { EMOJI_RE = new RegExp('\\p{Extended_Pictographic}', 'u'); }
  catch (_) { EMOJI_RE = /[\u2600-\u27BF]|[\uD83C-\uDBFF][\uDC00-\uDFFF]/; }

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const make = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const pad = n => (n < 10 ? '0' : '') + n;

  const store = {
    get(k, d) {
      try { const v = localStorage.getItem(CFG.storagePrefix + k); return v == null ? d : JSON.parse(v); }
      catch (_) { return d; }
    },
    set(k, v) { try { localStorage.setItem(CFG.storagePrefix + k, JSON.stringify(v)); } catch (_) { /* private mode */ } }
  };

  // apply saved theme as early as possible (less flash)
  const root = document.documentElement;
  const storedTheme = store.get('theme', null);
  if (storedTheme) root.setAttribute('data-theme', storedTheme);

  /* ------------------------------------------------------------------ state */
  const saved = new Set(store.get('saved', []));
  const registered = new Set(store.get('registered', []));
  const state = { q: '', cat: 'All', sort: 'default', savedOnly: false };
  let events = [], grid = null, toolbar = null, emptyEl = null, modal = null;
  let searchInput = null, savedBadge = null, countEl = null, nextBtn = null, nextEv = null;
  let openEv = null, lastFocus = null, canReorder = true, themeBtn = null;

  const CAT_ICON = { All: '✨', Tech: '💻', Cultural: '🎭', Workshop: '🛠️', Sports: '🏅', Other: '📌' };
  const GRAD = {
    Tech: 'linear-gradient(135deg,#ddd6fe,#c4b5fd)',
    Cultural: 'linear-gradient(135deg,#ffe4d1,#fdba9b)',
    Workshop: 'linear-gradient(135deg,#bff3e4,#8fe3cf)',
    Sports: 'linear-gradient(135deg,#cfe8ff,#93c5fd)'
  };
  const GRAD_DEFAULT = 'linear-gradient(135deg,#fde68a,#fca5a5)';
  const CAT_RULES = [
    ['Sports', /sport|cricket|football|kabaddi|volleyball|basketball|marathon|tournament|athlet/i],
    ['Cultural', /cultur|music|dance|drama|theat|fashion|talent|concert|singing/i],
    ['Workshop', /workshop|seminar|webinar|training|bootcamp|hands-on|masterclass/i],
    ['Tech', /tech|code|coding|hack|software|\bai\b|robot|data|web|dev|programming|innovation/i]
  ];
  const guessCat = text => { for (const [c, re] of CAT_RULES) if (re.test(text)) return c; return 'Other'; };

  /* ------------------------------------------------------------ date helpers */
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const target = ev => { const [y, m, d] = ev.date.split('-').map(Number); return new Date(y, m - 1, d, CFG.startHour, 0, 0); };
  const dayDiff = ev => Math.round((startOfDay(target(ev)) - startOfDay(new Date())) / 864e5);

  function chipLabel(ev) {
    const d = dayDiff(ev);
    if (d < 0) return { text: 'Ended', cls: 'cc-pill--done', ico: '⏹️' };
    if (d === 0) return { text: 'Today!', cls: 'cc-pill--hot', ico: '🔥' };
    if (d === 1) return { text: 'Tomorrow', cls: 'cc-pill--hot', ico: '⚡' };
    if (d <= 7) return { text: 'in ' + d + ' days', cls: 'cc-pill--hot', ico: '⏳' };
    if (d < 60) return { text: 'in ' + d + ' days', cls: '', ico: '⏳' };
    return { text: 'in ' + Math.round(d / 30) + ' months', cls: '', ico: '🗓️' };
  }

  const prettyDate = ev => target(ev).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  /* ------------------------------------------------------------- detection */
  const isDateLeaf = n => !n.children.length && n.textContent.trim().length <= 24 && DATE_FIND.test(n.textContent) && !n.closest('.cc-ui');

  function findCards() {
    let nodes;
    if (CFG.cardSelector) {
      nodes = $$(CFG.cardSelector);
    } else {
      const leaves = $$('body *').filter(isDateLeaf);
      nodes = leaves.map(leaf => {
        let node = leaf;
        for (let i = 0; i < 6 && node.parentElement; i++) {
          const p = node.parentElement;
          if (/^(BODY|MAIN|SECTION|UL|OL|HTML)$/.test(p.tagName)) break;
          if (leaves.filter(l => p.contains(l)).length > 1) break;
          node = p;
        }
        return node;
      });
    }
    return nodes.filter((n, i) => nodes.indexOf(n) === i);
  }

  function parse(card, i) {
    const dateLeaf = $$('*', card).filter(isDateLeaf)[0];
    if (dateLeaf) dateLeaf.classList.add('cc-date');   // lets dark mode keep the date badge readable
    const dateText = card.getAttribute('data-date') || (dateLeaf ? dateLeaf.textContent.match(DATE_FIND)[0] : '');
    const titleEl = $('h1,h2,h3,h4,h5', card);
    const descEl = $('p', card);
    const title = (card.getAttribute('data-title') || (titleEl ? titleEl.textContent : '') || 'Event ' + (i + 1)).trim();
    const desc = descEl ? descEl.textContent.trim() : '';
    const emojiEl = $$('*', card).filter(n => !n.children.length && n.textContent.trim().length <= 8 && EMOJI_RE.test(n.textContent))[0];
    const link = $('a[href]', card);
    return {
      el: card, titleEl, descEl, title, desc, date: dateText, idx: i,
      icon: emojiEl ? emojiEl.textContent.trim() : '🎟️',
      cat: card.getAttribute('data-category') || guessCat(title + ' ' + desc),
      id: card.getAttribute('data-event-id') || slug(title) || 'event-' + i,
      href: link ? link.getAttribute('href') : null,
      hlOK: !!titleEl && !titleEl.children.length
    };
  }

  /* ---------------------------------------------------------------- toasts */
  let toastBox = null;
  function toast(msg, ms) {
    if (!toastBox) {
      toastBox = make('div', 'cc-toasts cc-ui');
      toastBox.setAttribute('role', 'status');
      toastBox.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastBox);
    }
    const t = make('div', 'cc-toast', esc(msg));
    toastBox.appendChild(t);
    setTimeout(() => { t.classList.add('cc-out'); setTimeout(() => t.remove(), 300); }, ms || 2600);
  }

  /* -------------------------------------------------------------- confetti */
  function confetti(x, y) {
    if (REDUCED) return;
    const cv = make('canvas', 'cc-confetti cc-ui');
    cv.width = window.innerWidth; cv.height = window.innerHeight;
    document.body.appendChild(cv);
    const ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) { cv.remove(); return; }
    const cols = ['#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444'];
    const ps = [];
    for (let i = 0; i < 150; i++) {
      const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 9;
      ps.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 6, w: 6 + Math.random() * 6, h: 4 + Math.random() * 5,
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: cols[i % cols.length] });
    }
    const t0 = performance.now();
    (function frame(t) {
      const age = t - t0;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ps.forEach(p => {
        p.vy += 0.32; p.vx *= 0.992; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - age / 2600);
        ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (age < 2600) requestAnimationFrame(frame); else cv.remove();
    })(t0);
  }

  /* ---------------------------------------------------------- calendar / share */
  const icsEscape = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const ymd = d => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());

  function downloadIcs(ev) {
    const [y, m, d] = ev.date.split('-').map(Number);
    const now = new Date();
    const stamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + 'T' +
      pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CampusConnect//Events//EN', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT', 'UID:' + ev.id + '@campusconnect', 'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + ymd(new Date(y, m - 1, d)),
      'DTEND;VALUE=DATE:' + ymd(new Date(y, m - 1, d + 1)),
      'SUMMARY:' + icsEscape(ev.title), 'DESCRIPTION:' + icsEscape(ev.desc), 'CATEGORIES:' + icsEscape(ev.cat),
      'END:VEVENT', 'END:VCALENDAR'
    ];
    try {
      const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = make('a'); a.href = url; a.download = ev.id + '.ics';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast('📅 Calendar file downloaded');
    } catch (_) { toast('⚠️ Could not create calendar file'); }
  }

  function share(ev) {
    const url = location.origin + location.pathname + '#' + encodeURIComponent(ev.id);
    const done = () => toast('🔗 Link copied');
    function fallback() {
      const t = make('textarea'); t.value = url; t.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch (_) { toast(url, 5000); }
      t.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fallback);
    else fallback();
  }

  /* -------------------------------------------------------- save / register */
  function refreshEv(ev) {
    const isSaved = saved.has(ev.id), isReg = registered.has(ev.id);
    const sb = $('.cc-save', ev.el);
    if (sb) { sb.setAttribute('aria-pressed', String(isSaved)); sb.firstChild.textContent = isSaved ? '♥' : '♡'; }
    if (ev.regEl) ev.regEl.hidden = !isReg;
    if (savedBadge) savedBadge.textContent = saved.size;
    if (openEv === ev && modal) {
      const rb = $('[data-act="register"]', modal), vb = $('[data-act="save"]', modal);
      if (rb) {
        const closed = dayDiff(ev) < 0;
        rb.innerHTML = isReg ? '✓ Registered' : closed ? 'Registration closed' : 'Register now 🎟️';
        rb.classList.toggle('cc-done', isReg);
        rb.disabled = closed && !isReg;
      }
      if (vb) vb.innerHTML = isSaved ? '♥ Saved' : '♡ Save';
    }
  }

  function toggleSave(ev) {
    if (saved.has(ev.id)) { saved.delete(ev.id); toast('Removed from saved'); }
    else { saved.add(ev.id); toast('♥ Saved “' + ev.title + '”'); }
    store.set('saved', Array.from(saved));
    const sb = $('.cc-save', ev.el);
    if (sb && !REDUCED) { sb.classList.remove('cc-beat'); void sb.offsetWidth; sb.classList.add('cc-beat'); }
    refreshEv(ev);
    if (state.savedOnly) apply();
  }

  const STOP = {};
  function register(ev, btn) {
    if (registered.has(ev.id)) return toast('✅ You are already registered for ' + ev.title);
    if (dayDiff(ev) < 0) return toast('⏹️ Registration is closed for this event');
    const success = () => {
      registered.add(ev.id); store.set('registered', Array.from(registered));
      refreshEv(ev);
      toast('🎉 Registered for ' + ev.title + '!');
      const r = (btn || ev.el).getBoundingClientRect();
      confetti(r.left + r.width / 2, r.top + r.height / 2);
    };
    if (!CFG.registerEndpoint) return success();

    if (btn) { btn.disabled = true; btn.innerHTML = 'Registering…'; }
    fetch(CFG.registerEndpoint, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ event_id: ev.id, title: ev.title, date: ev.date })
    })
      .then(r => {
        if (r.status === 401 || r.status === 403) {
          toast('🔐 Please log in to register');
          if (CFG.loginUrl) setTimeout(() => { location.href = CFG.loginUrl; }, 1200);
          throw STOP;
        }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json().catch(() => ({ ok: true }));
      })
      .then(d => { if (d && d.ok === false) throw new Error(d.error || 'failed'); success(); })
      .catch(e => { if (e !== STOP) toast('⚠️ Could not register — please try again'); })
      .then(() => { if (btn) btn.disabled = false; refreshEv(ev); });
  }

  /* ----------------------------------------------------------------- modal */
  function buildModal() {
    modal = make('div', 'cc-modal cc-ui');
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'cc-m-title');
    modal.innerHTML =
      '<div class="cc-modal__backdrop" data-close></div>' +
      '<div class="cc-modal__panel">' +
        '<button type="button" class="cc-modal__x" data-close aria-label="Close">✕</button>' +
        '<div class="cc-modal__hero"><span class="cc-m-icon" aria-hidden="true"></span><span class="cc-pill cc-m-cd"></span></div>' +
        '<div class="cc-modal__body">' +
          '<h3 id="cc-m-title"></h3>' +
          '<div class="cc-m-date"></div>' +
          '<p class="cc-m-desc"></p>' +
          '<div class="cc-countwrap">' +
            '<div class="cc-count">' +
              '<div><b data-u="d">00</b><small>days</small></div><div><b data-u="h">00</b><small>hours</small></div>' +
              '<div><b data-u="m">00</b><small>mins</small></div><div><b data-u="s">00</b><small>secs</small></div>' +
            '</div><div class="cc-count__msg"></div>' +
          '</div>' +
          '<div class="cc-m-actions">' +
            '<button type="button" class="cc-btn cc-primary" data-act="register">Register now 🎟️</button>' +
            '<button type="button" class="cc-btn" data-act="save">♡ Save</button>' +
            '<button type="button" class="cc-btn" data-act="ics">📅 Add to calendar</button>' +
            '<button type="button" class="cc-btn" data-act="share">🔗 Copy link</button>' +
          '</div>' +
          '<a class="cc-m-link" href="#" hidden>Open full page →</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    modal.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) return closeModal();
      const b = e.target.closest('[data-act]');
      if (!b || !openEv) return;
      const a = b.getAttribute('data-act');
      if (a === 'register') register(openEv, b);
      else if (a === 'save') toggleSave(openEv);
      else if (a === 'ics') downloadIcs(openEv);
      else if (a === 'share') share(openEv);
    });
  }

  function openModal(ev) {
    openEv = ev;
    lastFocus = document.activeElement;
    $('#cc-m-title', modal).textContent = ev.title;
    $('.cc-m-date', modal).textContent = '📅 ' + prettyDate(ev) + ' · ' + ev.cat;
    $('.cc-m-desc', modal).textContent = ev.desc || 'More details coming soon.';
    $('.cc-m-icon', modal).textContent = ev.icon;
    $('.cc-modal__hero', modal).style.background = GRAD[ev.cat] || GRAD_DEFAULT;
    const cl = chipLabel(ev), pill = $('.cc-m-cd', modal);
    pill.className = 'cc-pill cc-m-cd ' + cl.cls;
    pill.textContent = cl.ico + ' ' + cl.text;
    const link = $('.cc-m-link', modal);
    if (ev.href && ev.href !== '#') { link.href = ev.href; link.hidden = false; } else { link.hidden = true; }
    refreshEv(ev);
    tickModal();
    modal.hidden = false;
    root.classList.add('cc-lock');
    $('.cc-modal__x', modal).focus();
    try { history.replaceState(null, '', '#' + encodeURIComponent(ev.id)); } catch (_) { /* file:// */ }
  }

  function closeModal() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    root.classList.remove('cc-lock');
    openEv = null;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* file:// */ }
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function tickModal() {
    if (!openEv || !modal || modal.hidden && !openEv) return;
    const wrap = $('.cc-countwrap', modal), msg = $('.cc-count__msg', modal);
    const ms = +target(openEv) - Date.now();
    if (ms <= 0) {
      const live = dayDiff(openEv) === 0;
      wrap.setAttribute('data-state', live ? 'live' : 'ended');
      msg.textContent = live ? '🔴 Happening today — see you there!' : '⏹️ This event has ended';
      ['d', 'h', 'm', 's'].forEach(u => { $('[data-u="' + u + '"]', modal).textContent = '00'; });
      return;
    }
    wrap.removeAttribute('data-state');
    msg.textContent = '';
    const s = Math.floor(ms / 1000);
    const parts = { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 };
    Object.keys(parts).forEach(u => { $('[data-u="' + u + '"]', modal).textContent = pad(parts[u]); });
  }

  /* -------------------------------------------------------- card enhancement */
  function updateChip(ev) {
    const cl = chipLabel(ev);
    ev.cdEl.className = 'cc-pill cc-cd ' + cl.cls;
    ev.cdEl.textContent = cl.ico + ' ' + cl.text;
  }

  function enhance(ev) {
    const c = ev.el;
    c.classList.add('cc-card');
    if (getComputedStyle(c).position === 'static') c.style.position = 'relative';
    c.setAttribute('tabindex', '0');
    c.setAttribute('aria-haspopup', 'dialog');

    const sb = make('button', 'cc-save cc-ui', '<span aria-hidden="true">♡</span>');
    sb.type = 'button';
    sb.setAttribute('aria-label', 'Save ' + ev.title);
    sb.setAttribute('aria-pressed', 'false');
    sb.addEventListener('click', e => { e.stopPropagation(); toggleSave(ev); });
    c.appendChild(sb);

    const meta = make('div', 'cc-meta cc-ui',
      '<span class="cc-pill cc-cd"></span>' +
      '<span class="cc-pill cc-pill--cat">' + esc(CAT_ICON[ev.cat] || '📌') + ' ' + esc(ev.cat) + '</span>' +
      '<span class="cc-pill cc-pill--ok cc-reg" hidden>✓ Registered</span>' +
      '<span class="cc-more">Quick view →</span>');
    const anchor = ev.descEl || ev.titleEl;
    if (anchor) anchor.insertAdjacentElement('afterend', meta); else c.appendChild(meta);
    ev.cdEl = $('.cc-cd', meta);
    ev.regEl = $('.cc-reg', meta);
    updateChip(ev);

    c.addEventListener('click', e => {
      if (e.target.closest('a,button,input,select,textarea,label')) return;
      openModal(ev);
    });
    c.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === c) { e.preventDefault(); openModal(ev); }
    });

    if (FINE && !REDUCED) {
      c.addEventListener('mousemove', e => {
        const r = c.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        c.style.transform = 'perspective(900px) rotateX(' + (-y * 5).toFixed(2) + 'deg) rotateY(' + (x * 6).toFixed(2) + 'deg) translateY(-4px)';
      });
      c.addEventListener('mouseleave', () => { c.style.transform = ''; });
    }
    refreshEv(ev);
  }

  /* --------------------------------------------------------- filter / sort */
  const hl = (text, q) => {
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  };

  function sorter(a, b) {
    if (state.sort === 'name') return a.title.localeCompare(b.title);
    if (state.sort === 'default') return a.idx - b.idx;
    const ta = +target(a), tb = +target(b), now = Date.now();
    if (state.sort === 'date-desc') return tb - ta;
    const pa = ta < now, pb = tb < now;           // upcoming first, ended at the end
    if (pa !== pb) return pa ? 1 : -1;
    return ta - tb;
  }

  function apply(first) {
    const q = state.q.trim().toLowerCase();
    if (canReorder) events.slice().sort(sorter).forEach(e => grid.appendChild(e.el));

    let shown = 0;
    events.forEach(e => {
      const ok = (state.cat === 'All' || e.cat === state.cat) &&
        (!state.savedOnly || saved.has(e.id)) &&
        (!q || (e.title + ' ' + e.desc + ' ' + e.cat + ' ' + e.date).toLowerCase().indexOf(q) > -1);
      const wasHidden = e.el.classList.contains('cc-hidden');
      e.el.classList.toggle('cc-hidden', !ok);
      if (e.hlOK) e.titleEl.innerHTML = ok && q ? hl(e.title, q) : esc(e.title);
      if (ok) {
        if (!first && !REDUCED && (wasHidden || state.q !== e._lastQ)) {
          e.el.classList.remove('cc-pop'); void e.el.offsetWidth;
          e.el.style.animationDelay = Math.min(shown, 8) * 35 + 'ms';
          e.el.classList.add('cc-pop');
        }
        shown++;
      }
      e._lastQ = state.q;
    });

    if (countEl) countEl.textContent = shown + (shown === 1 ? ' event' : ' events');
    const empty = shown === 0;
    emptyEl.hidden = !empty;
    if (empty) {
      const none = state.savedOnly && !saved.size;
      $('h3', emptyEl).textContent = none ? 'Nothing saved yet' : 'No events found';
      $('p', emptyEl).textContent = none ? 'Tap the ♡ on any event to keep it here.' : 'Try a different word or clear the filters.';
    }
    $$('.cc-chip', toolbar).forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-cat') === state.cat)));
    $('.cc-saved-toggle', toolbar).setAttribute('aria-pressed', String(state.savedOnly));
  }

  function resetFilters() {
    state.q = ''; state.cat = 'All'; state.savedOnly = false;
    searchInput.value = '';
    apply();
  }

  /* --------------------------------------------------------------- toolbar */
  function buildToolbar() {
    toolbar = make('div', 'cc-toolbar cc-ui');
    const cats = ['All'].concat(Array.from(new Set(events.map(e => e.cat))));
    toolbar.innerHTML =
      '<label class="cc-search"><span aria-hidden="true">🔍</span>' +
        '<input type="search" placeholder="Search events…" aria-label="Search events" autocomplete="off"><kbd>/</kbd></label>' +
      (cats.length > 2 ? '<div class="cc-chips" role="group" aria-label="Filter by category">' +
        cats.map(c => '<button type="button" class="cc-chip" data-cat="' + esc(c) + '" aria-pressed="' + (c === 'All') + '">' +
          (CAT_ICON[c] || '📌') + ' ' + esc(c) + '<small>' + (c === 'All' ? events.length : events.filter(e => e.cat === c).length) + '</small></button>').join('') +
        '</div>' : '') +
      '<div class="cc-right">' +
        '<button type="button" class="cc-btn cc-saved-toggle" aria-pressed="false">♥ Saved <span class="cc-badge">0</span></button>' +
        (canReorder ? '<select class="cc-sort" aria-label="Sort events">' +
          '<option value="default">Featured</option><option value="date">Soonest first</option>' +
          '<option value="date-desc">Latest first</option><option value="name">A → Z</option></select>' : '') +
      '</div>';
    grid.parentNode.insertBefore(toolbar, grid);

    emptyEl = make('div', 'cc-empty cc-ui',
      '<div class="cc-empty__emoji">🔭</div><h3>No events found</h3><p></p>' +
      '<button type="button" class="cc-btn" data-reset>Reset filters</button>');
    emptyEl.hidden = true;
    grid.parentNode.insertBefore(emptyEl, grid.nextSibling);

    searchInput = $('input', toolbar);
    savedBadge = $('.cc-badge', toolbar);
    searchInput.addEventListener('input', () => { state.q = searchInput.value; apply(); });
    toolbar.addEventListener('click', e => {
      const chip = e.target.closest('.cc-chip');
      if (chip) { state.cat = chip.getAttribute('data-cat'); apply(); }
      if (e.target.closest('.cc-saved-toggle')) { state.savedOnly = !state.savedOnly; apply(); }
    });
    const sortSel = $('.cc-sort', toolbar);
    if (sortSel) sortSel.addEventListener('change', () => { state.sort = sortSel.value; apply(); });
    emptyEl.addEventListener('click', e => { if (e.target.closest('[data-reset]')) resetFilters(); });
  }

  /* ------------------------------------------------- hero, fabs, progress */
  function updateNext() {
    if (!nextBtn) return;
    const now = Date.now();
    const up = events.filter(e => +target(e) > now).sort((a, b) => +target(a) - +target(b))[0];
    if (!up) { nextBtn.hidden = true; return; }
    nextEv = up; nextBtn.hidden = false;
    const s = Math.floor((+target(up) - now) / 1000);
    nextBtn.innerHTML = '<span class="cc-dot"></span>Next up: <b>' + esc(up.title) + '</b> · ' +
      Math.floor(s / 86400) + 'd ' + pad(Math.floor(s % 86400 / 3600)) + 'h ' + pad(Math.floor(s % 3600 / 60)) + 'm ' + pad(s % 60) + 's';
  }

  function buildHero() {
    const h1 = $('h1');
    if (!h1) return;
    let hero = h1.closest('section, header, .hero') || h1.parentElement;
    if (!hero || hero.contains(grid)) hero = h1.parentElement;
    if (!hero || hero.contains(grid) || hero === document.body) return;

    if (getComputedStyle(hero).position === 'static') hero.style.position = 'relative';
    const glow = make('div', 'cc-glow cc-ui');
    hero.appendChild(glow);
    if (FINE && !REDUCED) {
      hero.addEventListener('mouseenter', () => glow.classList.add('cc-on'));
      hero.addEventListener('mouseleave', () => glow.classList.remove('cc-on'));
      hero.addEventListener('mousemove', e => {
        const r = hero.getBoundingClientRect();
        glow.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        glow.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    }
    nextBtn = make('button', 'cc-next cc-ui');
    nextBtn.type = 'button';
    nextBtn.addEventListener('click', () => { if (nextEv) openModal(nextEv); });
    (($('p', hero) || h1).insertAdjacentElement('afterend', nextBtn));
    updateNext();
  }

  function buildChrome() {
    const prog = make('div', 'cc-progress cc-ui');
    document.body.appendChild(prog);
    const fabs = make('div', 'cc-fabs cc-ui');
    themeBtn = make('button', 'cc-fab', '🌙');
    themeBtn.type = 'button';
    themeBtn.setAttribute('aria-label', 'Toggle dark mode');
    const top = make('button', 'cc-fab cc-fab--top', '↑');
    top.type = 'button';
    top.setAttribute('aria-label', 'Back to top');
    fabs.appendChild(top); fabs.appendChild(themeBtn);
    document.body.appendChild(fabs);

    const syncTheme = () => { themeBtn.textContent = root.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙'; };
    syncTheme();
    themeBtn.addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next); store.set('theme', next); syncTheme();
      toast(next === 'dark' ? '🌙 Dark mode on' : '☀️ Light mode on', 1500);
    });
    top.addEventListener('click', () => window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' }));

    let ticking = false;
    const onScroll = () => {
      if (ticking) return; ticking = true;
      requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        prog.style.width = (max > 0 ? Math.min(100, window.scrollY / max * 100) : 0) + '%';
        top.classList.toggle('cc-show', window.scrollY > 500);
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function wireExploreButton() {
    $$('a,button').forEach(b => {
      if (b.closest('.cc-ui') || !/explore\s+events/i.test(b.textContent)) return;
      b.addEventListener('click', e => {
        e.preventDefault();
        toolbar.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
        toolbar.classList.remove('cc-pulse'); void toolbar.offsetWidth; toolbar.classList.add('cc-pulse');
      });
    });
  }

  function reveal() {
    if (REDUCED || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        const c = en.target; io.unobserve(c);
        c.classList.add('cc-in');
        c.addEventListener('animationend', function done() {
          c.classList.remove('cc-reveal', 'cc-in'); c.removeEventListener('animationend', done);
        });
      });
    }, { threshold: 0.08 });
    events.forEach((e, i) => { e.el.classList.add('cc-reveal'); e.el.style.setProperty('--cc-d', (i % 6) * 70 + 'ms'); io.observe(e.el); });
  }

  function bindKeys() {
    document.addEventListener('keydown', e => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) || e.target.isContentEditable;
      if (modal && !modal.hidden) {
        if (e.key === 'Escape') return closeModal();
        if (e.key === 'Tab') {
          const f = $$('button:not([disabled]),a[href]', modal).filter(n => !n.hidden);
          if (!f.length) return;
          const first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
        return;
      }
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) { e.preventDefault(); searchInput.focus(); }
      else if (e.key === 'Escape' && document.activeElement === searchInput) { searchInput.value = ''; state.q = ''; apply(); searchInput.blur(); }
    });
  }

  /* ------------------------------------------------------------------ init */
  function init() {
    const cards = findCards();
    events = cards.map(parse).filter(e => e.date);
    if (!events.length) {
      if (window.console) console.info('[CampusConnect Interactive] No event cards found. Set window.CC_CONFIG = { cardSelector: ".your-card-class" } before loading interactive.js');
      return;
    }
    grid = events[0].el.parentElement;
    canReorder = events.every(e => e.el.parentElement === grid);
    countEl = $$('body *').filter(n => !n.children.length && /^\s*\d+\s+events?\s*$/i.test(n.textContent) && !n.closest('.cc-ui'))[0] || null;

    buildToolbar();
    events.forEach(enhance);
    buildModal();
    buildChrome();
    buildHero();
    wireExploreButton();
    bindKeys();
    apply(true);
    reveal();

    setInterval(() => events.forEach(updateChip), 30000);
    setInterval(() => { tickModal(); updateNext(); }, 1000);

    const hash = decodeURIComponent((location.hash || '').slice(1));
    const deep = hash && events.filter(e => e.id === hash)[0];
    if (deep) openModal(deep);

    window.CampusConnectUI = { toast, confetti, events, open: id => { const e = events.filter(x => x.id === id)[0]; if (e) openModal(e); } };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
