/* Garment drawing: silhouettes in a 120×120 box, fabric patterns,
   and the geometry the pile uses for hit-testing and coverage. */
window.Garments = (() => {
  'use strict';

  // d: silhouette. lines: [path, style]. scale: size relative to a tee.
  const SHAPES = {
    tee: {
      scale: 1,
      d: 'M33 15 L48 8 Q60 19 72 8 L87 15 L111 37 L98 53 L88 45 L88 112 Q60 115 32 112 L32 45 L22 53 L9 37 Z',
      lines: [
        ['M46.5 9 Q60 25 73.5 9', 'rib'],
        ['M35 107.5 Q60 110.5 85 107.5', 'stitch'],
        ['M24 50 L33 43', 'stitch'],
        ['M87 43 L96 50', 'stitch'],
        ['M54 46 Q61 74 52 102', 'fold'],
        ['M74 60 Q70 80 76 98', 'crease']
      ]
    },
    longsleeve: {
      scale: 1.02,
      d: 'M33 15 L48 8 Q60 18 72 8 L87 15 L101 27 L114 95 Q107 99 99 97 L89 52 L89 112 Q60 115 31 112 L31 52 L21 97 Q13 99 6 95 L19 27 Z',
      lines: [
        ['M46.5 9 Q60 23 73.5 9', 'rib'],
        ['M100 91 L113 88', 'rib'],
        ['M7 88 L20 91', 'rib'],
        ['M34 107.5 Q60 110.5 86 107.5', 'stitch'],
        ['M31 52 L31 30', 'crease'],
        ['M89 52 L89 30', 'crease'],
        ['M55 44 Q62 74 53 102', 'fold']
      ]
    },
    hoodie: {
      scale: 1.06,
      d: 'M32 15 L48 8 Q60 18 72 8 L88 15 L102 27 L115 95 Q108 99 100 97 L90 52 L90 112 Q60 115 30 112 L30 52 L20 97 Q12 99 5 95 L18 27 Z M45 13 Q43 0 60 0 Q77 0 75 13 Q60 23 45 13 Z',
      lines: [
        ['M48 12 Q60 19 72 12', 'rib'],
        ['M55 15 L54 33', 'cord'],
        ['M65 15 L66 33', 'cord'],
        ['M42 76 L78 76 L84 100 L36 100 Z', 'edge'],
        ['M101 91 L114 88', 'rib'],
        ['M6 88 L19 91', 'rib'],
        ['M33 106 L87 106', 'rib']
      ]
    },
    trousers: {
      scale: 1.06,
      d: 'M31 6 L89 6 L95 114 L69 114 L60 42 L51 114 L25 114 Z',
      lines: [
        ['M31.5 14 L88.5 14', 'rib'],
        ['M60 14 Q61 28 58 37', 'stitch'],
        ['M34 14 Q41 24 33 29', 'stitch'],
        ['M86 14 Q79 24 87 29', 'stitch'],
        ['M43 40 L39 110', 'crease'],
        ['M77 40 L81 110', 'crease']
      ]
    },
    joggers: {
      scale: 1.04,
      d: 'M30 6 L90 6 L93 102 L92 114 L70 114 L69 102 L60 44 L51 102 L50 114 L28 114 L27 102 Z',
      lines: [
        ['M30.5 15 L89.5 15', 'rib'],
        ['M57 15 Q55 24 58 28', 'cord'],
        ['M63 15 Q65 24 62 28', 'cord'],
        ['M27.5 103 L50.5 103', 'rib'],
        ['M69.5 103 L92.5 103', 'rib'],
        ['M42 34 Q36 66 40 98', 'fold'],
        ['M80 34 Q84 66 79 98', 'crease']
      ]
    },
    shorts: {
      scale: 0.86,
      d: 'M25 16 L95 16 L102 82 Q84 88 66 86 L60 52 L54 86 Q36 88 18 82 Z',
      lines: [
        ['M25.5 25 L94.5 25', 'rib'],
        ['M60 25 Q61 38 58 46', 'stitch'],
        ['M20 77 Q36 82 53 80', 'stitch'],
        ['M67 80 Q84 82 100 77', 'stitch'],
        ['M40 32 Q36 56 41 76', 'fold']
      ]
    },
    skirt: {
      scale: 0.92,
      d: 'M38 14 L82 14 L105 104 Q60 115 15 104 Z',
      lines: [
        ['M38.5 22 L81.5 22', 'rib'],
        ['M50 22 L41 108', 'crease'],
        ['M60 22 L60 110', 'crease'],
        ['M70 22 L79 108', 'crease'],
        ['M18 99 Q60 109 102 99', 'stitch']
      ]
    },
    dress: {
      scale: 1.08,
      d: 'M42 4 L49 4 Q60 18 71 4 L78 4 Q79 22 87 30 Q80 40 82 50 L106 112 Q60 120 14 112 L38 50 Q40 40 33 30 Q41 22 42 4 Z',
      lines: [
        ['M38 50 Q60 55 82 50', 'stitch'],
        ['M50 58 Q46 84 36 110', 'fold'],
        ['M70 58 Q76 86 86 111', 'crease'],
        ['M17 107 Q60 116 103 107', 'stitch']
      ]
    },
    kaftan: {
      scale: 1.12,
      d: 'M20 12 L47 9 Q60 22 73 9 L100 12 L117 60 Q106 65 94 63 L93 114 Q60 117 27 114 L26 63 Q14 65 3 60 Z',
      lines: [
        ['M47 10 Q60 31 73 10', 'trim'],
        ['M60 27 L60 60', 'trim'],
        ['M60 36 L60 36.1 M60 45 L60 45.1 M60 54 L60 54.1', 'trimdots'],
        ['M26 63 L26 30', 'crease'],
        ['M94 63 L94 30', 'crease'],
        ['M42 70 Q38 92 44 112', 'fold']
      ]
    },
    fabric: {
      scale: 0.98,
      d: 'M12 24 Q12 20 16 20 L104 20 Q108 20 108 24 L108 94 Q108 98 104 98 L16 98 Q12 98 12 94 Z M15 98 L105 98 L103 103 L17 103 Z M18 103 L102 103 L100 107 L20 107 Z',
      lines: [
        ['M12 27 L108 27', 'stitch'],
        ['M12 59 L108 59', 'crease'],
        ['M12 61 L108 61', 'fold'],
        ['M15 98 L105 98', 'edge'],
        ['M18 103 L102 103', 'edge']
      ]
    },
    scarf: {
      scale: 1.14,
      d: 'M5 46 Q33 36 60 46 Q87 56 115 46 L115 74 Q87 84 60 74 Q33 64 5 74 Z',
      lines: [
        ['M5 60 Q33 50 60 60 Q87 70 115 60', 'fold'],
        ['M115 49 L120 49 M115 54 L120 54 M115 59 L120.5 59 M115 64 L120 64 M115 69 L120 69', 'fringe'],
        ['M0 51 L5 51 M0 56 L5 56 M-0.5 61 L5 61 M0 66 L5 66 M0 71 L5 71', 'fringe']
      ]
    },
    socks: {
      scale: 0.76,
      d: 'M18 6 L40 6 L40 62 Q40 70 48 74 L70 84 Q83 90 77 102 Q71 111 58 105 L26 90 Q16 85 18 72 Z M40 10 L62 10 L62 66 Q62 74 70 78 L92 88 Q105 94 99 106 Q93 115 80 109 L48 94 Q38 89 40 76 Z',
      lines: [
        ['M40 10 L62 10 L62 66 Q62 74 70 78 L92 88 Q105 94 99 106 Q93 115 80 109 L48 94 Q38 89 40 76 Z', 'edge'],
        ['M18.5 15 L39.5 15', 'rib'],
        ['M40.5 19 L61.5 19', 'rib']
      ]
    }
  };

  let uid = 0;
  const paths = {};
  const samples = {};
  const probe = document.createElement('canvas').getContext('2d');

  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function pattern(id, p) {
    const c = p.colors;
    const tf = p.rot ? ` patternTransform="rotate(${p.rot})"` : '';
    const wrap = (w, h, inner) =>
      `<pattern id="${id}" width="${w}" height="${h}" patternUnits="userSpaceOnUse"${tf}>${inner}</pattern>`;

    switch (p.kind) {
      case 'stripe': {
        const s = p.size || 10;
        return wrap(s, s, `<rect width="${s}" height="${s}" fill="${c[0]}"/><rect width="${s}" height="${s * (p.ratio || 0.5)}" fill="${c[1]}"/>`);
      }
      case 'gingham': {
        const s = p.size || 8;
        return wrap(s * 2, s * 2,
          `<rect width="${s * 2}" height="${s * 2}" fill="${c[0]}"/>` +
          `<rect width="${s}" height="${s * 2}" fill="${c[1]}" fill-opacity=".45"/>` +
          `<rect width="${s * 2}" height="${s}" fill="${c[1]}" fill-opacity=".45"/>`);
      }
      case 'denim':
        return wrap(5, 5,
          `<rect width="5" height="5" fill="${c[0]}"/>` +
          `<path d="M0 5L5 0M-1 1L1 -1M4 6L6 4" stroke="${c[1]}" stroke-opacity=".35" stroke-width="1.1"/>`);
      case 'wax':
        return wrap(30, 30,
          `<rect width="30" height="30" fill="${c[0]}"/>` +
          `<circle cx="15" cy="15" r="11" fill="${c[1]}"/>` +
          `<circle cx="15" cy="15" r="8.6" fill="none" stroke="${c[0]}" stroke-width="1.2" stroke-dasharray="2 1.6"/>` +
          `<circle cx="15" cy="15" r="6.4" fill="${c[2]}"/>` +
          `<circle cx="15" cy="15" r="2.6" fill="${c[3] || c[0]}"/>` +
          `<circle cx="0" cy="0" r="5" fill="${c[2]}"/><circle cx="30" cy="0" r="5" fill="${c[2]}"/>` +
          `<circle cx="0" cy="30" r="5" fill="${c[2]}"/><circle cx="30" cy="30" r="5" fill="${c[2]}"/>` +
          `<circle cx="0" cy="0" r="2" fill="${c[3] || c[1]}"/><circle cx="30" cy="0" r="2" fill="${c[3] || c[1]}"/>` +
          `<circle cx="0" cy="30" r="2" fill="${c[3] || c[1]}"/><circle cx="30" cy="30" r="2" fill="${c[3] || c[1]}"/>`);
      case 'leaf':
        return wrap(26, 26,
          `<rect width="26" height="26" fill="${c[0]}"/>` +
          `<path d="M13 2 Q23 13 13 24 Q3 13 13 2Z" fill="${c[1]}"/>` +
          `<path d="M13 6 L13 20" stroke="${c[2]}" stroke-width="1.4"/>` +
          `<path d="M13 10 L9 7 M13 14 L17 11 M13 17 L9.5 14" stroke="${c[2]}" stroke-width=".9"/>` +
          `<circle cx="0" cy="0" r="3" fill="${c[2]}"/><circle cx="26" cy="0" r="3" fill="${c[2]}"/>` +
          `<circle cx="0" cy="26" r="3" fill="${c[2]}"/><circle cx="26" cy="26" r="3" fill="${c[2]}"/>`);
      case 'adire':
        return wrap(22, 22,
          `<rect width="22" height="22" fill="${c[0]}"/>` +
          `<circle cx="11" cy="11" r="6" fill="none" stroke="${c[1]}" stroke-opacity=".75" stroke-width="1.6" stroke-dasharray="1.6 1.1"/>` +
          `<circle cx="11" cy="11" r="2" fill="${c[1]}" fill-opacity=".7"/>` +
          `<circle cx="0" cy="0" r="3" fill="none" stroke="${c[1]}" stroke-opacity=".5" stroke-width="1"/>` +
          `<circle cx="22" cy="0" r="3" fill="none" stroke="${c[1]}" stroke-opacity=".5" stroke-width="1"/>` +
          `<circle cx="0" cy="22" r="3" fill="none" stroke="${c[1]}" stroke-opacity=".5" stroke-width="1"/>` +
          `<circle cx="22" cy="22" r="3" fill="none" stroke="${c[1]}" stroke-opacity=".5" stroke-width="1"/>`);
      case 'kente':
        return wrap(40, 40,
          `<rect width="40" height="40" fill="${c[0]}"/>` +
          `<rect width="40" height="6" fill="${c[1]}"/>` +
          `<rect x="20" y="8" width="20" height="10" fill="${c[1]}"/>` +
          `<rect x="24" y="12" width="12" height="2" fill="${c[3]}"/>` +
          `<rect y="20" width="40" height="3" fill="${c[3]}"/>` +
          `<rect y="26" width="20" height="14" fill="${c[2]}"/>` +
          `<path d="M2 31 L6 35 L10 31 L14 35 L18 31" stroke="${c[0]}" stroke-width="1.5" fill="none"/>` +
          `<rect x="22" y="28" width="16" height="2" fill="${c[1]}"/><rect x="22" y="34" width="16" height="2" fill="${c[1]}"/>`);
      case 'lace':
        return wrap(14, 14,
          `<rect width="14" height="14" fill="${c[0]}"/>` +
          `<circle cx="7" cy="7" r="4.2" fill="none" stroke="${c[1]}" stroke-width=".9"/>` +
          `<circle cx="7" cy="7" r="1.6" fill="none" stroke="${c[1]}" stroke-width=".7"/>` +
          `<circle cx="0" cy="0" r="1.8" fill="none" stroke="${c[1]}" stroke-width=".7"/>` +
          `<circle cx="14" cy="0" r="1.8" fill="none" stroke="${c[1]}" stroke-width=".7"/>` +
          `<circle cx="0" cy="14" r="1.8" fill="none" stroke="${c[1]}" stroke-width=".7"/>` +
          `<circle cx="14" cy="14" r="1.8" fill="none" stroke="${c[1]}" stroke-width=".7"/>`);
      case 'sequin':
        return wrap(7, 7,
          `<rect width="7" height="7" fill="${c[0]}"/>` +
          `<circle cx="1.75" cy="1.75" r="1.35" fill="${c[1]}" fill-opacity=".85"/>` +
          `<circle cx="5.25" cy="5.25" r="1.35" fill="${c[1]}" fill-opacity=".55"/>` +
          `<circle cx="1.35" cy="1.35" r=".45" fill="#fff" fill-opacity=".85"/>`);
      case 'mud':
        return wrap(24, 24,
          `<rect width="24" height="24" fill="${c[0]}"/>` +
          `<path d="M3 4 L9 4 M15 4 L21 4" stroke="${c[1]}" stroke-width="1.5"/>` +
          `<path d="M12 9 L12 16 M8.5 12.5 L15.5 12.5" stroke="${c[1]}" stroke-width="1.5"/>` +
          `<circle cx="3" cy="20" r="1" fill="${c[1]}"/><circle cx="8" cy="20" r="1" fill="${c[1]}"/>` +
          `<circle cx="16" cy="20" r="1" fill="${c[1]}"/><circle cx="21" cy="20" r="1" fill="${c[1]}"/>`);
      case 'aso':
        return wrap(8, 8,
          `<rect width="8" height="8" fill="${c[0]}"/>` +
          `<rect width="8" height="1.6" fill="${c[1]}" fill-opacity=".7"/>` +
          `<rect y="4.4" width="8" height=".8" fill="${c[2]}" fill-opacity=".55"/>`);
      case 'floral': {
        const petals = [0, 72, 144, 216, 288]
          .map(a => `<ellipse cx="0" cy="-5" rx="2.8" ry="5" fill="${c[1]}" transform="rotate(${a})"/>`).join('');
        return wrap(28, 28,
          `<rect width="28" height="28" fill="${c[0]}"/>` +
          `<g transform="translate(14 14)">${petals}<circle r="2.6" fill="${c[2]}"/></g>` +
          `<path d="M0 0 Q4 -4 7 0 Q4 4 0 0Z M28 28 Q24 24 21 28 Q24 32 28 28Z" fill="${c[3] || c[2]}" transform="translate(0 0)"/>` +
          `<path d="M28 0 Q24 4 21 0 M0 28 Q4 24 7 28" stroke="${c[3] || c[2]}" stroke-width="2" fill="none"/>`);
      }
      default: // solid, with a faint weave so flat colour still reads as cloth
        return wrap(6, 6,
          `<rect width="6" height="6" fill="${c[0]}"/>` +
          `<path d="M0 6L6 0" stroke="#000" stroke-opacity=".05" stroke-width="1"/>`);
    }
  }

  function lineSVG(d, style, item, dark) {
    const ink = dark ? '#ffffff' : '#000000';
    switch (style) {
      case 'rib': return `<path d="${d}" fill="none" stroke="#000" stroke-opacity=".2" stroke-width="2.2" stroke-linecap="round"/>`;
      case 'stitch': return `<path d="${d}" fill="none" stroke="${ink}" stroke-opacity=".28" stroke-width=".9" stroke-dasharray="2.2 1.8"/>`;
      case 'fold': return `<path d="${d}" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="3.2" stroke-linecap="round"/>`;
      case 'crease': return `<path d="${d}" fill="none" stroke="#000" stroke-opacity=".11" stroke-width="1.4" stroke-linecap="round"/>`;
      case 'edge': return `<path d="${d}" fill="none" stroke="#000" stroke-opacity=".22" stroke-width="1"/>`;
      case 'cord': return `<path d="${d}" fill="none" stroke="${dark ? '#e9e8e4' : '#3a3a40'}" stroke-opacity=".7" stroke-width="1.6" stroke-linecap="round"/>`;
      case 'trim': return `<path d="${d}" fill="none" stroke="${item.trim || '#C9A13B'}" stroke-width="2.4" stroke-linecap="round"/>`;
      case 'trimdots': return `<path d="${d}" fill="none" stroke="${item.trim || '#C9A13B'}" stroke-width="4.6" stroke-linecap="round"/>`;
      case 'fringe': return `<path d="${d}" fill="none" stroke="${item.pattern.colors[0]}" stroke-width="1.5" stroke-linecap="round"/>`;
      default: return '';
    }
  }

  /** opts: { shadow, depth, hit } */
  function svg(item, opts = {}) {
    const shape = SHAPES[item.type];
    const n = ++uid;
    const pid = `rm-p${n}`, gid = `rm-g${n}`;
    const dark = luminance(item.pattern.colors[0]) < 0.45;
    const d = shape.d;
    return (
      `<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">` +
      `<defs>${pattern(pid, item.pattern)}` +
      `<linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="#fff" stop-opacity=".22"/>` +
      `<stop offset=".48" stop-color="#fff" stop-opacity="0"/>` +
      `<stop offset="1" stop-color="#000" stop-opacity=".24"/>` +
      `</linearGradient></defs>` +
      (opts.shadow ? `<path class="sh" d="${d}" transform="translate(2.5 5)" fill="#05060a" fill-opacity=".3"/>` : '') +
      `<path d="${d}" fill="url(#${pid})"/>` +
      `<path d="${d}" fill="url(#${gid})"/>` +
      shape.lines.map(([ld, st]) => lineSVG(ld, st, item, dark)).join('') +
      `<path d="${d}" fill="none" stroke="#000" stroke-opacity=".14" stroke-width=".8"/>` +
      (opts.depth ? `<path class="dp" d="${d}" fill="#06070b" style="fill-opacity:0"/>` : '') +
      (opts.hit ? `<path class="hit" d="${d}" fill="none"/>` : '') +
      `</svg>`
    );
  }

  function path(type) {
    return paths[type] || (paths[type] = new Path2D(SHAPES[type].d));
  }

  /** Points inside the silhouette, used to measure how much of a piece is covered. */
  function sampleShape(type) {
    if (samples[type]) return samples[type];
    const pts = [];
    const p = path(type);
    for (let y = 6; y < 120; y += 13) {
      for (let x = 6; x < 120; x += 13) {
        if (probe.isPointInPath(p, x, y)) pts.push([x, y]);
      }
    }
    return (samples[type] = pts);
  }

  function contains(type, x, y) {
    return probe.isPointInPath(path(type), x, y);
  }

  function colors(item) {
    return item.pattern.colors.slice(0, 4);
  }

  return {
    svg,
    samples: sampleShape,
    contains,
    colors,
    scale: type => SHAPES[type].scale
  };
})();
