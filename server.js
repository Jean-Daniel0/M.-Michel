const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const TEACHER_CODE = (process.env.TEACHER_CODE || '').trim();
if (TEACHER_CODE.length < 6) {
  console.error('TEACHER_CODE manquant ou trop court (6 caractères minimum).');
  process.exit(1);
}
const SECRET = crypto.createHash('sha256').update('m-michel:' + TEACHER_CODE).digest();

/* ---------- Stockage clé/valeur : Postgres si DATABASE_URL, sinon fichier JSON ---------- */
let kv;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false },
  });
  kv = {
    async init() {
      try { await pool.query('select 1 from kv limit 1'); }
      catch (e) {
        if (e.code !== '42P01') throw e;
        await pool.query('create table if not exists kv(key text primary key, value jsonb not null)');
      }
    },
    async get(k) { const r = await pool.query('select value from kv where key=$1', [k]); return r.rows[0] ? r.rows[0].value : null; },
    async set(k, v) { await pool.query('insert into kv(key,value) values($1,$2) on conflict(key) do update set value=excluded.value', [k, JSON.stringify(v)]); },
    async del(k) { await pool.query('delete from kv where key=$1', [k]); },
    async list(p) {
      const r = await pool.query("select key from kv where key like $1 escape '\\'", [p.replace(/[%_\\]/g, '\\$&') + '%']);
      return r.rows.map(x => x.key);
    },
  };
} else {
  const FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
  let db = {};
  try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { db = {}; }
  let t = null;
  const flush = () => { clearTimeout(t); t = setTimeout(() => fs.writeFile(FILE, JSON.stringify(db), () => {}), 200); };
  kv = {
    async init() {},
    async get(k) { return db[k] ? JSON.parse(JSON.stringify(db[k])) : null; },
    async set(k, v) { db[k] = JSON.parse(JSON.stringify(v)); flush(); },
    async del(k) { delete db[k]; flush(); },
    async list(p) { return Object.keys(db).filter(k => k.startsWith(p)); },
  };
  console.warn('Stockage dans un fichier local (pas de DATABASE_URL). Les données peuvent être perdues sur un hébergement gratuit.');
}

