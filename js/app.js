/* Rummage: search by digging. Open a bag, pull things out of the pile, throw them aside,
   pick up what you're after. */
import { Pile, prepare } from './pile3d.js';
import { lookFor, srcFor } from './looks.js';

// ---------- helpers ----------
const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const shuffle = arr => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const normDeg = d => ((d % 360) + 540) % 360 - 180;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const buzz = pattern => { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (_) { /* no haptics */ } };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } }
};
const cancelAnims = node => { if (node.getAnimations) node.getAnimations().forEach(a => a.cancel()); };

const el = {
  app: $('app'),
  closet: $('closet'), bags: $('bags'), closetMeta: $('closetMeta'), fineprint: $('fineprint'),
  closetBasket: $('closetBasket'), closetBasketCount: $('closetBasketCount'),
  pile: $('pile'), back: $('backBtn'), bagName: $('bagName'), bagMeta: $('bagMeta'),
  basketBtn: $('basketBtn'), basketCount: $('basketCount'),
  rim: $('rim'), stage: $('stage'), canvas: $('pileCanvas'), hint: $('gestureHint'), loading: $('stageLoading'),
  target: $('targetCard'), targetThumb: $('targetThumb'), targetLabel: $('targetLabel'),
  targetName: $('targetName'), warmth: $('warmth'), warmthText: $('warmthText'),
  shake: $('shakeBtn'), shakeLabel: $('shakeLabel'), heldTag: $('heldTag'),
  inspect: $('inspect'), inspectBackdrop: $('inspectBackdrop'), inspectArt: $('inspectArt'),
  inspectEyebrow: $('inspectEyebrow'), inspectName: $('inspectName'), inspectSpecs: $('inspectSpecs'),
  toss: $('tossBtn'), keep: $('keepBtn'),
  sheet: $('basketSheet'), sheetBackdrop: $('sheetBackdrop'), sheetClose: $('sheetClose'),
  basketList: $('basketList'),
  toast: $('toast')
};

// ---------- wardrobe: your photos if there are any, otherwise the sample drawings ----------
const DATA = window.RUMMAGE_DATA;
const PHOTOS = Array.isArray(window.RUMMAGE_PHOTOS) ? window.RUMMAGE_PHOTOS : [];
const usingPhotos = PHOTOS.length > 0;
const BAGS = DATA.bags
  .map(b => ({ ...b, items: usingPhotos ? PHOTOS.filter(p => (p.bag || 'everyday') === b.id).map(p => ({ ...p })) : b.items }))
  .filter(b => b.items.length);
BAGS.forEach(b => b.items.forEach(it => { it.bag = b; it.kept = false; }));
const allItems = BAGS.flatMap(b => b.items);
const basket = [];

let pile = null;
let bag = null;
let opening = false;
let inspecting = null, busy = false;
let lastTouch = 0, lastTwitch = 0, twitchUntil = 0, warmthLevel = 0;
let hintSeen = store.get('rummage.hint.throw') === '1';
let hintTimer = 0, toastTimer = 0;
const WARMTH = ['', 'Buried deep', 'Under a few things', 'Peeking out', 'Right on top'];

// Start loading the physics engine while you look at the bags
prepare().catch(() => {});

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

const img = item => `<img src="${esc(srcFor(item))}" alt="" draggable="false">`;

function renderCloset() {
  const total = allItems.filter(i => !i.kept).length;
  el.closetMeta.textContent = `${BAGS.length} ${BAGS.length === 1 ? 'bag' : 'bags'} · ${total} pieces`;
  el.fineprint.textContent = usingPhotos ? 'Prototype · your clothes' : 'Prototype · sample drawings until your photos are in';
  el.bags.innerHTML = BAGS.map(b => {
    const left = b.items.filter(i => !i.kept);
    const peeks = left.slice(0, 3).map((it, k) => `<span class="peek peek-${k}">${img(it)}</span>`).join('');
    return `<li><button class="bag" type="button" data-bag="${b.id}" style="${weaveStyle(b)}" aria-label="Open ${esc(b.name)}, ${left.length} pieces">` +
      `<span class="bag-peeks" aria-hidden="true">${peeks}</span>` +
      `<span class="bag-body"></span>` +
      handleSVG(b) +
      `<span class="bag-label"><span><strong>${esc(b.name)}</strong><small>${left.length} pieces · ${esc(b.blurb)}</small></span>` +
      `<span class="bag-go" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span></span>` +
      `</button></li>`;
  }).join('');
  updateCounts();
}

