// fuckweaomods.xyz -- comment wall. No framework, no build step, no innerHTML.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const form = $('composer');
  const nameEl = $('name');
  const bodyEl = $('body');
  const hpEl = $('website');
  const sendEl = $('send');
  const countEl = $('count');
  const listEl = $('list');
  const moreEl = $('more');
  const toastEl = $('toast');
  const tpl = $('tpl-comment');

  let cursor = null;
  let loading = false;

  // ---------- helpers ----------
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;

  function ago(ms) {
    const d = Date.now() - ms;
    if (d < 0) return 'just now';
    if (d < 45000) return 'just now';
    if (d < HOUR) return Math.round(d / MIN) + 'm ago';
    if (d < DAY) return Math.round(d / HOUR) + 'h ago';
    if (d < 30 * DAY) return Math.round(d / DAY) + 'd ago';
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  let toastTimer;
  function toast(msg, ok) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('ok', !!ok);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3800);
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  // ---------- rendering ----------
  function node(row) {
    const el = tpl.content.firstElementChild.cloneNode(true);
    el.querySelector('.c-name').textContent = row.name;   // textContent, never innerHTML
    el.querySelector('.c-body').textContent = row.body;
    const t = el.querySelector('.c-time');
    t.dateTime = new Date(row.created_at).toISOString();
    t.title = new Date(row.created_at).toLocaleString();
    t.textContent = ago(row.created_at);
    t.dataset.ts = String(row.created_at);
    return el;
  }

  function skeleton(n) {
    clear(listEl);
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div');
      s.className = 'sk';
      listEl.appendChild(s);
    }
  }

  function emptyState() {
    clear(listEl);
    const d = document.createElement('div');
    d.className = 'empty';
    const b = document.createElement('strong');
    b.textContent = 'Nothing here yet.';
    d.appendChild(b);
    d.appendChild(document.createTextNode('Suspiciously quiet. Be the first one to get muted.'));
    listEl.appendChild(d);
  }

  function errorState(msg) {
    clear(listEl);
    const d = document.createElement('div');
    d.className = 'empty';
    const b = document.createElement('strong');
    b.textContent = "Couldn't load the wall.";
    d.appendChild(b);
    d.appendChild(document.createTextNode(msg));
    const retry = document.createElement('button');
    retry.className = 'more';
    retry.style.marginTop = '14px';
    retry.textContent = 'try again';
    retry.addEventListener('click', () => load(true));
    d.appendChild(document.createElement('br'));
    d.appendChild(retry);
    listEl.appendChild(d);
  }

  // tick relative timestamps so "just now" doesn't lie forever
  setInterval(() => {
    listEl.querySelectorAll('.c-time').forEach((t) => {
      const ts = Number(t.dataset.ts);
      if (ts) t.textContent = ago(ts);
    });
  }, 30000);

  // ---------- api ----------
  async function api(path, opts) {
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch { /* non-json error page */ }
    if (!res.ok) throw new Error((data && data.error) || 'http ' + res.status);
    return data;
  }

  async function load(first) {
    if (loading) return;
    loading = true;
    moreEl.disabled = true;
    if (first) {
      cursor = null;
      skeleton(3);
      listEl.setAttribute('aria-busy', 'true');
    }

    try {
      const q = new URLSearchParams({ limit: '50' });
      if (!first && cursor) q.set('before', cursor);
      const data = await api('/api/comments?' + q);

      if (first) clear(listEl);
      if (first && data.comments.length === 0) {
        emptyState();
      } else {
        const frag = document.createDocumentFragment();
        data.comments.forEach((row) => frag.appendChild(node(row)));
        listEl.appendChild(frag);
      }

      cursor = data.cursor;
      moreEl.hidden = !cursor;
    } catch (err) {
      if (first) errorState(err.message);
      else toast(err.message);
    } finally {
      loading = false;
      moreEl.disabled = false;
      listEl.setAttribute('aria-busy', 'false');
    }
  }

  // ---------- composer ----------
  function updateCount() {
    const n = bodyEl.value.length;
    countEl.textContent = n + '/500';
    countEl.classList.toggle('over', n > 500);
  }
  bodyEl.addEventListener('input', updateCount);
  updateCount();

  // ctrl/cmd + enter submits
  bodyEl.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') form.requestSubmit();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sendEl.disabled) return;

    const body = bodyEl.value.trim();
    if (!body) { toast('type something first'); bodyEl.focus(); return; }
    if (body.length > 500) { toast('keep it under 500 chars'); return; }

    sendEl.disabled = true;
    sendEl.textContent = 'posting';

    try {
      const row = await api('/api/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: nameEl.value, body, hp: hpEl.value }),
      });

      const wasEmpty = listEl.querySelector('.empty');
      if (wasEmpty) clear(listEl);
      listEl.insertBefore(node(row), listEl.firstChild);

      bodyEl.value = '';
      updateCount();
      toast('posted', true);
    } catch (err) {
      toast(err.message);
    } finally {
      sendEl.disabled = false;
      sendEl.textContent = 'post it';
    }
  });

  moreEl.addEventListener('click', () => load(false));

  load(true);
})();
