/* Rummage: search by digging. Open a bag, push pieces aside, pick up what you're after. */
(() => {
  'use strict';

  const DATA = window.RUMMAGE_DATA;
  const G = window.Garments;

  // ---------- helpers ----------
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const gauss = () => {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const shuffle = arr => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const normDeg = d => ((d % 360) + 540) % 360 - 180;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const buzz = pattern => { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (_) { /* no haptics */ } };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } }
  };
  const finishAnims = node => { if (node.getAnimations) node.getAnimations().forEach(a => a.finish()); };
  const cancelAnims = node => { if (node.getAnimations) node.getAnimations().forEach(a => a.cancel()); };

  const el = {
    app: $('app'),
    closet: $('closet'), bags: $('bags'), closetMeta: $('closetMeta'),
    closetBasket: $('closetBasket'), closetBasketCount: $('closetBasketCount'),
    pile: $('pile'), back: $('backBtn'), bagName: $('bagName'), bagMeta: $('bagMeta'),
    basketBtn: $('basketBtn'), basketCount: $('basketCount'),
    stage: $('stage'), pieces: $('pieces'), hint: $('gestureHint'),
    target: $('targetCard'), targetThumb: $('targetThumb'), targetLabel: $('targetLabel'),
    targetName: $('targetName'), warmth: $('warmth'), warmthText: $('warmthText'),
    shake: $('shakeBtn'),
    inspect: $('inspect'), inspectBackdrop: $('inspectBackdrop'), inspectArt: $('inspectArt'),
    inspectEyebrow: $('inspectEyebrow'), inspectName: $('inspectName'), inspectSpecs: $('inspectSpecs'),
    toss: $('tossBtn'), keep: $('keepBtn'),
    sheet: $('basketSheet'), sheetBackdrop: $('sheetBackdrop'), sheetClose: $('sheetClose'),
    basketList: $('basketList'),
    toast: $('toast')
  };

  // ---------- state ----------
  DATA.bags.forEach(b => b.items.forEach(it => { it.bag = b; it.kept = false; }));
  const allItems = DATA.bags.flatMap(b => b.items);
  const basket = [];

  let bag = null;          // the open bag
  let pieces = [];         // pieces in the open pile
  let zTop = 0;
  let W = 0, H = 0;        // stage size
  const drags = new Map(); // pointerId -> drag
  let raf = 0, lastFrame = 0, frameNo = 0, dirty = true;
  let lastTouch = 0, lastTwitch = 0, twitchUntil = 0, warmthLevel = 0;
  let inspecting = null, busy = false;
  let hintSeen = store.get('rummage.hint') === '1';
  let hintTimer = 0, toastTimer = 0;

  const WARMTH = ['', 'Buried deep', 'Under a few things', 'Peeking out', 'Right on top'];

  // ---------- closet ----------
  function weaveStyle(b) {
    let y = 0;
    const stops = b.weave.map(([c, h]) => {
      const s = `${c} ${y}px ${y + h}px`;
      y += h;
      return s;
    }).join(', ');
    return `--band: repeating-linear-gradient(180deg, ${stops}); --band-base: ${b.weave[0][0]}; --thread: ${b.thread}; --interior: ${b.interior}`;
  }

  function handleSVG(b) {
    const d = 'M18 46 C18 4, 114 4, 114 46';
    return `<svg class="bag-handle" viewBox="0 0 132 48" aria-hidden="true">` +
      `<path d="${d}" stroke="rgba(0,0,0,.22)" stroke-width="9" transform="translate(0 2.5)"/>` +
      `<path d="${d}" stroke="${b.thread}" stroke-width="8"/>` +
      `<path d="${d}" stroke="#fff" stroke-opacity=".55" stroke-width="8" stroke-dasharray="2 4"/>` +
      `</svg>`;
  }

  function renderCloset() {
    const total = allItems.filter(i => !i.kept).length;
    el.closetMeta.textContent = `${DATA.bags.length} bags · ${total} pieces`;
    el.bags.innerHTML = DATA.bags.map(b => {
      const left = b.items.filter(i => !i.kept);
      const peeks = left.slice(0, 3).map((it, k) => `<span class="peek peek-${k}">${G.svg(it)}</span>`).join('');
      return `<li><button class="bag" type="button" data-bag="${b.id}" style="${weaveStyle(b)}" aria-label="Open ${b.name}, ${left.length} pieces">` +
        `<span class="bag-peeks" aria-hidden="true">${peeks}</span>` +
        `<span class="bag-body"></span>` +
        handleSVG(b) +
        `<span class="bag-label"><span><strong>${b.name}</strong><small>${left.length} pieces · ${b.blurb}</small></span>` +
        `<span class="bag-go" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span></span>` +
        `</button></li>`;
    }).join('');
    updateCounts();
  }

  // ---------- opening and closing a bag ----------
  function openBag(b) {
    if (bag || !b) return;
    bag = b;
    el.pile.setAttribute('style', weaveStyle(b));
    el.bagName.textContent = b.name;
    el.closet.classList.add('leaving');
    el.pile.hidden = false;
    void el.pile.offsetWidth;
    el.pile.classList.add('in');
    setTimeout(() => { if (bag === b) el.closet.hidden = true; }, 340);

    buildPile(b);
    lastTouch = lastTwitch = performance.now();
    showHint();
    if (!raf) {
      lastFrame = performance.now();
      raf = requestAnimationFrame(tick);
    }
  }

  function closeBag() {
    if (!bag || inspecting) return;
    bag.saved = {};
    for (const p of pieces) bag.saved[p.item.id] = { x: p.x / W, y: p.y / H, rot: p.rot, z: p.z };
    drags.clear();
    cancelAnimationFrame(raf);
    raf = 0;
    bag = null;

    renderCloset();
    el.closet.hidden = false;
    void el.closet.offsetWidth;
    el.closet.classList.remove('leaving');
    el.pile.classList.remove('in');
    setTimeout(() => {
      if (bag) return;
      el.pile.hidden = true;
      el.pieces.textContent = '';
      pieces = [];
    }, 340);
  }

  function measure() {
    W = el.stage.clientWidth;
    H = el.stage.clientHeight;
  }

  function baseSize() {
    return Math.round(clamp(Math.min(W * 0.47, H * 0.3), 96, 200));
  }

  function buildPile(b) {
    measure();
    el.pieces.textContent = '';
    pieces = [];
    zTop = 0;
    drags.clear();
    warmthLevel = 0;

    const avail = b.items.filter(i => !i.kept);
    const saved = b.saved;
    const base = baseSize();
    let order;

    if (saved) {
      const z = it => (saved[it.id] ? saved[it.id].z : 1e9);
      order = avail.slice().sort((a, c) => z(a) - z(c));
    } else {
      // First time in: the thing you're after starts near the bottom of the heap
      order = shuffle(avail);
      if (order.length) {
        b.target = order[Math.floor(Math.random() * order.length)];
        b.targetFound = false;
        order.splice(order.indexOf(b.target), 1);
        order.splice(1 + Math.floor(Math.random() * Math.max(1, order.length * 0.25)), 0, b.target);
      }
    }

    const fresh = [];
    order.forEach((it, i) => {
      const p = makePiece(it, base);
      const s = saved && saved[it.id];
      if (s) {
        p.x = s.x * W; p.y = s.y * H; p.rot = s.rot;
        bounds(p, false);
      } else {
        heapSpot(p, i, order.length, it === b.target);
        fresh.push(p);
      }
      addPiece(p);
    });

    computeCover();
    if (!b.target && pieces.length) pickTarget(false);
    updateDock();
    updateBagMeta();
    if (fresh.length && !reduceMotion.matches) spill(fresh);
  }

  function heapSpot(p, i, n, isTarget) {
    const spread = isTarget ? 0.07 : 0.17 - 0.06 * (i / Math.max(1, n - 1));
    p.x = W * 0.5 + gauss() * W * spread;
    p.y = H * 0.47 + gauss() * H * spread * 0.9;
    p.rot = rand(-38, 38);
    bounds(p, false);
  }

  function makePiece(item, base) {
    const size = Math.round(base * G.scale(item.type));
    const node = document.createElement('div');
    node.className = 'piece';
    node.style.width = node.style.height = size + 'px';
    node.innerHTML = `<div class="lift">${G.svg(item, { shadow: true, depth: true, hit: true })}</div>`;
    const p = {
      item, el: node, size,
      svg: node.querySelector('svg'),
      dp: node.querySelector('.dp'),
      x: 0, y: 0, rot: 0, vx: 0, vy: 0, vr: 0, z: 0,
      cover: 0, shown: -1, held: null
    };
    node._piece = p;
    return p;
  }

  function addPiece(p) {
    p.z = ++zTop;
    p.el.style.zIndex = p.z;
    pieces.push(p);
    el.pieces.appendChild(p.el);
    place(p);
  }

  function place(p) {
    p.el.style.transform =
      `translate3d(${(p.x - p.size / 2).toFixed(1)}px, ${(p.y - p.size / 2).toFixed(1)}px, 0) rotate(${p.rot.toFixed(2)}deg)`;
  }

  function raise(p) {
    if (p.z === zTop) return;
    p.z = ++zTop;
    p.el.style.zIndex = p.z;
    dirty = true;
  }

  function bounds(p, bounce) {
    // up to a quarter of a piece can be pushed past the rim, like stuff shoved to the side of a bag
    const m = p.size * 0.24;
    if (p.x < m) { p.x = m; if (bounce) p.vx = Math.abs(p.vx) * 0.35; }
    else if (p.x > W - m) { p.x = W - m; if (bounce) p.vx = -Math.abs(p.vx) * 0.35; }
    if (p.y < m) { p.y = m; if (bounce) p.vy = Math.abs(p.vy) * 0.35; }
    else if (p.y > H - m) { p.y = H - m; if (bounce) p.vy = -Math.abs(p.vy) * 0.35; }
  }

  function spill(list) {
    list.forEach((p, i) => {
      p.svg.animate([
        { transform: `scale(1.6) rotate(${rand(-25, 25).toFixed(1)}deg)`, opacity: 0 },
        { opacity: 1, offset: 0.4 },
        { transform: 'scale(1) rotate(0deg)', opacity: 1 }
      ], { duration: 560, delay: 140 + i * 55, easing: 'cubic-bezier(.3,.9,.3,1)', fill: 'backwards' });
    });
  }

  // ---------- geometry: what's on top of what ----------
  function inside(q, wx, wy) {
    const dx = wx - q.x, dy = wy - q.y;
    const lim = q.size * 0.72;
    if (dx > lim || dx < -lim || dy > lim || dy < -lim) return false;
    const a = -q.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), k = 120 / q.size;
    return G.contains(q.item.type, (dx * c - dy * s) * k + 60, (dx * s + dy * c) * k + 60);
  }

  function topmostAt(x, y, exclude) {
    let best = null;
    for (const q of pieces) {
      if (q === exclude || q === inspecting) continue;
      if ((!best || q.z > best.z) && inside(q, x, y)) best = q;
    }
    return best;
  }

  /** How much of each piece is hidden under others (0–1). Buried pieces sit in shadow. */
  function computeCover() {
    for (const p of pieces) {
      if (p === inspecting) continue;
      const reach = p.size * 0.72;
      const above = [];
      for (const q of pieces) {
        if (q === p || q.z < p.z || q === inspecting) continue;
        const r = reach + q.size * 0.72;
        if (Math.abs(q.x - p.x) < r && Math.abs(q.y - p.y) < r) above.push(q);
      }
      if (!above.length) {
        p.cover = 0;
      } else {
        const pts = G.samples(p.item.type);
        const th = p.rot * Math.PI / 180, c = Math.cos(th), s = Math.sin(th), k = p.size / 120;
        let hit = 0;
        for (let i = 0; i < pts.length; i++) {
          const lx = (pts[i][0] - 60) * k, ly = (pts[i][1] - 60) * k;
          const wx = p.x + lx * c - ly * s, wy = p.y + lx * s + ly * c;
          for (let j = 0; j < above.length; j++) {
            if (inside(above[j], wx, wy)) { hit++; break; }
          }
        }
        p.cover = hit / pts.length;
      }
      if (Math.abs(p.cover - p.shown) > 0.015) {
        p.shown = p.cover;
        p.dp.style.fillOpacity = (p.cover * 0.6).toFixed(3);
      }
    }
  }

  // ---------- the loop ----------
  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(3, (now - lastFrame) / 16.667 || 1);
    lastFrame = now;
    let moved = false;

    for (const p of pieces) {
      if (p === inspecting) continue;
      if (p.held) {
        // tilt with the drag, like cloth swinging from where you pinched it
        const d = p.held;
        d.vx *= Math.pow(0.82, dt);
        const goal = d.baseRot + clamp(d.vx * 16, -18, 18);
        const next = p.rot + (goal - p.rot) * Math.min(1, 0.22 * dt);
        if (Math.abs(next - p.rot) > 0.01) {
          p.rot = next;
          place(p);
          moved = true;
        }
        continue;
      }
      if (Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.vr) < 0.03) {
        p.vx = p.vy = p.vr = 0;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const f = Math.pow(0.9, dt), fr = Math.pow(0.87, dt);
      p.vx *= f; p.vy *= f; p.vr *= fr;
      bounds(p, true);
      place(p);
      moved = true;
    }

    if (moved) dirty = true;
    if (dirty && (++frameNo & 1) === 0) {
      dirty = false;
      computeCover();
      updateWarmth(false);
    }
    idleHint(now);
  }

  // ---------- digging (pointer input) ----------
  function stagePoint(e, rect) {
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  el.stage.addEventListener('pointerdown', e => {
    const node = e.target.closest ? e.target.closest('.piece') : null;
    if (!node || inspecting || busy) return;
    const p = node._piece;
    if (!p || p.held) return;
    e.preventDefault();
    try { el.stage.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
    const rect = el.stage.getBoundingClientRect();
    const pt = stagePoint(e, rect);
    finishAnims(p.svg);
    p.vx = p.vy = p.vr = 0;
    const d = {
      p, rect,
      sx: pt.x, sy: pt.y,
      ox: pt.x - p.x, oy: pt.y - p.y,
      t0: e.timeStamp, lt: e.timeStamp, lx: pt.x,
      vx: 0, baseRot: p.rot,
      moved: false, travel: 0, carry: [],
      samples: [{ x: pt.x, y: pt.y, t: e.timeStamp }]
    };
    p.held = d;
    drags.set(e.pointerId, d);
    lastTouch = performance.now();
  });

  el.stage.addEventListener('pointermove', e => {
    const d = drags.get(e.pointerId);
    if (!d) return;
    const p = d.p;
    const pt = stagePoint(e, d.rect);

    if (!d.moved) {
      if (Math.hypot(pt.x - d.sx, pt.y - d.sy) < 7) return;
      d.moved = true;
      // whatever was lying on it gets dragged along a little as you pull it out
      d.carry = pieces.filter(q =>
        q !== p && q.z > p.z && !q.held && q !== inspecting &&
        Math.hypot(q.x - p.x, q.y - p.y) < (q.size + p.size) * 0.32);
      raise(p);
      p.el.classList.add('lifted');
      buzz(5);
      dismissHint();
    }

    const nx = pt.x - d.ox, ny = pt.y - d.oy;
    const dx = nx - p.x, dy = ny - p.y;
    const dtm = Math.max(1, e.timeStamp - d.lt);
    d.vx = d.vx * 0.6 + ((pt.x - d.lx) / dtm) * 0.4;
    d.lt = e.timeStamp;
    d.lx = pt.x;

    if (d.travel < 110) {
      for (const q of d.carry) {
        if (q.held) continue;
        q.x += dx * 0.22; q.y += dy * 0.22;
        bounds(q, false); place(q);
      }
    }
    d.travel += Math.hypot(dx, dy);

    // cloth friction: the piece underneath shifts slightly as you slide over it
    const under = topmostAt(pt.x, pt.y, p);
    if (under && !under.held) {
      under.x += dx * 0.1; under.y += dy * 0.1;
      bounds(under, false); place(under);
    }

    p.x = nx; p.y = ny;
    bounds(p, false);
    place(p);

    d.samples.push({ x: pt.x, y: pt.y, t: e.timeStamp });
    if (d.samples.length > 8) d.samples.shift();
    dirty = true;
    lastTouch = performance.now();
  });

  function endDrag(e) {
    const d = drags.get(e.pointerId);
    if (!d) return;
    drags.delete(e.pointerId);
    const p = d.p;
    p.held = null;
    p.el.classList.remove('lifted');
    lastTouch = performance.now();

    if (!d.moved) {
      if (e.type === 'pointerup' && e.timeStamp - d.t0 < 500) openInspect(p);
      return;
    }

    // flick: carry on with the finger's speed, spin from where it was held
    const recent = d.samples.filter(s => e.timeStamp - s.t < 100);
    if (recent.length >= 2) {
      const a = recent[0], b = recent[recent.length - 1];
      const span = Math.max(10, b.t - a.t);
      let vx = (b.x - a.x) / span * 16.667;
      let vy = (b.y - a.y) / span * 16.667;
      const sp = Math.hypot(vx, vy);
      if (sp > 55) { vx *= 55 / sp; vy *= 55 / sp; }
      p.vx = vx; p.vy = vy;
      p.vr = clamp((d.ox * vy - d.oy * vx) / (p.size * p.size) * 40, -12, 12);
      if (sp > 20) buzz(8);
    }
    dirty = true;
  }

  el.stage.addEventListener('pointerup', endDrag);
  el.stage.addEventListener('pointercancel', endDrag);
  el.stage.addEventListener('lostpointercapture', endDrag);
  el.stage.addEventListener('contextmenu', e => e.preventDefault());

  // ---------- shaking the bag ----------
  function shakeBag() {
    if (!bag || inspecting || !pieces.length) return;
    lastTouch = performance.now();
    el.stage.classList.remove('shaking');
    void el.stage.offsetWidth;
    el.stage.classList.add('shaking');
    for (const p of shuffle(pieces.filter(q => !q.held))) {
      p.z = ++zTop;
      p.el.style.zIndex = p.z;
      p.vx = rand(-7, 7) + (W * 0.5 - p.x) * 0.035;
      p.vy = rand(-7, 7) + (H * 0.47 - p.y) * 0.035;
      p.vr = rand(-5, 5);
    }
    for (const d of drags.values()) raise(d.p);
    buzz([14, 50, 14]);
    dismissHint();
    dirty = true;
  }

  // ---------- what you're looking for ----------
  function pickTarget(announce) {
    if (!bag) return;
    const pool = pieces.filter(p => p.item !== bag.target);
    if (!pool.length) return;
    const buried = pool.filter(p => p.cover > 0.5);
    const from = buried.length ? buried : pool;
    const pick = from[Math.floor(Math.random() * from.length)];
    bag.target = pick.item;
    bag.targetFound = false;
    warmthLevel = 0;
    lastTwitch = performance.now();
    updateDock();
    if (announce) toast(`Now looking for: ${pick.item.name}`);
  }

  function updateDock() {
    const t = bag && bag.target;
    el.target.classList.toggle('found', !!(t && bag.targetFound));
    if (!t) {
      el.targetThumb.innerHTML = '';
      delete el.targetThumb.dataset.id;
      el.targetLabel.textContent = 'Empty bag';
      el.targetName.textContent = 'Nothing left in here';
      el.warmthText.textContent = 'Put something back from your basket';
      return;
    }
    if (el.targetThumb.dataset.id !== t.id) {
      el.targetThumb.innerHTML = G.svg(t);
      el.targetThumb.dataset.id = t.id;
    }
    el.targetName.textContent = t.name;
    if (bag.targetFound) {
      el.targetLabel.textContent = 'Found it';
      el.warmthText.textContent = t.kept ? 'In your basket · tap for another' : 'Tap to look for something else';
    } else {
      el.targetLabel.textContent = 'Looking for';
      updateWarmth(true);
    }
  }

  function updateWarmth(force) {
    if (!bag || !bag.target || bag.targetFound) return;
    const p = pieces.find(q => q.item === bag.target);
    if (!p) return;
    const c = p.cover;
    const lvl = c > 0.7 ? 1 : c > 0.4 ? 2 : c > 0.1 ? 3 : 4;
    if (lvl === warmthLevel && !force) return;
    if (warmthLevel && lvl > warmthLevel) buzz(4);
    warmthLevel = lvl;
    el.warmth.dataset.level = String(lvl);
    if (performance.now() > twitchUntil) el.warmthText.textContent = WARMTH[lvl];
  }

  /** Leave the pile alone for a while and the thing you want gives a little twitch. */
  function idleHint(now) {
    if (!bag || !bag.target || bag.targetFound || inspecting || drags.size) return;
    if (now - lastTouch < 7000 || now - lastTwitch < 7000) return;
    const p = pieces.find(q => q.item === bag.target);
    if (!p || p.cover < 0.3) return;
    lastTwitch = now;
    const dir = Math.random() < 0.5 ? -1 : 1;
    p.vr += dir * 1.6;
    p.vx += rand(-1, 1);
    p.vy += rand(-1, 1);
    setTimeout(() => { p.vr -= dir * 1.9; }, 150);
    setTimeout(() => { p.vr += dir * 0.9; }, 300);
    twitchUntil = now + 2000;
    el.warmthText.textContent = 'Something moved…';
    el.warmth.classList.add('twitch');
    setTimeout(() => {
      el.warmth.classList.remove('twitch');
      updateWarmth(true);
    }, 2000);
  }

  // ---------- picking something up ----------
  function openInspect(p) {
    if (inspecting || busy || !bag) return;
    inspecting = p;
    const it = p.item;
    const isTarget = bag.target === it;
    if (isTarget) bag.targetFound = true;

    el.inspect.classList.toggle('found', isTarget);
    el.inspectEyebrow.textContent = isTarget ? 'Found it' : `Picked up from ${bag.name}`;
    el.inspectName.textContent = it.name;
    el.inspectSpecs.innerHTML =
      `<div><dt>Fabric</dt><dd>${it.fabric}</dd></div>` +
      `<div><dt>Size</dt><dd>${it.size}</dd></div>` +
      `<div><dt>Colours</dt><dd class="swatches">${G.colors(it).map(c => `<i style="--c:${c}"></i>`).join('')}</dd></div>`;
    el.inspectArt.innerHTML = G.svg(it);
    el.inspect.hidden = false;
    p.el.style.visibility = 'hidden';

    const rect = el.stage.getBoundingClientRect();
    const ar = el.inspectArt.getBoundingClientRect();
    const fx = rect.left + p.x - (ar.left + ar.width / 2);
    const fy = rect.top + p.y - (ar.top + ar.height / 2);
    void el.inspect.offsetWidth;
    el.inspect.classList.add('open');
    el.inspectArt.animate([
      { transform: `translate(${fx}px, ${fy}px) rotate(${normDeg(p.rot)}deg) scale(${p.size / ar.width})` },
      { transform: 'none' }
    ], { duration: reduceMotion.matches ? 1 : 520, easing: 'cubic-bezier(.18,.9,.22,1.04)' });

    buzz(10);
    if (isTarget) {
      updateDock();
      setTimeout(() => burst(it), 260);
    }
    dirty = true;
  }

  function tossBack() {
    const p = inspecting;
    if (!p || busy) return;
    busy = true;
    cancelAnims(el.inspectArt);
    // it lands back on top, somewhere near the middle
    p.x = W * 0.5 + rand(-0.2, 0.2) * W;
    p.y = H * rand(0.32, 0.62);
    p.rot = rand(-35, 35);
    bounds(p, false);
    raise(p);
    place(p);

    const rect = el.stage.getBoundingClientRect();
    const ar = el.inspectArt.getBoundingClientRect();
    const tx = rect.left + p.x - (ar.left + ar.width / 2);
    const ty = rect.top + p.y - (ar.top + ar.height / 2);
    el.inspect.classList.remove('open');
    const anim = el.inspectArt.animate([
      { transform: 'none' },
      { transform: `translate(${tx}px, ${ty}px) rotate(${p.rot}deg) scale(${p.size / ar.width})` }
    ], { duration: reduceMotion.matches ? 1 : 420, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' });
    anim.onfinish = () => {
      p.el.style.visibility = '';
      finishInspect();
      p.svg.animate([{ transform: 'scale(1.05)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
    };
  }

  function keepIt() {
    const p = inspecting;
    if (!p || busy) return;
    busy = true;
    cancelAnims(el.inspectArt);
    const ar = el.inspectArt.getBoundingClientRect();
    const br = el.basketBtn.getBoundingClientRect();
    const tx = br.left + br.width / 2 - (ar.left + ar.width / 2);
    const ty = br.top + br.height / 2 - (ar.top + ar.height / 2);
    el.inspect.classList.remove('open');
    const anim = el.inspectArt.animate([
      { transform: 'none', opacity: 1 },
      { transform: `translate(${tx * 0.5}px, ${ty * 0.5 - 40}px) scale(.45) rotate(-8deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${tx}px, ${ty}px) scale(.08) rotate(12deg)`, opacity: 0.2 }
    ], { duration: reduceMotion.matches ? 1 : 560, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' });
    anim.onfinish = () => {
      const it = p.item;
      pieces.splice(pieces.indexOf(p), 1);
      p.el.remove();
      it.kept = true;
      basket.push(it);
      finishInspect();
      updateCounts();
      updateBagMeta();
      bumpBasket();
      toast(`${it.name} is in your basket`);
    };
  }

  function finishInspect() {
    el.inspect.hidden = true;
    cancelAnims(el.inspectArt);
    el.inspectArt.innerHTML = '';
    inspecting = null;
    busy = false;
    dirty = true;
    lastTouch = performance.now();
    updateDock();
  }

  function burst(it) {
    if (reduceMotion.matches || !inspecting) return;
    const r = el.inspectArt.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const cols = G.colors(it).concat('#ffffff');
    for (let i = 0; i < 24; i++) {
      const s = document.createElement('i');
      s.className = 'snip';
      s.style.background = cols[i % cols.length];
      s.style.left = cx + 'px';
      s.style.top = cy + 'px';
      el.app.appendChild(s);
      const a = rand(0, Math.PI * 2), dist = rand(100, 200);
      s.animate([
        { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
        { transform: `translate(${Math.cos(a) * dist}px, ${Math.sin(a) * dist + 70}px) rotate(${rand(-400, 400)}deg) scale(.6)`, opacity: 0 }
      ], { duration: rand(750, 1150), easing: 'cubic-bezier(.15,.7,.3,1)' }).onfinish = () => s.remove();
    }
    buzz([10, 40, 18]);
  }

  // ---------- basket ----------
  function updateCounts() {
    el.basketCount.textContent = basket.length;
    el.closetBasketCount.textContent = basket.length;
  }

  function updateBagMeta() {
    if (!bag) return;
    const n = pieces.length;
    const kept = bag.items.filter(i => i.kept).length;
    el.bagMeta.textContent = `${n} ${n === 1 ? 'piece' : 'pieces'}${kept ? ` · ${kept} kept` : ''}`;
  }

  function bumpBasket() {
    el.basketBtn.classList.add('bump');
    setTimeout(() => el.basketBtn.classList.remove('bump'), 260);
  }

  function renderBasket() {
    if (!basket.length) {
      el.basketList.innerHTML =
        `<li class="basket-empty"><strong>Nothing kept yet.</strong>Pick something up from a bag and tap Keep it.</li>`;
      return;
    }
    el.basketList.innerHTML = basket.map(it =>
      `<li><span class="thumb">${G.svg(it)}</span>` +
      `<span><strong>${it.name}</strong><small>${it.bag.name} · ${it.size}</small></span>` +
      `<button type="button" data-return="${it.id}">Put back</button></li>`
    ).join('');
  }

  function openBasket() {
    if (inspecting) return;
    renderBasket();
    el.sheet.hidden = false;
    void el.sheet.offsetWidth;
    el.sheet.classList.add('open');
  }

  function closeBasket() {
    el.sheet.classList.remove('open');
    setTimeout(() => { if (!el.sheet.classList.contains('open')) el.sheet.hidden = true; }, 380);
  }

  function putBack(id) {
    const it = basket.find(i => i.id === id);
    if (!it) return;
    basket.splice(basket.indexOf(it), 1);
    it.kept = false;
    if (bag === it.bag) {
      const p = makePiece(it, baseSize());
      p.x = W * 0.5 + rand(-0.18, 0.18) * W;
      p.y = H * rand(0.3, 0.6);
      p.rot = rand(-30, 30);
      bounds(p, false);
      addPiece(p);
      if (!reduceMotion.matches) spill([p]);
      if (!bag.target) pickTarget(false);
      dirty = true;
      updateBagMeta();
      updateDock();
    }
    updateCounts();
    renderBasket();
    if (!el.closet.hidden) renderCloset();
    toast(`${it.name} is back in ${it.bag.name}`);
  }

  // ---------- first-run hint and toast ----------
  function showHint() {
    if (hintSeen) return;
    el.hint.hidden = false;
    el.hint.classList.remove('gone');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(dismissHint, 6500);
  }

  function dismissHint() {
    if (el.hint.hidden || el.hint.classList.contains('gone')) return;
    el.hint.classList.add('gone');
    hintSeen = true;
    store.set('rummage.hint', '1');
    setTimeout(() => { el.hint.hidden = true; }, 450);
  }

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2200);
  }

  // ---------- wiring ----------
  el.bags.addEventListener('click', e => {
    const btn = e.target.closest('.bag');
    if (btn) openBag(DATA.bags.find(b => b.id === btn.dataset.bag));
  });
  el.back.addEventListener('click', closeBag);
  el.basketBtn.addEventListener('click', openBasket);
  el.closetBasket.addEventListener('click', openBasket);
  el.sheetClose.addEventListener('click', closeBasket);
  el.sheetBackdrop.addEventListener('click', closeBasket);
  el.basketList.addEventListener('click', e => {
    const btn = e.target.closest('[data-return]');
    if (btn) putBack(btn.dataset.return);
  });
  el.toss.addEventListener('click', tossBack);
  el.keep.addEventListener('click', keepIt);
  el.inspectBackdrop.addEventListener('click', tossBack);
  el.shake.addEventListener('click', shakeBag);
  el.target.addEventListener('click', () => {
    if (!bag || !pieces.length) return;
    pickTarget(true);
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!el.sheet.hidden) closeBasket();
    else if (inspecting) tossBack();
    else if (bag) closeBag();
  });

  function onResize() {
    if (!bag) return;
    const oW = W, oH = H;
    measure();
    if (!oW || !oH || (oW === W && oH === H)) return;
    for (const p of pieces) {
      p.x *= W / oW;
      p.y *= H / oH;
      bounds(p, false);
      place(p);
    }
    dirty = true;
  }
  window.addEventListener('resize', onResize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(onResize);

  renderCloset();
})();