/* ---------- Outils ---------- */
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const nameKey = n => norm(n).replace(/ /g, '-');
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const b64 = b => Buffer.from(b).toString('base64url');
const sign = p => { const body = b64(JSON.stringify(p)); return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url'); };
function verify(tok) {
  if (!tok || typeof tok !== 'string') return null;
  const [body, sig] = tok.split('.');
  if (!body || !sig) return null;
  const exp = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch (e) { return null; }
}
const safeEq = (a, b) => { const x = crypto.createHash('sha256').update(a).digest(), y = crypto.createHash('sha256').update(b).digest(); return crypto.timingSafeEqual(x, y); };
const str = (s, n) => String(s == null ? '' : s).slice(0, n);

/* limite d'essais de connexion */
const tries = new Map();
function limited(req) {
  const ip = req.ip, now = Date.now();
  const rec = (tries.get(ip) || []).filter(t => now - t < 60000);
  rec.push(now); tries.set(ip, rec);
  if (tries.size > 5000) tries.clear();
  return rec.length > 15;
}

/* ---------- Quiz ---------- */
const SUBJECTS = ['Informatique', 'Éducation à la citoyenneté', 'Éducation esthétique et artistique', 'Autre'];
const PALETTE = new Set(['#111111', '#16358c', '#b80f2b', '#15704a', '#c25a00', '#6b2fa0', '#555555']);
const hex2 = n => Math.max(0, Math.min(255, parseInt(n) || 0)).toString(16).padStart(2, '0');
function sanitizeBrief(html) {
  html = String(html || '').slice(0, 40000).replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, '');
  const ALLOWED = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'h3', 'ul', 'ol', 'li', 'span']);
  const text = t => t.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const re = /<\s*(\/?)\s*([a-zA-Z0-9]+)([^>]*)>/g;
  let out = '', last = 0, m;
  while ((m = re.exec(html))) {
    out += text(html.slice(last, m.index)); last = re.lastIndex;
    const close = m[1] === '/'; let tag = m[2].toLowerCase(); const attrs = m[3] || '';
    if (tag === 'div') tag = 'p';
    if (!ALLOWED.has(tag)) continue;
    if (close) { if (tag !== 'br') out += '</' + tag + '>'; continue; }
    if (tag === 'br') { out += '<br>'; continue; }
    if (tag === 'span') {
      const c = /color\s*:\s*(#[0-9a-fA-F]{6}|rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\))/i.exec(attrs);
      let hex = null;
      if (c) hex = c[1][0] === '#' ? c[1].toLowerCase() : '#' + hex2(c[2]) + hex2(c[3]) + hex2(c[4]);
      out += hex && PALETTE.has(hex) ? '<span style="color:' + hex + '">' : '<span>';
      continue;
    }
    out += '<' + tag + '>';
  }
  return (out + text(html.slice(last))).trim();
}
const briefText = h => String(h || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
function cleanQuiz(d) {
  const qs = (Array.isArray(d.qs) ? d.qs : []).slice(0, 200).map(q => {
    const t = ['qcm', 'vf', 'court', 'long'].includes(q.t) ? q.t : 'qcm';
    const c = { t, q: str(q.q, 1500), why: !!q.why && t !== 'long', opts: ['', '', '', ''], a: '' };
    if (t === 'qcm') { c.opts = (Array.isArray(q.opts) ? q.opts : []).slice(0, 6).map(o => str(o, 300)); c.a = Number.isInteger(q.a) ? q.a : 0; }
    else if (t === 'vf') c.a = q.a === 'faux' ? 'faux' : 'vrai';
    else if (t === 'court') c.a = str(q.a, 500);
    return c;
  });
  const mode = ['quiz', 'devoir', 'libelle'].includes(d.mode) ? d.mode : 'quiz';
  if (mode === 'libelle') qs.length = 0;
  return {
    id: str(d.id, 8).toUpperCase().replace(/[^A-Z0-9]/g, ''),
    classId: str(d.classId, 8).toUpperCase().replace(/[^A-Z0-9]/g, ''),
    brief: sanitizeBrief(d.brief),
    title: str(d.title, 120).trim(),
    subject: SUBJECTS.includes(d.subject) ? d.subject : 'Autre',
    level: str(d.level, 60),
    mode,
    minutes: mode === 'libelle' ? 0 : Math.max(0, Math.min(600, parseInt(d.minutes) || 0)),
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(d.deadline || '') ? d.deadline : '',
    draw: mode === 'libelle' ? 0 : Math.max(0, Math.min(qs.length, parseInt(d.draw) || 0)),
    qs,
    created: d.created || Date.now(),
  };
}
const deadlinePassed = q => q.deadline && new Date(q.deadline + 'T23:59:59') < new Date();
const publicInfo = q => ({
  id: q.id, title: q.title, subject: q.subject, level: q.level, mode: q.mode, minutes: q.minutes, deadline: q.deadline,
  n: q.draw > 0 ? Math.min(q.draw, q.qs.length) : q.qs.length,
  hasBrief: !!briefText(q.brief), hasQs: q.qs.length > 0, closed: !!deadlinePassed(q),
});
async function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let t = 0; t < 30; t++) {
    const id = Array.from({ length: 5 }, () => A[crypto.randomInt(A.length)]).join('');
    if (!(await kv.get('quiz:' + id)) && !(await kv.get('class:' + id)) && !safeEq(id, TEACHER_CODE)) return id;
  }
  return null;
}
async function classQuizzes(classId) {
  const keys = await kv.list('quiz:');
  const qs = (await Promise.all(keys.map(k => kv.get(k)))).filter(q => q && q.classId === classId);
  qs.sort((a, b) => (b.created || 0) - (a.created || 0));
  return qs;
}
async function adoptOrphans() {
  const keys = await kv.list('quiz:');
  const orphans = (await Promise.all(keys.map(k => kv.get(k)))).filter(q => q && !q.classId);
  if (!orphans.length) return;
  const id = await newCode(); if (!id) return;
  await kv.set('class:' + id, { id, name: 'Ma classe', level: '', created: Date.now() });
  for (const q of orphans) { q.classId = id; await kv.set('quiz:' + q.id, q); }
}