// ---------- opening and closing a bag ----------
function ensurePile() {
  if (pile) return pile;
  pile = new Pile(el.canvas, {
    blocked: () => !!inspecting || busy,
    onTouch: () => { lastTouch = performance.now(); },
    onLift: piece => { buzz(6); dismissHint(); showHeld(piece); },
    onHoldMove: (piece, x, y) => moveHeld(x, y),
    onRelease: (piece, speed) => {
      hideHeld();
      if (speed > 8) buzz(10);
      // pulled the thing you wanted out and let go gently: take a proper look at it
      if (bag && bag.target === piece.item && !bag.targetFound && speed < 3) openInspect(piece);
    },
    onTap: piece => openInspect(piece),
    onCover: (cover, target, inBag) => updateWarmth(cover, false, inBag),
    onCount: (inside, out) => { updateBagMeta(inside, out); updateShakeButton(inside, out); }
  });
  return pile;
}

async function openBag(b) {
  if (bag || opening || !b) return;
  opening = true;
  bag = b;
  el.pile.setAttribute('style', weaveStyle(b));
  el.bagName.textContent = b.name;
  el.closet.classList.add('leaving');
  el.pile.hidden = false;
  el.loading.hidden = false;
  void el.pile.offsetWidth;
  el.pile.classList.add('in');
  setTimeout(() => { if (bag === b) el.closet.hidden = true; }, 340);

  try {
    ensurePile();
    const avail = b.items.filter(i => !i.kept);
    let order = avail;
    if (!b.saved) {
      // first time in: the thing you're after starts near the bottom of the heap
      order = shuffle(avail);
      if (order.length) {
        b.target = order[Math.floor(Math.random() * order.length)];
        b.targetFound = false;
        order.splice(order.indexOf(b.target), 1);
        order.splice(1 + Math.floor(Math.random() * Math.max(1, order.length * 0.25)), 0, b.target);
      }
    }
    const looks = await Promise.all(order.map(lookFor));
    if (bag !== b) return;
    const floor = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ECEBE7';
    await pile.open(b, looks, b.saved || null, floor);
    if (bag !== b) return;
    pile.targetId = b.target && !b.target.kept ? b.target.id : null;
    if (!b.target && pile.count) setTimeout(() => pickTarget(false), 1200);
    warmthLevel = 0;
    updateDock();
    updateBagMeta();
    lastTouch = lastTwitch = performance.now();
    showHint();
  } catch (err) {
    console.error(err);
    toast('This phone could not open the 3D bag');
  } finally {
    el.loading.hidden = true;
    opening = false;
  }
}

function closeBag() {
  if (!bag || inspecting || opening) return;
  bag.saved = pile.snapshot();
  pile.close();
  bag = null;
  renderCloset();
  el.closet.hidden = false;
  void el.closet.offsetWidth;
  el.closet.classList.remove('leaving');
  el.pile.classList.remove('in');
  setTimeout(() => { if (!bag) el.pile.hidden = true; }, 340);
}

// ---------- what you're looking for ----------
function pickTarget(announce) {
  if (!bag || !pile) return;
  const others = pile.pieces.filter(p => !p.hidden && p.item !== bag.target);
  const stillIn = others.filter(p => pile.inBag(p));
  const pool = stillIn.length ? stillIn : others;
  if (!pool.length) return;
  const buried = pool.filter(p => p.cover > 0.5);
  const from = buried.length ? buried : pool;
  const pick = from[Math.floor(Math.random() * from.length)];
  bag.target = pick.item;
  bag.targetFound = false;
  pile.targetId = pick.item.id;
  warmthLevel = 0;
  lastTwitch = performance.now();
  updateDock();
  updateWarmth(pick.cover);
  if (announce) toast(`Now looking for: ${pick.item.name}`);
}

function updateDock() {
  const t = bag && bag.target;
  el.target.classList.toggle('found', !!(t && bag.targetFound));
  if (!t) {
    el.targetThumb.innerHTML = '';
    delete el.targetThumb.dataset.id;
    el.targetLabel.textContent = pile && pile.count ? 'Looking for' : 'Empty bag';
    el.targetName.textContent = pile && pile.count ? 'Picking something…' : 'Nothing left in here';
    el.warmthText.textContent = pile && pile.count ? '' : 'Put something back from your basket';
    return;
  }
  if (el.targetThumb.dataset.id !== t.id) {
    el.targetThumb.innerHTML = img(t);
    el.targetThumb.dataset.id = t.id;
  }
  el.targetName.textContent = t.name;
  if (bag.targetFound) {
    el.targetLabel.textContent = 'Found it';
    el.warmthText.textContent = t.kept ? 'In your basket · tap for another' : 'Tap to look for something else';
  } else {
    el.targetLabel.textContent = 'Looking for';
    const p = pile && pile.find(t.id);
    if (p) updateWarmth(p.cover, true, pile.inBag(p));
  }
}

