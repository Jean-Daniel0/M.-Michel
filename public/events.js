/* Décors de fête de M.Michel : dates (heure d'Haïti), couleurs, emoji. Utilisé par le site ET par le serveur (notifications). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.MMEvents = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DAY = 864e5, U = (y, m, d) => Date.UTC(y, m - 1, d);
  // Pâques (algorithme de Meeus/Jones/Butcher)
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
    return U(y, mo, da);
  }
  const lastSunday = (y, m) => { const last = Date.UTC(y, m, 0); return last - new Date(last).getUTCDay() * DAY; };
  const EVENTS = [
    { id: 'halloween', name: 'Halloween', emoji: '🎃', greet: 'Joyeux Halloween !', c1: '#1a1033', c2: '#7a3199', parts: ['🎃', '🦇', '👻', '🕸️'], win: y => [U(y, 10, 24), U(y, 10, 31)] },
    { id: 'vertieres', name: 'Bataille de Vertières (18 novembre)', emoji: '🇭🇹', greet: 'Gloire à Vertières !', c1: '#00209f', c2: '#d21034', parts: ['🇭🇹', '⭐', '🇭🇹'], win: y => [U(y, 11, 14), U(y, 11, 18)] },
    { id: 'noel', name: 'Noël', emoji: '🎄', greet: 'Joyeux Noël !', c1: '#0b4d2c', c2: '#b3122b', parts: ['❄️', '🎄', '⭐', '🎁'], win: y => [U(y, 12, 12), U(y, 12, 25)] },
    { id: 'nouvelan', name: 'Nouvel An · Indépendance', emoji: '🎆', greet: 'Bonne année ! Bonne Indépendance !', c1: '#14213d', c2: '#b8860b', parts: ['🎆', '✨', '🎉', '🥂'], win: y => [U(y, 12, 26), U(y + 1, 1, 3)] },
    { id: 'valentin', name: 'Saint-Valentin', emoji: '❤️', greet: 'Joyeuse Saint-Valentin !', c1: '#8c1135', c2: '#e0457b', parts: ['❤️', '💖', '🌹', '💕'], win: y => [U(y, 2, 8), U(y, 2, 14)] },
    { id: 'carnaval', name: 'Carnaval', emoji: '🎭', greet: 'Bon Carnaval !', c1: '#6a1b9a', c2: '#ef6c00', parts: ['🎭', '🥁', '🎊', '🎺'], win: y => { const mg = easter(y) - 47 * DAY; return [mg - 12 * DAY, mg]; } },
    { id: 'paques', name: 'Pâques', emoji: '🐣', greet: 'Joyeuses Pâques !', c1: '#2f7d68', c2: '#7a5fb3', parts: ['🐣', '🌷', '🥚', '🐰'], win: y => { const e = easter(y); return [e - 5 * DAY, e + DAY]; } },
    { id: 'drapeau', name: 'Fête du Drapeau (18 mai)', emoji: '🇭🇹', greet: 'Vive le drapeau haïtien !', c1: '#00209f', c2: '#d21034', parts: ['🇭🇹', '⭐', '🇭🇹'], win: y => [U(y, 5, 14), U(y, 5, 18)] },
    { id: 'mere', name: 'Fête des Mères', emoji: '💐', greet: 'Bonne fête des Mères !', c1: '#a8325e', c2: '#d96a8f', parts: ['💐', '🌸', '❤️', '🌷'], win: y => { const s = lastSunday(y, 5); return [s - 6 * DAY, s]; } },
    { id: 'pere', name: 'Fête des Pères', emoji: '👔', greet: 'Bonne fête des Pères !', c1: '#1c4e80', c2: '#3b82c4', parts: ['👔', '⭐', '💙', '🏆'], win: y => { const s = lastSunday(y, 6); return [s - 6 * DAY, s]; } },
  ];
  function todayHT(now) {
    const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Port-au-Prince', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now || new Date());
    const p = s.split('-').map(Number);
    return U(p[0], p[1], p[2]);
  }
  const find = id => EVENTS.find(e => e.id === id) || null;
  // mode : 'auto' (selon la date), 'off', ou l'identifiant d'une fête forcée par le professeur
  function current(mode, now) {
    if (mode === 'off') return null;
    const f = find(mode); if (f) return f;
    const t = todayHT(now), y = new Date(t).getUTCFullYear();
    let best = null, bend = Infinity;
    for (const e of EVENTS) for (const yy of [y - 1, y]) { const w = e.win(yy); if (t >= w[0] && t <= w[1] && w[1] < bend) { best = e; bend = w[1]; } }
    return best;
  }
  return { EVENTS, current, find, easter, todayHT };
});