/* ---------- Tentative d'un élève ---------- */
const attKey = (id, key) => 'att:' + id + ':' + key;
function view(att, quiz, i) {
  const o = att.order[i], q = quiz.qs[o.qi];
  return { t: q.t, q: q.q, why: !!q.why && q.t !== 'long', opts: q.t === 'qcm' ? o.map.map(k => q.opts[k]) : undefined };
}
function grade(q, o, given, why, ms) {
  let g = '', correct = '', ok = null;
  if (q.t === 'qcm') {
    const k = Number.isInteger(given) && given >= 0 && given < o.map.length ? given : -1;
    g = k >= 0 ? q.opts[o.map[k]] : ''; correct = q.opts[q.a]; ok = k >= 0 && o.map[k] === q.a;
  } else if (q.t === 'vf') {
    g = given === 0 ? 'Vrai' : given === 1 ? 'Faux' : ''; correct = q.a === 'vrai' ? 'Vrai' : 'Faux'; ok = g !== '' && g === correct;
  } else if (q.t === 'court') {
    g = str(given, 1500).trim(); correct = q.a; ok = !!g && String(q.a).split('|').some(x => norm(x) && norm(x) === norm(g));
  } else { g = str(given, 4000).trim(); }
  return { q: q.q, t: q.t, given: g, correct: q.t === 'long' ? '' : correct, ok, why: str(why, 2000).trim(), ms: Math.max(0, ms | 0) };
}
function mergeFlags(att, f) {
  if (!f || typeof f !== 'object') return;
  for (const k of ['paste', 'leave', 'leaveMs', 'jump']) {
    const v = Math.max(0, Math.min(1e7, Number(f[k]) || 0));
    if (v > (att.flags[k] || 0)) att.flags[k] = Math.round(v);
  }
}
function finalize(att, quiz, timeUp) {
  while (att.answers.length < att.order.length) {
    const i = att.answers.length, q = quiz.qs[att.order[i].qi];
    att.answers.push(grade(q, att.order[i], null, '', 0));
  }
  att.finished = true; att.timeUp = !!timeUp; att.finishedAt = Date.now(); att.ms = att.finishedAt - att.startedAt;
}
function summary(att) {
  let s = 0, p = 0;
  att.answers.forEach(a => { if (a.ok === true) s++; else if (a.ok === null) p++; });
  return { s, p, t: att.answers.length };
}
function state(att, quiz) {
  return {
    i: att.answers.length, total: att.order.length,
    remaining: att.endsAt ? Math.max(0, att.endsAt - Date.now()) : null,
    question: view(att, quiz, att.answers.length),
    flags: att.flags,
  };
}

/* ---------- Application ---------- */
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '300kb' }));
app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' }); next(); });
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Erreur du serveur. Réessaie.' }); });
const fail = (res, code, msg) => res.status(code).json({ error: msg });

/* Connexion unique : le code du professeur ouvre l'espace prof, un code de classe ouvre la liste de ses travaux */
app.post('/api/login', wrap(async (req, res) => {
  if (limited(req)) return fail(res, 429, 'Trop d\'essais. Attends une minute.');
  const code = str(req.body.code, 100).trim();
  if (!code) return fail(res, 400, 'Entre ton code.');
  if (safeEq(code, TEACHER_CODE)) return res.json({ role: 'teacher', token: sign({ r: 't', exp: Date.now() + 30 * 864e5 }) });
  const cls = await kv.get('class:' + code.toUpperCase());
  if (!cls) return fail(res, 404, 'Code introuvable. Vérifie-le avec ton professeur.');
  const qs = await classQuizzes(cls.id);
  res.json({ role: 'class', class: { name: cls.name, level: cls.level || '' }, devoirs: qs.map(publicInfo) });
}));