function updateWarmth(cover, force, inBag = true) {
  if (!bag || !bag.target || bag.targetFound) return;
  const lvl = !inBag ? 5 : cover > 0.7 ? 1 : cover > 0.4 ? 2 : cover > 0.1 ? 3 : 4;
  if (lvl === warmthLevel && !force) return;
  if (warmthLevel && lvl > warmthLevel) buzz(4);
  warmthLevel = lvl;
  el.warmth.dataset.level = String(Math.min(4, lvl));
  if (performance.now() > twitchUntil) {
    el.warmthText.textContent = lvl === 5 ? 'You threw it out. It’s on the floor' : WARMTH[lvl];
  }
}

// ---------- the piece in your hand ----------
let heldRect = null;
function showHeld(piece) {
  heldRect = el.stage.getBoundingClientRect();
  const isTarget = bag && bag.target === piece.item && !bag.targetFound;
  el.heldTag.classList.toggle('is-target', !!isTarget);
  el.heldTag.textContent = isTarget ? `That’s it! ${piece.item.name}` : piece.item.name;
  el.heldTag.hidden = false;
  if (isTarget) buzz([8, 40, 8]);
}

function moveHeld(x, y) {
  if (el.heldTag.hidden || !heldRect) return;
  el.heldTag.style.transform = `translate(${Math.round(x - heldRect.left)}px, ${Math.round(y - heldRect.top)}px) translate(-50%, -100%)`;
}

function hideHeld() {
  el.heldTag.hidden = true;
}

// Shake while there's a pile; once it's nearly all on the floor, tip it back in
let refillMode = false;
function updateShakeButton(inside, out) {
  const want = inside <= 2 && out > 0;
  if (want === refillMode) return;
  refillMode = want;
  el.shakeLabel.textContent = want ? 'Refill' : 'Shake';
  el.shake.setAttribute('aria-label', want ? 'Put everything back in the bag' : 'Shake the bag');
}

/** Leave the pile alone for a while and the thing you want rustles under the others. */
setInterval(() => {
  if (!bag || !pile || !bag.target || bag.targetFound || inspecting || opening) return;
  const now = performance.now();
  if (now - lastTouch < 7000 || now - lastTwitch < 7000) return;
  const p = pile.find(bag.target.id);
  if (!p || p.hidden || p.cover < 0.3 || !pile.inBag(p)) return;
  lastTwitch = now;
  pile.twitch(p);
  twitchUntil = now + 2000;
  el.warmthText.textContent = 'Something moved…';
  el.warmth.classList.add('twitch');
  setTimeout(() => {
    el.warmth.classList.remove('twitch');
    updateWarmth(p.cover, true);
  }, 2000);
}, 500);

// ---------- picking something up ----------
function openInspect(p) {
  if (inspecting || busy || !bag) return;
  inspecting = p;
  const it = p.item;
  const isTarget = bag.target === it;
  if (isTarget) bag.targetFound = true;

  const specs = [['From', bag.name]];
  if (it.fabric) specs.push(['Fabric', it.fabric]);
  if (it.size) specs.push(['Size', it.size]);
  el.inspect.classList.toggle('found', isTarget);
  el.inspectEyebrow.textContent = isTarget ? 'Found it' : `Picked up from ${bag.name}`;
  el.inspectName.textContent = it.name;
  el.inspectSpecs.innerHTML =
    specs.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('') +
    `<div><dt>Colours</dt><dd class="swatches">${p.look.colors.map(c => `<i style="--c:${c}"></i>`).join('')}</dd></div>`;

  const info = pile.screenInfo(p);
  pile.hide(p);
  el.inspectArt.innerHTML = img(it);
  el.inspect.hidden = false;
  const ar = el.inspectArt.getBoundingClientRect();
  const fx = info.x - (ar.left + ar.width / 2), fy = info.y - (ar.top + ar.height / 2);
  void el.inspect.offsetWidth;
  el.inspect.classList.add('open');
  el.inspectArt.animate([
    { transform: `translate(${fx}px, ${fy}px) rotate(${normDeg(info.angle)}deg) scale(${info.longest / ar.width})` },
    { transform: 'none' }
  ], { duration: reduceMotion.matches ? 1 : 520, easing: 'cubic-bezier(.18,.9,.22,1.04)' });

  buzz(10);
  if (isTarget) {
    updateDock();
    setTimeout(() => burst(p.look.colors), 260);
  }
}

