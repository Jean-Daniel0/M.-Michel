/* Mascotte M.Michel : personnage vectoriel léger (pas de 3D lourde) avec plusieurs expressions */
(function (g) {
  let uid = 0;
  const MOODS = {
    hello: { brow: ['M72 72 Q83 68 94 72', 'M106 72 Q117 68 128 72'], mouth: 'smile', arm: 'wave', cheek: 0.25 },
    happy: { brow: ['M72 71 Q83 66 94 70', 'M106 70 Q117 66 128 71'], mouth: 'open', arm: 'thumb', cheek: 0.35 },
    think: { brow: ['M72 65 Q83 59 94 67', 'M106 74 Q117 72 128 76'], mouth: 'flat', arm: null, cheek: 0 },
    oops: { brow: ['M72 75 Q83 72 94 67', 'M106 67 Q117 72 128 75'], mouth: 'frown', arm: null, cheek: 0 },
    wow: { brow: ['M72 62 Q83 57 94 62', 'M106 62 Q117 57 128 62'], mouth: 'o', arm: null, cheek: 0 },
    cheer: { brow: ['M72 68 Q83 63 94 67', 'M106 67 Q117 63 128 68'], mouth: 'big', arm: 'cheer', cheek: 0.4 },
  };
  const NAVY = '#1b2c68';

  function mouth(kind) {
    const dark = '#4a1c1a';
    switch (kind) {
      case 'smile': return '<path d="M89 118 Q100 128 111 118" stroke="#3a1a12" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
      case 'open': return '<path d="M88 117 Q100 135 112 117 Q100 121 88 117 Z" fill="' + dark + '"/><path d="M90 118 Q100 122 110 118 L109 120.5 Q100 124.5 91 120.5 Z" fill="#fff"/>';
      case 'big': return '<path d="M85 116 Q100 141 115 116 Q100 122 85 116 Z" fill="' + dark + '"/><path d="M87 117 Q100 122.5 113 117 L111.5 120 Q100 125.5 88.5 120 Z" fill="#fff"/>';
      case 'flat': return '<path d="M93 121 Q100 120 108 123" stroke="#3a1a12" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
      case 'frown': return '<path d="M92 125 Q100 117 108 125" stroke="#3a1a12" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
      case 'o': return '<ellipse cx="100" cy="122" rx="4.6" ry="6" fill="' + dark + '"/>';
    }
    return '';
  }

  function arms(kind, skin) {
    const sleeveR = '<path d="M152 168 C170 158 182 140 179 124 L167 122 C169 138 162 150 146 160 Z" fill="' + NAVY + '"/>';
    const sleeveL = '<path d="M48 168 C30 158 18 140 21 124 L33 122 C31 138 38 150 54 160 Z" fill="' + NAVY + '"/>';
    if (kind === 'wave') {
      return '<g class="av-wave">' + sleeveR + '<circle cx="173" cy="114" r="11" fill="' + skin + '"/><rect x="167" y="104" width="3" height="9" rx="1.5" fill="' + skin + '" stroke="#6a3d28" stroke-width=".6"/><rect x="172" y="102" width="3" height="10" rx="1.5" fill="' + skin + '" stroke="#6a3d28" stroke-width=".6"/><rect x="177" y="104" width="3" height="9" rx="1.5" fill="' + skin + '" stroke="#6a3d28" stroke-width=".6"/></g>';
    }
    if (kind === 'cheer') {
      return sleeveR + sleeveL + '<circle cx="173" cy="114" r="11" fill="' + skin + '"/><circle cx="27" cy="114" r="11" fill="' + skin + '"/>';
    }
    if (kind === 'thumb') {
      return '<path d="M150 172 C166 176 176 168 174 154 L162 152 C162 162 156 166 144 164 Z" fill="' + NAVY + '"/><ellipse cx="170" cy="146" rx="11" ry="10" fill="' + skin + '"/><rect x="165" y="126" width="9" height="20" rx="4.5" fill="' + skin + '"/>';
    }
    return '';
  }

  function confetti() {
    const cols = ['#16358c', '#c4122f', '#f2b955', '#ffffff', '#4cb97f'];
    let h = '<g class="av-conf">';
    [[30, 30], [60, 14], [92, 6], [128, 12], [160, 26], [14, 70], [186, 64], [46, 52], [150, 48], [108, 24]].forEach((p, i) => {
      h += '<rect x="' + p[0] + '" y="' + p[1] + '" width="6" height="9" rx="1.5" fill="' + cols[i % 5] + '" style="animation-delay:' + (i * 0.17).toFixed(2) + 's"/>';
    });
    return h + '</g>';
  }

  function avatar(mood, size) {
    const m = MOODS[mood] || MOODS.hello;
    const u = 'a' + (++uid);
    const skin = 'url(#' + u + 's)';
    const skinFlat = '#7e4d33';
    const w = size || 140;
    return '<svg class="av" viewBox="0 0 200 220" width="' + w + '" height="' + Math.round(w * 1.1) + '" role="img" aria-label="M.Michel" xmlns="http://www.w3.org/2000/svg">' +
      '<defs>' +
      '<radialGradient id="' + u + 's" cx="42%" cy="35%" r="70%"><stop offset="0" stop-color="#9a6644"/><stop offset=".55" stop-color="#7e4d33"/><stop offset="1" stop-color="#5d3524"/></radialGradient>' +
      '<linearGradient id="' + u + 'j" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26397f"/><stop offset="1" stop-color="#111c45"/></linearGradient>' +
      '<linearGradient id="' + u + 't" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9c0d26"/><stop offset=".5" stop-color="#e0213f"/><stop offset="1" stop-color="#a30f29"/></linearGradient>' +
      '<clipPath id="' + u + 'c"><path d="M10 220 C10 176 45 160 78 152 L122 152 C155 160 190 176 190 220 Z"/></clipPath>' +
      '</defs>' +
      (mood === 'cheer' ? confetti() : '') +
      '<g class="av-bob">' +
      arms(m.arm, skinFlat) +
      /* veste */
      '<path d="M10 220 C10 176 45 160 78 152 L122 152 C155 160 190 176 190 220 Z" fill="url(#' + u + 'j)"/>' +
      '<g clip-path="url(#' + u + 'c)" stroke="#4a66c4" stroke-width="1.2" opacity=".55" fill="none">' +
      '<path d="M32 150 V222 M58 150 V222 M142 150 V222 M168 150 V222 M0 186 H200 M0 206 H200"/></g>' +
      /* chemise, cravate */
      '<path d="M80 152 L120 152 L100 198 Z" fill="#f7f8fc"/>' +
      '<path d="M80 150 L100 166 L86 173 Z" fill="#eceff7" stroke="#cdd3e4" stroke-width="1"/>' +
      '<path d="M120 150 L100 166 L114 173 Z" fill="#eceff7" stroke="#cdd3e4" stroke-width="1"/>' +
      '<path d="M96 175 L104 175 L111 214 L100 222 L89 214 Z" fill="url(#' + u + 't)"/>' +
      '<path d="M93 165 L107 165 L105 177 L95 177 Z" fill="#c4122f"/>' +
      /* revers + rose */
      '<path d="M78 152 L93 172 L84 194 L60 172 Z" fill="#0f1a40"/>' +
      '<path d="M122 152 L107 172 L116 194 L140 172 Z" fill="#0f1a40"/>' +
      '<circle cx="127" cy="180" r="9.5" fill="#c4122f"/><path d="M127 180 m-6 0 a6 6 0 1 1 6 6 M127 180 m-3 0 a3 3 0 1 1 3 3" stroke="#7d0a1c" stroke-width="1.6" fill="none"/>' +
      /* cou */
      '<path d="M86 128 L114 128 L114 156 Q100 168 86 156 Z" fill="#69402b"/>' +
      '<ellipse cx="100" cy="140" rx="15" ry="7" fill="#4f2c1d" opacity=".55"/>' +
      /* oreilles + tête */
      '<ellipse cx="61" cy="93" rx="6.5" ry="11" fill="#74472f"/><ellipse cx="139" cy="93" rx="6.5" ry="11" fill="#6a3f2a"/>' +
      '<path d="M62 88 C62 52 80 40 100 40 C120 40 138 52 138 88 C138 112 124 134 100 138 C76 134 62 112 62 88 Z" fill="' + skin + '"/>' +
      /* joues */
      (m.cheek ? '<ellipse cx="78" cy="108" rx="8" ry="5" fill="#b27a58" opacity="' + m.cheek + '"/><ellipse cx="122" cy="108" rx="8" ry="5" fill="#b27a58" opacity="' + m.cheek + '"/>' : '') +
      /* cheveux */
      '<path d="M60 84 C55 48 78 29 100 29 C124 29 145 48 140 84 C136 70 128 58 100 58 C72 58 64 70 60 84 Z" fill="#0e0e11"/>' +
      '<path d="M78 40 C88 34 104 33 114 37" stroke="#3a3a44" stroke-width="2" fill="none" stroke-linecap="round" opacity=".6"/>' +
      /* nez */
      '<path d="M100 93 C98 102 95 106 99 108.5 C100.5 109.2 102.5 108.5 104 107" stroke="#5a3220" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7"/>' +
      /* yeux */
      '<g class="av-blink"><ellipse cx="82.5" cy="90" rx="3.5" ry="4.2" fill="#1a0f0a"/><ellipse cx="117.5" cy="90" rx="3.5" ry="4.2" fill="#1a0f0a"/>' +
      '<circle cx="84" cy="88.4" r="1.2" fill="#fff"/><circle cx="119" cy="88.4" r="1.2" fill="#fff"/></g>' +
      /* lunettes */
      '<rect x="69" y="78" width="27" height="22" rx="6" fill="#9fd0ff" fill-opacity=".18" stroke="#121214" stroke-width="3.2"/>' +
      '<rect x="104" y="78" width="27" height="22" rx="6" fill="#9fd0ff" fill-opacity=".18" stroke="#121214" stroke-width="3.2"/>' +
      '<path d="M96 86 H104 M69 84 L61 85 M131 84 L139 85" stroke="#121214" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M73 82 L79 82 M108 82 L114 82" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".6"/>' +
      /* sourcils */
      '<path d="' + m.brow[0] + '" stroke="#0e0e11" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="' + m.brow[1] + '" stroke="#0e0e11" stroke-width="3.4" fill="none" stroke-linecap="round"/>' +
      /* moustache, bouche, bouc */
      mouth(m.mouth) +
      '<path d="M86 115 C92 109 108 109 114 115 C108 113.5 92 113.5 86 115 Z" fill="#0e0e11"/>' +
      '<path d="M91 128 C93 137 107 137 109 128 C106 125.5 94 125.5 91 128 Z" fill="#0e0e11"/>' +
      '</g></svg>';
  }

  /* Mascotte + bulle de dialogue */
  function mascot(mood, text, size, cls) {
    return '<div class="mascot ' + (cls || '') + '">' + avatar(mood, size || 120) + '<div class="bubble" role="status">' + String(text == null ? '' : text).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }) + '</div></div>';
  }

  g.avatar = avatar;
  g.mascot = mascot;
  if (typeof module !== 'undefined') module.exports = { avatar: avatar, mascot: mascot, MOODS: MOODS };
})(typeof window !== 'undefined' ? window : globalThis);
