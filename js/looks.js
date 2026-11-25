/* What each piece looks like: its image (a photo cutout, or a sample drawing),
   an alpha map for touch and collision, and its main colours. */

const A = 48; // alpha map resolution
const cache = new Map();

/** Image URL for an item: the photo cutout, or the sample drawing as an SVG data URL. */
export function srcFor(item) {
  if (item.file) return item.file;
  if (!item._svgURL) {
    const svg = window.Garments.svg(item)
      .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" ');
    item._svgURL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  return item._svgURL;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load ' + src.slice(0, 80)));
    img.src = src;
  });
}

const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

async function build(item) {
  const img = await loadImage(srcFor(item));
  let image = img;
  let w = img.naturalWidth || 512, h = img.naturalHeight || 512;
  if (!item.file) {
    // rasterise the drawing so it can be a texture
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    c.getContext('2d').drawImage(img, 0, 0, 512, 512);
    image = c;
    w = h = 512;
  }

  const probe = document.createElement('canvas');
  probe.width = probe.height = A;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, A, A);
  const px = ctx.getImageData(0, 0, A, A).data;

  const alpha = new Uint8Array(A * A);
  const buckets = new Map();
  let opaque = 0;
  for (let i = 0; i < A * A; i++) {
    const a = px[i * 4 + 3];
    alpha[i] = a;
    if (a < 160) continue;
    opaque++;
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const s = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    s.n++; s.r += r; s.g += g; s.b += b;
    buckets.set(key, s);
  }
  const colors = [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
    .filter(s => s.n > opaque * 0.04)
    .map(s => hex(s.r / s.n, s.g / s.n, s.b / s.n));

  return {
    item,
    src: srcFor(item),
    image,
    w, h,
    A,
    alpha,
    opaqueFrac: Math.max(0.12, opaque / (A * A)),
    colors: colors.length ? colors : ['#888888']
  };
}

export function lookFor(item) {
  if (!cache.has(item.id)) cache.set(item.id, build(item));
  return cache.get(item.id);
}
