/* Décors animés de M.Michel : tout est dessiné en SVG/CSS (aucune image à télécharger, léger pour les téléphones). */
(function () {
  const R = (a, b) => a + Math.random() * (b - a), I = (a, b) => Math.round(R(a, b));
  const CSS = `
#evp .dc{position:absolute;pointer-events:none}
#evp .dc svg{display:block;width:100%;height:auto;overflow:visible}
#evp .gl{animation:dtw 2.2s ease-in-out infinite}
@keyframes dtw{0%,100%{opacity:.25}50%{opacity:1}}
#evp .dp{position:absolute;top:-8vh;animation:dpf linear infinite;will-change:transform}
@keyframes dpf{0%{transform:translate3d(0,-8vh,0) rotate(0)}100%{transform:translate3d(var(--dx),112vh,0) rotate(var(--r))}}
#evp .dr{position:absolute;bottom:-8vh;animation:dpr linear infinite;will-change:transform,opacity}
@keyframes dpr{0%{transform:translate3d(0,0,0) scale(.6);opacity:0}12%{opacity:.95}85%{opacity:.8}100%{transform:translate3d(var(--dx),-112vh,0) scale(1.05);opacity:0}}
#evp .sn{border-radius:50%;background:radial-gradient(circle,#fff 0,rgba(255,255,255,.85) 45%,rgba(255,255,255,0) 72%)}
#evp .em{border-radius:50%;background:radial-gradient(circle,#fff3b0 0,#ff9d1c 45%,rgba(255,90,0,0) 72%)}
#evp .glow{position:absolute;inset:0;pointer-events:none;animation:dgl 5s ease-in-out infinite alternate}
@keyframes dgl{from{opacity:.65}to{opacity:1}}
#evp .bat{position:absolute;left:-70px;animation:dbat linear infinite;will-change:transform}
#evp .bat svg{animation:dflap .32s ease-in-out infinite alternate;transform-origin:50% 60%}
@keyframes dbat{0%{transform:translate3d(0,0,0)}25%{transform:translate3d(30vw,-26px,0)}50%{transform:translate3d(60vw,22px,0)}75%{transform:translate3d(90vw,-18px,0)}100%{transform:translate3d(125vw,10px,0)}}
@keyframes dflap{from{transform:scaleY(1)}to{transform:scaleY(.5)}}
#evp .spd{position:absolute;top:-130px;width:34px;margin-left:-17px;animation:dspd ease-in-out infinite alternate}
#evp .spd i{display:block;width:1px;height:130px;margin:0 auto;background:rgba(255,255,255,.55)}
@keyframes dspd{from{transform:translateY(0)}to{transform:translateY(var(--dd))}}
#evp .fl2{transform-box:fill-box;transform-origin:50% 0;animation:dsw 3s ease-in-out infinite alternate}
@keyframes dsw{from{transform:rotate(-7deg)}to{transform:rotate(7deg)}}
#evp .orn{position:absolute;top:26px;transform-origin:50% 0;animation:dsw 3.6s ease-in-out infinite alternate}
#evp .orn i{display:block;width:1px;margin:0 auto;background:rgba(255,255,255,.6)}
#evp .ball{width:28px;height:28px;border-radius:50%;margin:0 auto;box-shadow:0 0 12px var(--c),inset -3px -4px 6px rgba(0,0,0,.35)}
#evp .egg{width:24px;height:31px;margin:0 auto;border-radius:50% 50% 50% 50%/62% 62% 38% 38%;box-shadow:0 0 10px rgba(255,255,255,.35),inset -3px -4px 6px rgba(0,0,0,.2)}
#evp .flk{animation:dfk 1.7s ease-in-out infinite}
@keyframes dfk{0%,100%{opacity:1}18%{opacity:.78}32%{opacity:1}55%{opacity:.7}70%{opacity:.96}85%{opacity:.82}}
#evp .gp{animation:dgp 1.7s ease-in-out infinite;transform-origin:50% 50%}
@keyframes dgp{0%,100%{opacity:.8;transform:scale(1)}40%{opacity:.5;transform:scale(.94)}70%{opacity:.95;transform:scale(1.04)}}
#evp .fire{transform-box:fill-box;transform-origin:50% 100%;animation:dfire .5s ease-in-out infinite alternate}
@keyframes dfire{0%{transform:scale(1,1) skewX(-3deg)}50%{transform:scale(.92,1.12) skewX(3deg)}100%{transform:scale(1.05,.95) skewX(-2deg)}}
#evp .fw{position:absolute;width:0;height:0}
#evp .fw b{position:absolute;left:-2px;top:-2px;width:4px;height:4px;border-radius:50%;background:var(--c);box-shadow:0 0 7px 1px var(--c);opacity:0;animation:dfw 3.4s ease-out infinite}
@keyframes dfw{0%{transform:rotate(var(--a)) translateX(0);opacity:0}3%{opacity:1}45%{transform:rotate(var(--a)) translateX(var(--rr)) translateY(8px);opacity:.9}62%,100%{transform:rotate(var(--a)) translateX(calc(var(--rr)*1.1)) translateY(26px);opacity:0}}
body.chatmode #evp .bt{display:none}
body.chatmode #evp .dp,body.chatmode #evp .dr{opacity:.55}
@media (prefers-reduced-motion:reduce){#evp *{animation:none!important}}`;
  let styled = false;
  const heart = (c) => `<svg viewBox="0 0 32 29"><path d="M16 28C-6 12 4-2 16 8C28-2 38 12 16 28Z" fill="${c}"/><ellipse cx="9" cy="8" rx="3" ry="2" fill="#fff" opacity=".45" transform="rotate(-30 9 8)"/></svg>`;
  const star = (c) => `<svg viewBox="0 0 24 24"><polygon points="12,1 15,9 23,9 17,14 19,22 12,17 5,22 7,14 1,9 9,9" fill="${c}"/></svg>`;
  const petal = (c) => `<svg viewBox="0 0 20 20"><path d="M10 1C18 6 18 15 10 19C2 15 2 6 10 1Z" fill="${c}"/><path d="M10 4V17" stroke="#fff" stroke-opacity=".35" stroke-width=".8"/></svg>`;
  const conf = (c) => `<svg viewBox="0 0 10 16"><rect width="10" height="16" rx="1.5" fill="${c}"/></svg>`;
  const pick = (a, i) => a[i % a.length];

  // guirlande lumineuse (ampoules qui scintillent)
  function lights(cols) {
    let d = '', b = '', n = 0;
    cols.forEach((c, i) => d += `<radialGradient id="lg${i}"><stop offset="0" stop-color="${c}" stop-opacity=".95"/><stop offset=".45" stop-color="${c}" stop-opacity=".45"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`);
    let path = 'M-5 5';
    for (let a = 0; a < 6; a++) {
      const x0 = a * 100, y0 = 4;
      path += ` Q${x0 + 50} 34 ${x0 + 100} 4`;
      [0.14, 0.5, 0.86].forEach(t => {
        const x = (1 - t) ** 2 * x0 + 2 * t * (1 - t) * (x0 + 50) + t * t * (x0 + 100), y = (1 - t) ** 2 * y0 + 2 * t * (1 - t) * 34 + t * t * y0;
        const k = n % cols.length, c = cols[k];
        b += `<rect x="${x - 1.6}" y="${y - 1}" width="3.2" height="5" rx="1" fill="#1b1b1b"/><circle class="gl" style="animation-delay:-${(n * 0.55 % 2.2).toFixed(2)}s" cx="${x}" cy="${y + 9}" r="12" fill="url(#lg${k})"/><ellipse cx="${x}" cy="${y + 9}" rx="3.6" ry="5.4" fill="${c}"/><ellipse cx="${x - 1}" cy="${y + 7}" rx="1" ry="1.8" fill="#fff" opacity=".7"/>`;
        n++;
      });
    }
    return `<div class="dc" style="top:0;left:0;width:100%"><svg viewBox="0 0 600 46" preserveAspectRatio="xMidYMin slice"><defs>${d}</defs><path d="${path}" fill="none" stroke="#161616" stroke-width="1.3"/>${b}</svg></div>`;
  }
  // fanions
  function bunting(cols) {
    let f = '', n = 0, path = 'M-5 5';
    for (let a = 0; a < 6; a++) {
      const x0 = a * 100;
      path += ` Q${x0 + 50} 34 ${x0 + 100} 4`;
      [0.08, 0.26, 0.44, 0.62, 0.8].forEach(t => {
        const x = (1 - t) ** 2 * x0 + 2 * t * (1 - t) * (x0 + 50) + t * t * (x0 + 100), y = (1 - t) ** 2 * 4 + 2 * t * (1 - t) * 34 + t * t * 4;
        f += `<polygon class="fl2" style="animation-delay:-${(n * .37 % 3).toFixed(2)}s" points="${x - 8},${y} ${x + 8},${y + 1} ${x},${y + 22}" fill="${pick(cols, n)}" stroke="rgba(0,0,0,.25)" stroke-width=".5"/>`;
        n++;
      });
    }
    return `<div class="dc" style="top:0;left:0;width:100%"><svg viewBox="0 0 600 46" preserveAspectRatio="xMidYMin slice"><path d="${path}" fill="none" stroke="#2b2b2b" stroke-width="1.2"/>${f}</svg></div>`;
  }
  function web(side) {
    let s = '', ang = [0, 22.5, 45, 67.5, 90].map(a => a * Math.PI / 180), P = (r, a) => [(r * Math.cos(a)).toFixed(1), (r * Math.sin(a)).toFixed(1)];
    ang.forEach(a => { const p = P(100, a); s += `M0 0L${p[0]} ${p[1]}`; });
    [26, 50, 76].forEach(r => { for (let i = 0; i < 4; i++) { const p = P(r, ang[i]), q = P(r, ang[i + 1]), m = P(r * .8, (ang[i] + ang[i + 1]) / 2); s += `M${p[0]} ${p[1]}Q${m[0]} ${m[1]} ${q[0]} ${q[1]}`; } });
    return `<div class="dc" style="top:0;${side}:0;width:112px;${side === 'right' ? 'transform:scaleX(-1)' : ''}"><svg viewBox="0 0 100 100"><path d="${s}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width=".9"/></svg></div>`;
  }
  const bat = (top, w, dur, delay) => `<div class="bat" style="top:${top}px;width:${w}px;animation-duration:${dur}s;animation-delay:-${delay}s"><svg viewBox="0 0 60 30"><path d="M30 8L27 1 26 9Q18 4 8 6Q4 8 0 14Q6 11 10 14Q14 11 18 16Q22 13 26 18L30 27 34 18Q38 13 42 16Q46 11 50 14Q54 11 60 14Q56 8 52 6Q42 4 34 9L33 1Z" fill="#0b0412" stroke="#6b3fa0" stroke-width=".6"/><circle cx="28.5" cy="10" r=".9" fill="#ff4d4d"/><circle cx="31.5" cy="10" r=".9" fill="#ff4d4d"/></svg></div>`;
  const spider = (left, dd, dur, delay) => `<div class="spd" style="left:${left}%;--dd:${dd}px;animation-duration:${dur}s;animation-delay:-${delay}s"><i></i><svg viewBox="0 0 40 40" style="width:34px"><g stroke="#8b6aa8" stroke-width="1.5" fill="none" stroke-linecap="round"><path d="M14 20Q4 12 2 22M13 23Q2 22 2 32M14 26Q4 30 4 38M15 28Q10 34 12 40M26 20Q36 12 38 22M27 23Q38 22 38 32M26 26Q36 30 36 38M25 28Q30 34 28 40"/></g><circle cx="20" cy="26" r="7.5" fill="#1a1024" stroke="#8b6aa8" stroke-width="1"/><circle cx="20" cy="16" r="5" fill="#1a1024" stroke="#8b6aa8" stroke-width="1"/><circle cx="18" cy="15" r="1.2" fill="#ff3b3b"/><circle cx="22" cy="15" r="1.2" fill="#ff3b3b"/></svg></div>`;
  const pumpkin = (side, w, candle) => `<div class="dc bt" style="bottom:-6px;${side}:-6px;width:${w}px">
<svg viewBox="0 0 100 92"><defs><radialGradient id="pb" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#ffb347"/><stop offset=".55" stop-color="#f26a00"/><stop offset="1" stop-color="#8f3000"/></radialGradient><radialGradient id="pg"><stop offset="0" stop-color="#ffb000" stop-opacity=".7"/><stop offset="1" stop-color="#ff6a00" stop-opacity="0"/></radialGradient><filter id="pbl"><feGaussianBlur stdDeviation="3"/></filter></defs>
<circle class="gp" cx="50" cy="52" r="60" fill="url(#pg)"/>
<ellipse cx="28" cy="54" rx="25" ry="33" fill="url(#pb)"/><ellipse cx="72" cy="54" rx="25" ry="33" fill="url(#pb)"/><ellipse cx="50" cy="52" rx="29" ry="36" fill="url(#pb)"/>
<path d="M38 22Q30 52 38 84M62 22Q70 52 62 84M16 36Q12 56 20 76M84 36Q88 56 80 76" stroke="#7a2900" stroke-opacity=".45" stroke-width="1.6" fill="none"/>
<path d="M46 19Q47 7 56 3L60 9Q54 11 54 20Z" fill="#3f5a16"/>
<g class="flk"><g filter="url(#pbl)" fill="#ffcc33"><path d="M28 44L40 44 34 31ZM60 44L72 44 66 31ZM50 49L44 59 56 59Z"/><path d="M26 63Q50 88 74 63L67 66 62 73 56 67 50 75 44 67 38 73 33 66Z"/></g>
<g fill="#ffe27a"><path d="M30 43L39 43 34 33ZM61 43L70 43 66 33ZM50 50L45.5 58 54.5 58Z"/><path d="M28 64Q50 85 72 64L66 66 62 72 56 66 50 73 44 66 38 72 34 66Z"/></g></g></svg>
${candle ? `<div style="position:absolute;left:${w * 0.78}px;bottom:4px;width:${w * 0.2}px"><svg viewBox="0 0 24 70"><defs><radialGradient id="cg"><stop offset="0" stop-color="#ffd27a" stop-opacity=".8"/><stop offset="1" stop-color="#ff8a00" stop-opacity="0"/></radialGradient><linearGradient id="fg" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff6a00"/><stop offset=".6" stop-color="#ffc23a"/><stop offset="1" stop-color="#fff6c4"/></linearGradient></defs><circle class="gp" cx="12" cy="16" r="26" fill="url(#cg)"/><rect x="6" y="28" width="12" height="42" rx="2" fill="#f3ead2"/><path d="M6 31Q9 38 12 31Q15 40 18 31V28H6Z" fill="#fffaf0"/><rect x="11.4" y="23" width="1.2" height="6" fill="#333"/><path class="fire" d="M12 4Q19 14 12 24Q5 14 12 4Z" fill="url(#fg)"/></svg></div>` : ''}</div>`;
  const falling = (n, shape, cls, sizes, cols, dur) => { let h = ''; for (let i = 0; i < n; i++) { const s = I(sizes[0], sizes[1]); h += `<div class="${cls}" style="left:${I(0, 96)}%;width:${s}px;height:${shape === conf ? Math.round(s * 1.5) : s}px;animation-duration:${R(dur[0], dur[1]).toFixed(1)}s;animation-delay:-${R(0, dur[1]).toFixed(1)}s;--dx:${I(-50, 50)}px;--r:${I(-360, 360)}deg">${shape ? shape(pick(cols, i)) : ''}</div>`; } return h; };
  const ornaments = (list) => list.map(o => `<div class="orn" style="left:${o[0]}%;animation-delay:-${o[3]}s"><i style="height:${o[1]}px"></i>${o[2]}</div>`).join('');
  const ball = c => `<div class="ball" style="--c:${c};background:radial-gradient(circle at 35% 30%,#fff 0,rgba(255,255,255,.2) 12%,${c} 45%,#00000066 100%)"></div>`;
  const egg = (c1, c2) => `<div class="egg" style="background:repeating-linear-gradient(0deg,${c1} 0 5px,${c2} 5px 8px)"></div>`;
  function fireworks() {
    const cs = ['#ffd24d', '#ff5d7a', '#7ad7ff', '#fff', '#9cff7a'];
    return [[18, 22], [78, 16], [48, 34], [88, 40]].map((p, k) => { let b = ''; const c = cs[(k * 2) % cs.length]; for (let i = 0; i < 16; i++) b += `<b style="--a:${i * 22.5}deg;--rr:${I(42, 62)}px;--c:${c};animation-delay:${(k * .85).toFixed(2)}s"></b>`; return `<div class="fw" style="left:${p[0]}%;top:${p[1]}vh">${b}</div>`; }).join('');
  }
  const glow = c => `<div class="glow" style="background:radial-gradient(ellipse 90% 45% at 50% 0,${c},transparent 70%)"></div>`;

  const SCENES = {
    halloween: () => glow('rgba(168,70,255,.34)') + web('left') + web('right') + lights(['#ff7a00', '#a855f7', '#ffb300']) + spider(16, 70, 5.5, 1) + spider(80, 48, 4.2, 2.5)
      + falling(9, null, 'dr em', [5, 11], [1], [8, 15]) + bat(90, 46, 15, 2) + bat(190, 34, 20, 9) + bat(60, 28, 24, 15) + pumpkin('left', 104, true) + pumpkin('right', 92, false),
    noel: () => glow('rgba(255,210,120,.22)') + lights(['#ff3b3b', '#ffc93c', '#3ddc84', '#4da3ff']) + falling(26, null, 'dp sn', [4, 12], [1], [9, 18])
      + ornaments([[5, 50, ball('#d81e3a'), 0.5], [30, 76, ball('#f0b429'), 1.6], [47, 44, ball('#2bb673'), 2.4]]),
    nouvelan: () => glow('rgba(255,200,80,.2)') + lights(['#ffd24d', '#fff4c4', '#ffb300']) + fireworks() + falling(14, conf, 'dp', [5, 9], ['#ffd24d', '#fff', '#ff5d7a', '#7ad7ff'], [6, 12]),
    valentin: () => glow('rgba(255,80,140,.22)') + lights(['#ff4d8d', '#ff86b4', '#e11d48']) + falling(11, heart, 'dr', [14, 30], ['#ff4d8d', '#ff86b4', '#e11d48'], [8, 14]),
    carnaval: () => bunting(['#ff3b6b', '#ffc93c', '#3ddc84', '#4da3ff', '#a855f7']) + falling(24, conf, 'dp', [5, 9], ['#ff3b6b', '#ffc93c', '#3ddc84', '#4da3ff', '#a855f7', '#ff8a00'], [5, 10]),
    paques: () => bunting(['#ffd6e7', '#c8f0d8', '#fff2a8', '#d4c8ff', '#bfe6ff']) + falling(14, petal, 'dp', [12, 22], ['#ffc2d9', '#fff', '#e8d4ff'], [8, 15])
      + ornaments([[5, 46, egg('#ff9ec4', '#fff2a8'), 0.8], [30, 72, egg('#9fd8ff', '#d4c8ff'), 1.9], [47, 42, egg('#a7e8c2', '#fff'), 2.7]]),
    drapeau: () => bunting(['#00209f', '#fff', '#d21034']) + falling(16, conf, 'dp', [5, 9], ['#00209f', '#d21034', '#fff'], [5, 10]),
    mere: () => glow('rgba(255,140,180,.2)') + lights(['#ff86b4', '#fff', '#ffd24d']) + falling(15, petal, 'dp', [12, 22], ['#ff9ec4', '#fff', '#ffc2d9'], [8, 15]) + falling(4, heart, 'dr', [14, 24], ['#ff4d8d', '#ff86b4'], [9, 14]),
    pere: () => bunting(['#1c4e80', '#fff', '#3b82c4', '#ffd24d']) + falling(12, star, 'dp', [12, 22], ['#ffd24d', '#fff4c4', '#7ab8ff'], [7, 14])
  };
  SCENES.vertieres = SCENES.drapeau;
  window.MMDecor = {
    scene(id) {
      if (!styled) { styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }
      return SCENES[id] ? SCENES[id]() : '';
    }
  };
})();
