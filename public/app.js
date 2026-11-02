// 일기장: 처음부터 펼친 책. 편집모드에서는 보이는 그 자리에서 바로 글을 고치고, 저장하면 글자만 바뀐다.
// 일기 하나의 글은 쪽을 빈칸 없이 이어서 채운다. 새 일기는 맨 앞 쪽에서 시작하고 기존 일기는 다음 쪽으로 밀린다.
(() => {
  /** 폭이 좁거나(세로 폰) 높이가 낮으면(가로 폰) 폰 화면 */
  const PHONE_QUERY = '(max-width: 719px), (max-height: 500px)';
  const PORTRAIT_QUERY = '(orientation: portrait)';
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const FONT = '16px "Noto Serif KR"';

  const $ = (id) => document.getElementById(id);
  const reader = $('reader');
  const bookEl = $('book');
  const modeBtn = $('mode');
  const newBtn = $('new');
  const msg = $('msg');

  /** 일기 글들 (맨 앞이 가장 최근) */
  let entries = [];
  /** slices[e] = e번째 일기를 쪽 크기로 나눈 글. 이어 붙이면 원래 글과 똑같다 */
  let slices = [];
  /** 쪽마다 { entry: 일기 번호(-1 = 짝 맞춤 빈 쪽), start: 일기 글에서 이 쪽이 시작하는 자리, text } */
  let layout = [];
  let editing = false;
  let dirty = false;
  let composing = false; // 한글 조합 중에는 글을 옮기지 않는다 (조합이 깨진다)
  let flip = null;
  let areas = [];
  /** 쪽마다 노란 표시 층 */
  let hls = [];
  /** 노란색으로 칠할 검색어 (소문자, 없으면 null) */
  let word = null;
  /** 지금 칠해 둔 쪽 번호들 (보이는 쪽과 그 옆 쪽만 칠한다) */
  let painted = new Set();
  /** 화면 모양: { kind: 'pc' | 'up'(세로 폰) | 'side'(가로 폰), spread: 양쪽 펼침인지, w·h: 쪽 크기(px) } */
  let view = null;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  /**
   * PC: 늘 같은 비율(530x600)의 펼침면.
   * 폰: 화면을 꽉 채우는 쪽 — 세로는 한 쪽, 가로는 양쪽 펼침. 글자는 폰에서 읽기 좋은 크기(px)가 되게 쪽 너비 비율로 정한다.
   * 글자·여백이 모두 쪽 너비 비율(cqw)이라, 쪽 크기를 정하면 그 화면에 맞게 쪽을 다시 나눈다.
   */
  function computeView() {
    const box = bookEl.getBoundingClientRect();
    if (!window.matchMedia(PHONE_QUERY).matches) return { kind: 'pc', spread: true, w: 530, h: 600, fs: 2.85 };
    if (box.height > box.width) {
      const ratio = clamp(box.width / box.height, 0.5, 0.8);
      const w = Math.min(box.width, box.height * ratio);
      return { kind: 'up', spread: false, w: Math.round(w), h: Math.round(w / ratio), fs: (15 / w) * 100 };
    }
    const ratio = clamp(box.width / 2 / box.height, 0.6, 1.3);
    const w = Math.min(box.width / 2, box.height * ratio);
    return { kind: 'side', spread: true, w: Math.round(w), h: Math.round(w / ratio), fs: (13.5 / w) * 100 };
  }

  function applyView() {
    view = computeView();
    const root = document.documentElement;
    root.dataset.view = view.kind;
    root.style.setProperty('--fs', `${view.fs.toFixed(3)}cqw`);
    measure.style.width = `${view.w}px`;
    measure.style.height = `${view.h}px`;
  }

  // ---------- 쪽에 글이 다 들어가는지 재기 ----------
  const measure = el('div', 'page measure');
  const measureInner = el('div', 'inner');
  const measureText = el('textarea', 'text');
  measureInner.append(measureText, el('div', 'num'));
  measure.append(measureInner);
  document.body.append(measure);

  // 쪽 끝의 줄바꿈·빈칸은 자리를 차지하지 않는 것으로 친다 (문단 끝 빈 줄 때문에 마지막 낱말이 다음 쪽으로 밀리지 않게)
  const fits = (text) => {
    measureText.value = text.trimEnd();
    return measureText.scrollHeight <= measureText.clientHeight;
  };

  /** 넘치는 글을 [이 쪽에 들어갈 글, 나머지] 로 나눈다. 낱말 단위, 낱말 하나가 너무 길면 글자 단위 */
  function split(text) {
    const maxFit = (units) => {
      let lo = 0;
      let hi = units.length - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fits(units.slice(0, mid).join(''))) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    let units = text.match(/\S+\s*|\s+/g) || [];
    let n = maxFit(units);
    if (n === 0) {
      units = Array.from(text);
      n = Math.max(1, maxFit(units));
    }
    return [units.slice(0, n).join(''), units.slice(n).join('')];
  }

  /** 일기 하나를 앞 쪽부터 꽉 채워 쪽으로 나눈다 */
  function paginate(text) {
    const parts = [];
    let rest = text;
    while (!fits(rest)) {
      const [keep, next] = split(rest);
      parts.push(keep);
      rest = next;
    }
    parts.push(rest);
    return parts;
  }

  function buildLayout() {
    layout = [];
    slices.forEach((parts, entry) => {
      let start = 0;
      for (const text of parts) {
        layout.push({ entry, start, text });
        start += text.length;
      }
    });
    while (layout.length < 2 || layout.length % 2) layout.push({ entry: -1, start: 0, text: '' });
  }

  // ---------- 책 그리기 ----------
  function render(start) {
    if (flip) flip.destroy();
    bookEl.replaceChildren();

    areas = [];
    hls = [];
    const nodes = layout.map((p, i) => {
      const side = !view.spread ? 'shadeSingle' : i % 2 === 0 ? 'shadeLeft' : 'shadeRight';
      const writable = editing && p.entry >= 0;
      const page = el('div', 'page');
      const inner = el('div', 'inner');
      const ta = el('textarea', 'text');
      ta.value = p.text;
      ta.readOnly = !writable;
      ta.tabIndex = writable ? 0 : -1;
      ta.spellcheck = false;
      ta.setAttribute('aria-label', `${i + 1}쪽`);
      ta.addEventListener('input', (e) => {
        if (!e.isComposing) onEdit(i);
        else dirty = true;
      });
      ta.addEventListener('compositionstart', () => {
        composing = true;
        clearHit(); // 글이 바뀌면 표시 자리가 어긋나므로 없앤다
      });
      ta.addEventListener('compositionend', () => {
        composing = false;
        setTimeout(() => { if (!composing && document.activeElement === ta) onEdit(i); });
      });
      // 넘친 줄을 보이려고 글 칸이 스스로 위로 밀리지 않게 (넘친 글은 곧 다음 쪽으로 옮긴다)
      ta.addEventListener('scroll', () => { ta.scrollTop = 0; });
      const hl = el('div', 'hl');
      inner.append(hl, ta, el('div', 'num', String(i + 1)));
      page.append(inner, el('div', `shade ${side}`));
      areas.push(ta);
      hls.push(hl);
      return page;
    });
    painted = new Set();

    flip = new St.PageFlip(bookEl, {
      width: view.w,
      height: view.h,
      size: 'stretch',
      minWidth: 150,
      maxWidth: view.kind === 'pc' ? 900 : 2000,
      minHeight: 150,
      maxHeight: 2000,
      startPage: Math.min(Math.max(0, start), nodes.length - 1),
      showCover: false,
      singlePage: !view.spread,
      usePortrait: view.kind === 'pc', // 폰은 위에서 정한 대로(세로 한 쪽, 가로 펼침) 둔다
      drawShadow: true,
      maxShadowOpacity: 1,
      flippingTime: 300,
      showPageCorners: !editing,
      disableFlipByClick: true,
      mobileScrollSupport: false,
      useMouseEvents: !editing, // 편집모드에서는 끌어서 넘기기를 꺼야 글자를 누르고 고를 수 있다
    });
    flip.loadFromHTML(nodes);
    flip.on('flip', paintNear);
    paintNear();
  }

  /** i 쪽에서 검색어가 나온 자리를 모두 노란색으로 칠한다 (쪽 경계에 걸친 낱말도 앞뒤 쪽에 나눠 칠한다) */
  function paintPage(i) {
    const p = layout[i];
    const hl = hls[i];
    hl.replaceChildren();
    if (!word || p.entry < 0) return;
    const L = word.length;
    const from = Math.max(0, p.start - L + 1);
    const to = p.start + p.text.length;
    const lower = entries[p.entry].slice(from, to + L - 1).toLowerCase();
    const parts = [];
    let last = 0;
    for (let k = lower.indexOf(word); k >= 0 && from + k < to; k = lower.indexOf(word, k + L)) {
      const s = Math.max(from + k, p.start) - p.start;
      const e = Math.min(from + k + L, to) - p.start;
      parts.push(p.text.slice(last, s), el('mark', '', p.text.slice(s, e)));
      last = e;
    }
    if (parts.length) hl.append(...parts, p.text.slice(last));
  }

  /** 보이는 쪽과 바로 앞뒤 쪽(넘기는 동안 보이는 쪽)만 칠하고, 그 밖에 칠해 둔 쪽은 지운다. 쪽을 넘길 때마다 다시 한다 */
  function paintNear() {
    if (!flip) return;
    const cur = flip.getCurrentPageIndex();
    const spread = view.spread && flip.getOrientation() !== 'portrait';
    const base = spread ? Math.floor(cur / 2) * 2 : cur;
    const near = new Set();
    for (let i = base - (spread ? 2 : 1); i <= base + (spread ? 3 : 1); i += 1) {
      if (i >= 0 && i < layout.length && word) near.add(i);
    }
    painted.forEach((i) => { if (!near.has(i)) hls[i].replaceChildren(); });
    near.forEach(paintPage);
    painted = near;
  }

  function clearHit() {
    if (!word) return;
    word = null;
    paintNear();
  }

  /** 지금 화면에 보이는 쪽인지 */
  function isVisible(p) {
    const cur = flip.getCurrentPageIndex();
    if (!view.spread || flip.getOrientation() === 'portrait') return p === cur;
    return Math.floor(p / 2) === Math.floor(cur / 2);
  }

  /** i 쪽을 고쳤을 때: 그 일기 글을 다시 이어 붙여 쪽을 새로 채우고(넘치면 뒤로, 비면 당겨 옴), 글쓰던 자리를 따라간다 */
  function onEdit(i) {
    dirty = true;
    clearHit(); // 글이 바뀌면 표시 자리가 어긋나므로 없앤다
    const entry = layout[i].entry;
    let text = '';
    let caret = 0;
    layout.forEach((p, k) => {
      if (p.entry !== entry) return;
      if (k === i) caret = text.length + areas[k].selectionStart;
      text += areas[k].value;
    });
    entries[entry] = text;

    const before = slices[entry].length;
    slices[entry] = paginate(text);
    buildLayout();

    // 글쓰던 자리가 든 쪽: 그 일기에서 끝이 caret 이상인 첫 쪽
    const q = layout.findIndex((p) => p.entry === entry && caret <= p.start + p.text.length);
    if (slices[entry].length !== before) {
      render(q);
    } else {
      layout.forEach((p, k) => { if (areas[k].value !== p.text) areas[k].value = p.text; });
      if (!isVisible(q)) flip.turnToPage(q);
    }
    focusAt(q, caret - layout[q].start);
  }

  /** p 쪽 글 칸의 at 자리에 커서를 둔다. 책을 새로 그린 직후에는 쪽이 아직 안 보여 커서가 안 들어가므로 들어갈 때까지 몇 프레임 다시 한다 */
  function focusAt(p, at, tries = 30) {
    const ta = areas[p];
    ta.focus({ preventScroll: true });
    if (document.activeElement === ta) {
      ta.setSelectionRange(at, at);
      ta.scrollTop = 0;
    } else if (tries > 0) {
      requestAnimationFrame(() => { if (areas[p] === ta) focusAt(p, at, tries - 1); });
    }
  }

  // ---------- 편집모드 · 새 일기 · 저장 ----------
  /** 글 칸에 보이는 글을 일기 글로 옮긴다 (한글 조합이 막 끝나 아직 쪽을 다시 안 채운 글까지) */
  function syncEntries() {
    entries = entries.map((_, e) => layout.reduce((all, p, k) => (p.entry === e ? all + areas[k].value : all), ''));
  }

  async function save() {
    syncEntries();
    const out = entries.filter((t) => t.trim());
    modeBtn.disabled = true;
    newBtn.disabled = true;
    modeBtn.textContent = '저장 중…';
    try {
      const res = await fetch('/api/pages', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entries: out }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      modeBtn.disabled = false;
      newBtn.disabled = false;
      modeBtn.textContent = '저장';
      alert('저장하지 못했어요. 인터넷 연결을 확인하고 저장을 다시 눌러 주세요.');
      return;
    }
    const page = flip.getCurrentPageIndex();
    entries = out;
    slices = entries.map(paginate);
    buildLayout();
    dirty = false;
    editing = false;
    reader.classList.remove('editing');
    modeBtn.disabled = false;
    newBtn.disabled = false;
    modeBtn.textContent = '편집모드';
    render(page);
  }

  modeBtn.addEventListener('click', () => {
    if (editing) {
      save();
      return;
    }
    editing = true;
    if (!entries.length) {
      entries = [''];
      slices = [['']];
      buildLayout();
    }
    reader.classList.add('editing');
    modeBtn.textContent = '저장';
    render(flip.getCurrentPageIndex());
  });

  // 새 일기: 맨 앞 쪽에 빈 일기를 넣고, 기존 일기는 다음 쪽부터 이어진다
  newBtn.addEventListener('click', () => {
    syncEntries();
    if (entries[0] !== '') {
      entries.unshift('');
      slices = [[''], ...entries.slice(1).map(paginate)];
      buildLayout();
      dirty = true;
    }
    render(0);
    focusAt(0, 0);
  });

  // ---------- 검색: 엔터를 누르면 찾은 자리 목록을 팝업으로 띄우고, 누르면 그 쪽을 연다 ----------
  const popup = $('popup');
  const results = $('results');
  const searchInput = $('searchInput');

  /** 일기 e 의 at 번째 글자가 든 쪽 */
  const pageOf = (e, at) => {
    const i = layout.findIndex((p) => p.entry === e && at < p.start + p.text.length);
    return i >= 0 ? i : layout.findIndex((p) => p.entry === e);
  };

  function closePopup() {
    popup.hidden = true;
    searchInput.focus({ preventScroll: true });
  }

  function search(query) {
    if (!flip) return;
    if (editing) syncEntries();
    const q = query.toLowerCase();
    results.replaceChildren();
    let count = 0;
    entries.forEach((text, e) => {
      const lower = text.toLowerCase();
      const date = text.split('\n')[0].trim().slice(0, 20) || '(제목 없음)';
      for (let at = lower.indexOf(q); at >= 0; at = lower.indexOf(q, at + q.length)) {
        const page = pageOf(e, at);
        const from = Math.max(0, at - 15);
        const flat = (s) => s.replace(/\s+/g, ' ');
        const snippet = el('span', 'resultText');
        const mark = el('mark', '', text.slice(at, at + q.length));
        snippet.append((from > 0 ? '…' : '') + flat(text.slice(from, at)), mark, flat(text.slice(at + q.length, at + q.length + 60)));
        const btn = el('button');
        btn.type = 'button';
        btn.append(el('span', 'resultMeta', `${date} · ${page + 1}쪽`), snippet);
        btn.addEventListener('click', () => {
          popup.hidden = true;
          word = q;
          flip.turnToPage(page);
          paintNear();
        });
        const li = el('li');
        li.append(btn);
        results.append(li);
        count += 1;
      }
    });
    $('popupTitle').textContent = `"${query}" 검색 결과 ${count}개`;
    if (!count) results.append(el('li', 'resultEmpty', '찾는 글이 없어요.'));
    popup.hidden = false;
    const first = results.querySelector('button');
    (first || $('popupClose')).focus({ preventScroll: true });
  }

  $('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (query) search(query);
  });
  // 검색칸을 비우면(지우거나 × 를 누르면) 노란 표시도 없앤다
  searchInput.addEventListener('input', () => { if (!searchInput.value.trim()) clearHit(); });
  $('popupClose').addEventListener('click', closePopup);
  popup.addEventListener('click', (e) => { if (e.target === popup) closePopup(); });
  popup.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopup(); });

  $('prev').addEventListener('click', () => flip.flipPrev());
  $('next').addEventListener('click', () => flip.flipNext());
  window.addEventListener('keydown', (e) => {
    if (editing || !flip || !popup.hidden || e.target === searchInput) return;
    if (e.key === 'ArrowRight') flip.flipNext();
    if (e.key === 'ArrowLeft') flip.flipPrev();
  });
  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });
  // 폰을 돌리거나(세로↔가로) PC↔폰 크기가 바뀌면: 새 쪽 크기로 쪽을 다시 나누고, 보던 글이 든 쪽을 연다
  function relayout() {
    if (!flip) return;
    if (editing) syncEntries();
    const cur = layout[flip.getCurrentPageIndex()];
    applyView();
    slices = entries.map(paginate);
    buildLayout();
    let page = 0;
    if (cur && cur.entry >= 0) {
      const found = layout.findIndex((p) => p.entry === cur.entry && cur.start < p.start + Math.max(1, p.text.length));
      if (found >= 0) page = found;
    }
    render(page);
  }
  let relayoutTimer = 0;
  const scheduleRelayout = () => {
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(relayout, 150); // 돌린 뒤 화면 크기가 자리잡을 때까지 잠깐 기다린다
  };
  window.matchMedia(PHONE_QUERY).addEventListener('change', scheduleRelayout);
  window.matchMedia(PORTRAIT_QUERY).addEventListener('change', scheduleRelayout);

  /** 처음 버전(쪽 글 배열)으로 저장된 것은 이어진 글 하나로 합친다 */
  function readEntries(data) {
    if (data && Array.isArray(data.entries)) return data.entries.map(String);
    if (!Array.isArray(data)) return [];
    const text = data.map(String).reduce((all, p) => (all && p && !/\s$/.test(all) ? `${all}\n${p}` : all + p), '');
    return text.trim() ? [text] : [];
  }

  // ---------- 시작: 가장 최근 일기(첫 쪽)를 펼친다 ----------
  (async () => {
    try {
      const res = await fetch('/api/pages', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      entries = readEntries(await res.json());
      // 글꼴이 오기 전에 재면 쪽 나누기가 틀어진다. 일기에 쓰인 글자의 글꼴을 받아 둔다 (안 오면 3초 뒤 대체 글꼴로)
      await Promise.race([
        document.fonts.load(FONT, entries.join('') || '가').then(() => document.fonts.ready),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
      applyView();
      slices = entries.map(paginate);
      buildLayout();
      render(0);
      msg.hidden = true;
      modeBtn.disabled = false;
    } catch {
      msg.textContent = '일기장을 불러오지 못했어요. 새로고침해 주세요.';
    }
  })();
})();