function tossBack() {
  const p = inspecting;
  if (!p || busy) return;
  busy = true;
  cancelAnims(el.inspectArt);
  const r = el.stage.getBoundingClientRect(), ar = el.inspectArt.getBoundingClientRect();
  const tx = r.left + r.width / 2 - (ar.left + ar.width / 2);
  const ty = r.top + r.height * 0.45 - (ar.top + ar.height / 2);
  el.inspect.classList.remove('open');
  const anim = el.inspectArt.animate([
    { transform: 'none', opacity: 1 },
    { transform: `translate(${tx}px, ${ty}px) rotate(${rand(-40, 40)}deg) scale(.55)`, opacity: 0 }
  ], { duration: reduceMotion.matches ? 1 : 320, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
  anim.onfinish = () => {
    pile.dropBack(p);
    finishInspect();
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
    pile.remove(p);
    it.kept = true;
    basket.push(it);
    if (bag.target === it) pile.targetId = null;
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
  lastTouch = performance.now();
  updateDock();
}

function burst(colors) {
  if (reduceMotion.matches || !inspecting) return;
  const r = el.inspectArt.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const cols = colors.concat('#ffffff');
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

// ---------- shaking ----------
function shakeBag() {
  if (!bag || !pile || inspecting || opening || !pile.count) return;
  lastTouch = performance.now();
  if (refillMode) {
    const n = pile.refill();
    if (n) toast(`${n} ${n === 1 ? 'piece' : 'pieces'} back in the bag`);
    return;
  }
  pile.shake();
  el.rim.classList.remove('shaking');
  void el.rim.offsetWidth;
  el.rim.classList.add('shaking');
  buzz([14, 50, 14]);
  dismissHint();
}

// ---------- basket ----------
function updateCounts() {
  el.basketCount.textContent = basket.length;
  el.closetBasketCount.textContent = basket.length;
}

function updateBagMeta(inside, out) {
  if (!bag || !pile) return;
  if (inside === undefined) { inside = pile.inBagCount; out = pile.count - inside; }
  const kept = bag.items.filter(i => i.kept).length;
  el.bagMeta.textContent = `${inside} in the bag${out ? ` · ${out} on the floor` : ''}${kept ? ` · ${kept} kept` : ''}`;
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
    `<li><span class="thumb">${img(it)}</span>` +
    `<span><strong>${esc(it.name)}</strong><small>${esc(it.bag.name)}${it.size ? ' · ' + esc(it.size) : ''}</small></span>` +
    `<button type="button" data-return="${esc(it.id)}">Put back</button></li>`
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

async function putBack(id) {
  const it = basket.find(i => i.id === id);
  if (!it) return;
  basket.splice(basket.indexOf(it), 1);
  it.kept = false;
  updateCounts();
  renderBasket();
  if (!el.closet.hidden) renderCloset();
  toast(`${it.name} is back in ${it.bag.name}`);
  if (bag === it.bag && pile) {
    const look = await lookFor(it);
    if (bag !== it.bag) return;
    pile.add(look);
    if (bag.target === it) pile.targetId = it.id;
    if (!bag.target) pickTarget(false);
    updateBagMeta();
    updateDock();
  }
}

// ---------- first-run hint and toast ----------
function showHint() {
  if (hintSeen) return;
  el.hint.hidden = false;
  el.hint.classList.remove('gone');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(dismissHint, 7000);
}

function dismissHint() {
  if (el.hint.hidden || el.hint.classList.contains('gone')) return;
  el.hint.classList.add('gone');
  hintSeen = true;
  store.set('rummage.hint.throw', '1');
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
  if (btn) openBag(BAGS.find(b => b.id === btn.dataset.bag));
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
  if (!bag || !pile || !pile.count || inspecting) return;
  pickTarget(true);
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!el.sheet.hidden) closeBasket();
  else if (inspecting) tossBack();
  else if (bag) closeBag();
});

window.addEventListener('resize', () => { if (pile && bag) pile.resize(); });

renderCloset();