/* Libellé d'un devoir (page blanche côté élève) : il faut connaître le code de la classe */
app.post('/api/brief', wrap(async (req, res) => {
  if (limited(req)) return fail(res, 429, 'Trop d\'essais. Attends une minute.');
  const classId = str(req.body.code, 8).toUpperCase(), qid = str(req.body.qid, 8).toUpperCase();
  const quiz = await kv.get('quiz:' + qid);
  if (!quiz || quiz.classId !== classId || !briefText(quiz.brief)) return fail(res, 404, 'Libellé introuvable.');
  res.json({ title: quiz.title, brief: quiz.brief });
}));

app.post('/api/start', wrap(async (req, res) => {
  if (limited(req)) return fail(res, 429, 'Trop d\'essais. Attends une minute.');
  const id = str(req.body.qid, 8).toUpperCase(), classId = str(req.body.code, 8).toUpperCase(), name = str(req.body.name, 80).trim().replace(/\s+/g, ' ');
  const key = nameKey(name);
  if (key.length < 3) return fail(res, 400, 'Entre ton prénom et ton nom.');
  const quiz = await kv.get('quiz:' + id);
  if (!quiz || quiz.classId !== classId) return fail(res, 404, 'Travail introuvable.');
  if (!quiz.qs.length) return fail(res, 400, 'Ce travail n\'a pas de quiz à passer.');
  let att = await kv.get(attKey(id, key));
  if (att) {
    if (att.finished) return fail(res, 409, 'Tu as déjà rendu ce travail. Demande à ton professeur si tu dois le refaire.');
    if (!req.body.token || !safeEq(String(req.body.token), att.token)) return fail(res, 409, 'Ce travail est déjà commencé sur un autre appareil. Demande à ton professeur.');
    if (att.endsAt && Date.now() > att.endsAt + 8000) { finalize(att, quiz, true); await kv.set(attKey(id, key), att); return res.json({ done: true, timeUp: true, summary: summary(att) }); }
    att.flags.leave = (att.flags.leave || 0) + 1;
    await kv.set(attKey(id, key), att);
    return res.json({ token: att.token, state: state(att, quiz) });
  }
  if (deadlinePassed(quiz)) return fail(res, 403, 'La date limite de ce travail est passée.');
  let idx = shuffle(quiz.qs.map((_, i) => i));
  if (quiz.draw > 0) idx = idx.slice(0, quiz.draw);
  const order = idx.map(qi => {
    const q = quiz.qs[qi];
    const map = q.t === 'qcm' ? shuffle(q.opts.map((o, k) => k).filter(k => q.opts[k].trim())) : [];
    return { qi, map };
  });
  const now = Date.now();
  att = { id, name, key, token: crypto.randomBytes(18).toString('base64url'), startedAt: now, qStart: now, endsAt: quiz.minutes > 0 ? now + quiz.minutes * 60000 : null, order, answers: [], flags: { paste: 0, leave: 0, leaveMs: 0, jump: 0 }, finished: false };
  await kv.set(attKey(id, key), att);
  res.json({ token: att.token, state: state(att, quiz) });
}));

async function loadAtt(req, res) {
  const id = str(req.body.qid, 8).toUpperCase(), key = nameKey(str(req.body.name, 80));
  const [quiz, att] = await Promise.all([kv.get('quiz:' + id), kv.get(attKey(id, key))]);
  if (!quiz || !att) { fail(res, 404, 'Travail introuvable.'); return null; }
  if (!req.body.token || !safeEq(String(req.body.token), att.token)) { fail(res, 403, 'Accès refusé.'); return null; }
  return { id, key, quiz, att };
}

app.post('/api/answer', wrap(async (req, res) => {
  const c = await loadAtt(req, res); if (!c) return;
  const { id, key, quiz, att } = c;
  if (att.finished) return res.json({ done: true, timeUp: !!att.timeUp, summary: summary(att) });
  mergeFlags(att, req.body.flags);
  const now = Date.now();
  if (att.endsAt && now > att.endsAt + 8000) { finalize(att, quiz, true); await kv.set(attKey(id, key), att); return res.json({ done: true, timeUp: true, summary: summary(att) }); }
  const i = att.answers.length, o = att.order[i];
  att.answers.push(grade(quiz.qs[o.qi], o, req.body.given, req.body.why, now - att.qStart));
  att.qStart = now;
  if (att.answers.length >= att.order.length) { finalize(att, quiz, false); await kv.set(attKey(id, key), att); return res.json({ done: true, timeUp: false, summary: summary(att) }); }
  await kv.set(attKey(id, key), att);
  res.json({ done: false, state: state(att, quiz) });
}));

app.post('/api/finish', wrap(async (req, res) => {
  const c = await loadAtt(req, res); if (!c) return;
  const { id, key, quiz, att } = c;
  if (att.finished) return res.json({ done: true, timeUp: !!att.timeUp, summary: summary(att) });
  if (!att.endsAt || Date.now() < att.endsAt - 3000) return fail(res, 400, 'Le temps n\'est pas écoulé.');
  mergeFlags(att, req.body.flags);
  if (req.body.given !== undefined && att.answers.length < att.order.length) {
    const i = att.answers.length, o = att.order[i];
    att.answers.push(grade(quiz.qs[o.qi], o, req.body.given, req.body.why, Date.now() - att.qStart));
  }
  finalize(att, quiz, true);
  await kv.set(attKey(id, key), att);
  res.json({ done: true, timeUp: true, summary: summary(att) });
}));

app.post('/api/flags', wrap(async (req, res) => {
  const c = await loadAtt(req, res); if (!c) return;
  if (c.att.finished) return res.json({ ok: true });
  mergeFlags(c.att, req.body.flags);
  await kv.set(attKey(c.id, c.key), c.att);
  res.json({ ok: true });
}));

/* ---------- Espace professeur ---------- */
function auth(req, res, next) {
  const h = req.get('authorization') || '';
  const p = verify(h.replace(/^Bearer /, ''));
  if (!p || p.r !== 't') return fail(res, 401, 'Session expirée.');
  next();
}
app.get('/api/classes', auth, wrap(async (req, res) => {
  await adoptOrphans();
  const keys = await kv.list('class:');
  const cls = (await Promise.all(keys.map(k => kv.get(k)))).filter(Boolean);
  const counts = await Promise.all(cls.map(async c => (await classQuizzes(c.id)).length));
  cls.forEach((c, i) => { c.n = counts[i]; });
  cls.sort((a, b) => (a.created || 0) - (b.created || 0));
  res.json({ classes: cls });
}));
app.get('/api/classes/:id', auth, wrap(async (req, res) => {
  const c = await kv.get('class:' + req.params.id.toUpperCase());
  if (!c) return fail(res, 404, 'Classe introuvable.');
  const qs = await classQuizzes(c.id);
  const counts = await Promise.all(qs.map(async q => (await kv.list('att:' + q.id + ':')).length));
  qs.forEach((q, i) => { q.n = counts[i]; delete q.brief; });
  res.json({ class: c, quizzes: qs });
}));
app.post('/api/classes', auth, wrap(async (req, res) => {
  const name = str(req.body.name, 80).trim(), level = str(req.body.level, 60).trim();
  if (!name) return fail(res, 400, 'Donne un nom à la classe.');
  let id = str(req.body.id, 8).toUpperCase().replace(/[^A-Z0-9]/g, '');
  let c;
  if (id) {
    c = await kv.get('class:' + id);
    if (!c) return fail(res, 404, 'Classe introuvable.');
    c.name = name; c.level = level;
  } else {
    id = await newCode();
    if (!id) return fail(res, 500, 'Impossible de créer un code. Réessaie.');
    c = { id, name, level, created: Date.now() };
  }
  await kv.set('class:' + id, c);
  res.json({ class: c });
}));
app.delete('/api/classes/:id', auth, wrap(async (req, res) => {
  const id = req.params.id.toUpperCase();
  for (const q of await classQuizzes(id)) {
    await Promise.all((await kv.list('att:' + q.id + ':')).map(k => kv.del(k)));
    await kv.del('quiz:' + q.id);
  }
  await kv.del('class:' + id);
  res.json({ ok: true });
}));
app.get('/api/quizzes/:id', auth, wrap(async (req, res) => {
  const q = await kv.get('quiz:' + req.params.id.toUpperCase());
  if (!q) return fail(res, 404, 'Introuvable.');
  res.json({ quiz: q });
}));
app.post('/api/quizzes', auth, wrap(async (req, res) => {
  const d = cleanQuiz(req.body || {});
  if (!d.title) return fail(res, 400, 'Donne un titre.');
  if (!d.classId || !(await kv.get('class:' + d.classId))) return fail(res, 400, 'Choisis une classe.');
  if (d.mode === 'libelle') { if (!briefText(d.brief)) return fail(res, 400, 'Écris le libellé du devoir.'); }
  else if (!d.qs.length) return fail(res, 400, 'Ajoute au moins une question.');
  for (let i = 0; i < d.qs.length; i++) {
    const q = d.qs[i], n = i + 1;
    if (!q.q.trim()) return fail(res, 400, `La question ${n} est vide.`);
    if (q.t === 'qcm') {
      if (q.opts.filter(o => o.trim()).length < 2) return fail(res, 400, `La question ${n} doit avoir au moins 2 choix.`);
      if (!q.opts[q.a] || !q.opts[q.a].trim()) return fail(res, 400, `Coche une bonne réponse non vide pour la question ${n}.`);
    }
    if (q.t === 'court' && !q.a.trim()) return fail(res, 400, `Indique la réponse attendue pour la question ${n}.`);
  }
  if (!d.id) {
    d.id = await newCode();
    if (!d.id) return fail(res, 500, 'Impossible de créer un code. Réessaie.');
  } else {
    const old = await kv.get('quiz:' + d.id);
    if (!old) return fail(res, 404, 'Quiz introuvable.');
    d.created = old.created;
  }
  await kv.set('quiz:' + d.id, d);
  res.json({ quiz: d });
}));
app.delete('/api/quizzes/:id', auth, wrap(async (req, res) => {
  const id = req.params.id.toUpperCase();
  const keys = await kv.list('att:' + id + ':');
  await Promise.all(keys.map(k => kv.del(k)));
  await kv.del('quiz:' + id);
  res.json({ ok: true });
}));
app.get('/api/quizzes/:id/results', auth, wrap(async (req, res) => {
  const id = req.params.id.toUpperCase();
  const quiz = await kv.get('quiz:' + id);
  if (!quiz) return fail(res, 404, 'Introuvable.');
  const keys = await kv.list('att:' + id + ':');
  const results = (await Promise.all(keys.map(k => kv.get(k)))).filter(Boolean).map(a => ({
    key: a.key, name: a.name, finished: a.finished, timeUp: !!a.timeUp, ms: a.ms || (Date.now() - a.startedAt),
    answers: a.finished ? a.answers : a.answers, total: a.order.length, flags: a.flags, manual: a.manual || {},
  }));
  results.sort((x, y) => x.name.localeCompare(y.name, 'fr'));
  res.json({ quiz, results });
}));
app.post('/api/results/:id/:key/mark', auth, wrap(async (req, res) => {
  const k = attKey(req.params.id.toUpperCase(), req.params.key);
  const att = await kv.get(k);
  if (!att) return fail(res, 404, 'Copie introuvable.');
  const i = parseInt(req.body.i), v = req.body.v === 1 ? 1 : 0;
  if (!(i >= 0 && i < att.order.length)) return fail(res, 400, 'Question invalide.');
  att.manual = att.manual || {}; att.manual[i] = v;
  await kv.set(k, att);
  res.json({ ok: true });
}));
app.delete('/api/results/:id/:key', auth, wrap(async (req, res) => {
  await kv.del(attKey(req.params.id.toUpperCase(), req.params.key));
  res.json({ ok: true });
}));
app.get('/api/me', auth, (req, res) => res.json({ ok: true }));
app.get('/healthz', (req, res) => res.send('ok'));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d', index: false, setHeaders: (res, p) => { if (p.endsWith('.html') || p.endsWith('.js')) res.set('Cache-Control', 'no-cache'); } }));
app.get('/', (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((req, res) => res.status(404).send('Page introuvable'));

kv.init().then(() => app.listen(PORT, () => console.log('M.Michel en ligne sur le port ' + PORT)))
  .catch(e => { console.error('Erreur de démarrage', e); process.exit(1); });
