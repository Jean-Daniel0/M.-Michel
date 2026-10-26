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

/* Cache de lecture de 5 s devant la base (un seul serveur : chaque écriture invalide le cache, donc rien de périmé).
   Évite que 150 élèves qui interrogent le chat toutes les 6 s ne saturent la base. */
{
  const raw = kv, C = new Map(), L = new Map(), TTL = 5000; let ver = 0;
  kv = {
    onSet: null,
    init: () => raw.init(),
    async get(k) {
      const c = C.get(k);
      if (c && Date.now() - c.t < TTL) return c.v === null ? null : structuredClone(c.v);
      const v0 = ver, v = await raw.get(k);
      if (v0 === ver) { if (C.size > 3000) C.clear(); C.set(k, { t: Date.now(), v: v === null ? null : structuredClone(v) }); }
      return v;
    },
    async list(p) {
      const c = L.get(p);
      if (c && Date.now() - c.t < TTL) return c.v.slice();
      const v0 = ver, v = await raw.list(p);
      if (v0 === ver) { if (L.size > 200) L.clear(); L.set(p, { t: Date.now(), v: v.slice() }); }
      return v;
    },
    async set(k, v) { ver++; C.delete(k); L.clear(); try { await raw.set(k, v); } finally { ver++; C.delete(k); L.clear(); if (kv.onSet) kv.onSet(k, v); } },
    async del(k) { ver++; C.delete(k); L.clear(); try { await raw.del(k); } finally { ver++; C.delete(k); L.clear(); if (kv.onSet) kv.onSet(k); } },
  };
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
function limited(req, max = 15, bucket = '') {
  const ip = req.ip + '|' + bucket, now = Date.now();
  const rec = (tries.get(ip) || []).filter(t => now - t < 60000);
  rec.push(now); tries.set(ip, rec);
  if (tries.size > 5000) tries.clear();
  return rec.length > max;
}

/* ---------- Quiz ---------- */
const SUBJECTS = ['Informatique', 'Éducation à la citoyenneté', 'Éducation esthétique et artistique', 'Autre'];
const PALETTE = new Set(['#ffffff', '#111111', '#16358c', '#b80f2b', '#15704a', '#c25a00', '#6b2fa0', '#555555']);
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
    draft: !!d.draft,
    period: str(d.period, 40).trim(),
    cat: mode !== 'libelle' && ['quiz', 'devoir', 'lecon', 'examen'].includes(d.cat) ? d.cat : '',
    coef: Math.max(0.5, Math.min(10, Math.round((parseFloat(d.coef) || 1) * 2) / 2)),
    created: d.created || Date.now(),
  };
}
const deadlinePassed = q => q.deadline && new Date(q.deadline + 'T23:59:59') < new Date();
const publicInfo = q => ({
  id: q.id, period: q.period || '', title: q.title, subject: q.subject, level: q.level, mode: q.mode, minutes: q.minutes, deadline: q.deadline,
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


/* ---------- Comptes élèves ---------- */
const DEFAULT_PERIODS = ['1re étape', '2e étape', '3e étape'];
const periodsOf = c => (c && Array.isArray(c.periods) && c.periods.length ? c.periods : DEFAULT_PERIODS);
const pseudoKey = p => String(p || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9._-]/g, '');
const stuKey = (cid, pk) => 'stu:' + cid + ':' + pk;
const scryptA = (pw, salt) => new Promise((ok, ko) => crypto.scrypt(String(pw), salt, 32, (e, k) => e ? ko(e) : ok(k))); // asynchrone : le serveur reste fluide pendant que 100 élèves créent leur compte
async function hashPw(pw, salt) { salt = salt || crypto.randomBytes(16).toString('hex'); return { salt, h: (await scryptA(pw, salt)).toString('hex') }; }
async function checkPw(pw, rec) {
  if (!rec || !rec.salt || !rec.h) return false;
  const a = await scryptA(pw, rec.salt), b = Buffer.from(rec.h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const lockMap = new Map();
function locked(k) { const r = (lockMap.get(k) || []).filter(t => Date.now() - t < 600000); lockMap.set(k, r); return r.length >= 8; }
function noteFail(k) { const r = lockMap.get(k) || []; r.push(Date.now()); lockMap.set(k, r); if (lockMap.size > 5000) lockMap.clear(); }
const studentToken = (cid, pk) => sign({ r: 's', c: cid, u: pk, exp: Date.now() + 120 * 864e5 });
async function sauth(req, res, next) {
  try {
    const p = verify((req.get('authorization') || '').replace(/^Bearer /, ''));
    if (!p || p.r !== 's') return fail(res, 401, 'Connecte-toi pour continuer.');
    const rec = await kv.get(stuKey(p.c, p.u));
    if (!rec) return fail(res, 401, 'Compte introuvable. Connecte-toi de nouveau.');
    req.st = { cid: p.c, pk: p.u, sid: 'u_' + p.u, name: rec.name, pseudo: rec.pseudo, rec };
    next();
  } catch (e) { console.error(e); fail(res, 500, 'Erreur du serveur. Réessaie.'); }
}
function attScore(a) {
  let s = 0, g = 0, p = 0;
  (a.answers || []).forEach((x, i) => {
    const m = a.manual && a.manual[i];
    const e = (m === 0 || m === 1) ? m : (x.ok === true ? 1 : x.ok === false ? 0 : null);
    if (e === null) p++; else { g++; if (e === 1) s++; }
  });
  return { s, g, p, score10: g ? Math.round(100 * s / g) / 10 : null };
}
async function gradedQuizzes(cid) { return (await classQuizzes(cid)).filter(q => !q.draft && q.qs.length); }
async function studentHistory(cid, sid, quizzes) {
  quizzes = quizzes || await gradedQuizzes(cid);
  const out = [];
  for (const q of quizzes) {
    const a = await kv.get(attKey(q.id, sid));
    if (!a || !a.finished) continue;
    const sc = attScore(a);
    out.push({ qid: q.id, title: q.title, period: q.period || '', coef: q.coef || 1, at: a.finishedAt || a.startedAt, ...sc, timeUp: !!a.timeUp });
  }
  return out.sort((x, y) => x.at - y.at);
}
function weighted(items) {
  const v = items.filter(x => x.score10 !== null);
  const w = v.reduce((t, x) => t + (x.coef || 1), 0);
  return w ? Math.round(10 * v.reduce((t, x) => t + x.score10 * (x.coef || 1), 0) / w) / 10 : null;
}
const meanOf = v => { v = v.filter(x => x !== null); return v.length ? Math.round(10 * v.reduce((a, b) => a + b, 0) / v.length) / 10 : null; };

/* Connexion unique : le code du professeur ouvre l'espace prof, un code de classe ouvre la liste de ses travaux */
app.post('/api/login', wrap(async (req, res) => {
  // seuls les codes FAUX comptent : toute une classe sur le même wifi peut entrer son code sans être bloquée
  const failKey = req.ip + '|lgfail', nowT = Date.now();
  if ((tries.get(failKey) || []).filter(t => nowT - t < 60000).length >= 15) return fail(res, 429, 'Trop d\'essais. Attends une minute.');
  const code = str(req.body.code, 100).trim();
  if (!code) return fail(res, 400, 'Entre ton code.');
  if (safeEq(code, TEACHER_CODE)) return res.json({ role: 'teacher', token: sign({ r: 't', exp: Date.now() + 30 * 864e5 }) });
  const cls = await kv.get('class:' + code.toUpperCase());
  if (!cls) { limited(req, 15, 'lgfail'); return fail(res, 404, 'Code introuvable. Vérifie-le avec ton professeur.'); }
  res.json({ role: 'class', class: { name: cls.name, level: cls.level || '' } });
}));

app.post('/api/student/register', wrap(async (req, res) => {
  if (limited(req, 600, 'reg')) return fail(res, 429, 'Trop d\'essais. Attends une minute.');
  const cid = str(req.body.code, 8).toUpperCase(), cls = await kv.get('class:' + cid);
  if (!cls) return fail(res, 404, 'Code de classe introuvable.');
  const name = str(req.body.name, 80).trim().replace(/\s+/g, ' '), pseudo = str(req.body.pseudo, 20).trim(), pw = str(req.body.password, 64);
  const pk = pseudoKey(pseudo);
  if (norm(name).length < 3 || !/\s/.test(name)) return fail(res, 400, 'Écris ton prénom et ton nom.');
  if (pk.length < 3 || pk !== pseudo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')) return fail(res, 400, 'Le pseudo doit avoir 3 à 20 caractères : lettres, chiffres, point, tiret ou _.');
  if (pw.length < 4) return fail(res, 400, 'Le mot de passe doit avoir au moins 4 caractères.');
  if (await kv.get(stuKey(cid, pk))) return fail(res, 409, 'Ce pseudo est déjà pris dans la classe. Choisis-en un autre.');
  if ((await kv.list('stu:' + cid + ':')).length >= 400) return fail(res, 409, 'La classe est pleine. Préviens ton professeur.');
  const rec = { name, pseudo: pk, ...(await hashPw(pw)), created: Date.now() };
  await kv.set(stuKey(cid, pk), rec);
  res.json({ token: studentToken(cid, pk), student: { name, pseudo: pk } });
}));
app.post('/api/student/login', wrap(async (req, res) => {
  if (limited(req, 600, 'slg')) return fail(res, 429, 'Trop d\'essais. Attends une minute.');
  const cid = str(req.body.code, 8).toUpperCase(), pk = pseudoKey(str(req.body.pseudo, 20)), pw = str(req.body.password, 64);
  const lk = cid + ':' + pk;
  if (locked(lk)) return fail(res, 429, 'Trop d\'erreurs. Attends 10 minutes ou demande à ton professeur de réinitialiser ton mot de passe.');
  const rec = pk ? await kv.get(stuKey(cid, pk)) : null;
  if (!rec || !(await checkPw(pw, rec))) { noteFail(lk); return fail(res, 401, 'Pseudo ou mot de passe incorrect.'); }
  res.json({ token: studentToken(cid, pk), student: { name: rec.name, pseudo: pk } });
}));
app.get('/api/student/me', sauth, wrap(async (req, res) => {
  const cls = await kv.get('class:' + req.st.cid);
  if (!cls) return fail(res, 401, 'Classe introuvable.');
  const qs = (await classQuizzes(cls.id)).filter(q => !q.draft);
  const devoirs = [];
  for (const q of qs) {
    const info = publicInfo(q);
    if (q.qs.length) {
      const a = await kv.get(attKey(q.id, req.st.sid));
      if (a) { const sc = attScore(a); info.mine = { finished: !!a.finished, score10: a.finished ? sc.score10 : null, pending: a.finished ? sc.p : 0 }; }
    }
    devoirs.push(info);
  }
  res.json({ class: { name: cls.name, level: cls.level || '' }, student: { name: req.st.name, pseudo: req.st.pseudo, avatar: profileOf(req.st.rec).avatar, photo: req.st.rec.photo || '', pv: req.st.rec.pv || 0 }, devoirs });
}));
app.get('/api/student/history', sauth, wrap(async (req, res) => {
  const h = await studentHistory(req.st.cid, req.st.sid);
  res.json({ name: req.st.name, history: h, avg10: weighted(h) });
}));

/* ---------- Profil (avatar / photo) ---------- */
const AVATARS = 12;
const profileOf = r => ({ name: r.name, avatar: Number.isInteger(r.avatar) ? r.avatar : null, photo: r.photo || '', pv: r.pv || 0 });
app.put('/api/student/profile', sauth, wrap(async (req, res) => {
  if (limited(req, 300, 'prof')) return fail(res, 429, 'Trop d\'essais. Attends une minute.');
  const rec = { ...req.st.rec };
  const b = req.body || {};
  if (b.clear) { delete rec.photo; delete rec.avatar; }
  else if (typeof b.photo === 'string') {
    if (!/^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.photo) || b.photo.length > 30000) return fail(res, 400, 'Photo trop lourde ou invalide.');
    rec.photo = b.photo; delete rec.avatar;
  } else if (Number.isInteger(b.avatar) && b.avatar >= 0 && b.avatar < AVATARS) { rec.avatar = b.avatar; delete rec.photo; }
  else return fail(res, 400, 'Choix invalide.');
  rec.pv = Date.now();
  await kv.set(stuKey(req.st.cid, req.st.pk), rec);
  res.json({ profile: profileOf(rec) });
}));
app.get('/api/student/profile/:pk', sauth, wrap(async (req, res) => {
  const rec = await kv.get(stuKey(req.st.cid, pseudoKey(req.params.pk)));
  if (!rec) return fail(res, 404, 'Introuvable.');
  res.json({ profile: profileOf(rec) });
}));
app.post('/api/classes/:id/students/:pk/photo/delete', auth, wrap(async (req, res) => {
  const cid = req.params.id.toUpperCase(), pk = pseudoKey(req.params.pk), rec = await kv.get(stuKey(cid, pk));
  if (!rec) return fail(res, 404, 'Élève introuvable.');
  delete rec.photo; delete rec.avatar; rec.pv = Date.now();
  await kv.set(stuKey(cid, pk), rec);
  res.json({ ok: true });
}));

/* ---------- Chat de classe (modéré) ---------- */
const BAD = ['fdp', 'ntm', 'pute', 'putain', 'connard', 'connasse', 'salope', 'encule', 'merde', 'batard', 'bouzin', 'kaka', 'bouda', 'koshon', 'koukou', 'zobo', 'manman ou', 'fout', 'nique', 'idiot', 'imbecile', 'stupide', 'con'];
const stripAcc = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const badRe = new RegExp('(^|[^a-z0-9])(' + BAD.map(w => w.replace(/ /g, '\\s+')).join('|') + ')s?(?=$|[^a-z0-9])', 'gi');
function cleanText(t) {
  const plain = stripAcc(t);
  // même longueur après retrait des accents : on masque aux mêmes positions
  if (plain.length !== t.length) return plain.replace(badRe, (m, a, w) => a + '*'.repeat(w.length)) === plain ? t : t.replace(/./g, '*');
  let out = t;
  plain.replace(badRe, (m, a, w, off) => { const st = off + a.length; out = out.slice(0, st) + '*'.repeat(m.length - a.length) + out.slice(st + m.length - a.length); return m; });
  return out;
}
const chatLock = new Map();
async function withChat(cid, fn) {
  const prev = chatLock.get(cid) || Promise.resolve();
  const next = prev.then(fn, fn);
  chatLock.set(cid, next.catch(() => {}));
  return next;
}
const chatKey = cid => 'chat:' + cid;
const hmNow = () => new Intl.DateTimeFormat('fr-FR', { timeZone: 'America/Port-au-Prince', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
function chatSettings(cls) { return Object.assign({ on: true, from: '', to: '' }, cls.chat || {}); }
function inHours(cs) {
  if (!cs.from || !cs.to) return true;
  const n = hmNow().replace('24', '00');
  return cs.from <= cs.to ? (n >= cs.from && n <= cs.to) : (n >= cs.from || n <= cs.to);
}
async function inQuiz(cid, sid) {
  if (!String(sid).startsWith('u_')) return false;
  return (await activeQuizTakers(cid)).has(sid.slice(2));
}
async function chatState(st) {
  const cls = await kv.get('class:' + st.cid), cs = chatSettings(cls || {});
  if (!cs.on) return { open: false, reason: 'Le chat est fermé par ton professeur.' };
  if (!inHours(cs)) return { open: false, reason: 'Le chat est fermé pour le moment (ouvert de ' + cs.from + ' à ' + cs.to + ').' };
  if (st.rec.muted) return { open: false, reason: 'Ton professeur a coupé ton chat.', muted: true };
  if (await inQuiz(st.cid, st.sid)) return { open: false, reason: 'Le chat est bloqué pendant un quiz.' };
  return { open: true };
}
const RX_OK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const rxSum = (m, me) => { const c = {}; for (const [pk, e] of Object.entries(m.rx || {})) { c[e] = c[e] || { e, n: 0, mine: false }; c[e].n++; if (pk === me) c[e].mine = true; } return Object.values(c).sort((a, b) => b.n - a.n); };
const pubMsg = (m, me) => ({ rx: rxSum(m, me), id: m.id, pk: m.pk, name: m.name, text: m.text, ts: m.ts, pv: m.pv || 0, reply: m.reply || null, mine: m.pk === me, reported: (m.reports || []).includes(me) });
app.get('/api/chat', sauth, wrap(async (req, res) => {
  const st = await chatState(req.st);
  const since = parseInt(req.query.since) || 0;
  const list = (await kv.get(chatKey(req.st.cid))) || [];
  const rxs = {}; list.forEach(m => { if (m.rx && Object.keys(m.rx).length) rxs[m.id] = rxSum(m, req.st.pk); });
  res.json({ ...st, now: Date.now(), rxs, messages: list.filter(m => m.ts > since).map(m => pubMsg(m, req.st.pk)) });
}));
app.get('/api/chat/unread', sauth, wrap(async (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const list = (await kv.get(chatKey(req.st.cid))) || [];
  const mine = list.filter(m => m.ts > since && m.pk !== req.st.pk);
  res.json({ count: Math.min(mine.length, 99), last: list.length ? list[list.length - 1].ts : 0 });
}));
const sendLog = new Map();
app.post('/api/chat', sauth, wrap(async (req, res) => {
  const st = await chatState(req.st);
  if (!st.open) return fail(res, 403, st.reason);
  const k = req.st.cid + ':' + req.st.pk, now = Date.now();
  const rec = (sendLog.get(k) || []).filter(t => now - t < 60000);
  if (rec.length >= 6) return fail(res, 429, 'Doucement ! Maximum 6 messages par minute.');
  const text = String(req.body.text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!text) return fail(res, 400, 'Écris un message.');
  rec.push(now); sendLog.set(k, rec); if (sendLog.size > 5000) sendLog.clear();
  const m = { id: now.toString(36) + crypto.randomBytes(3).toString('hex'), pk: req.st.pk, name: req.st.name, text: cleanText(text), ts: now, pv: req.st.rec.pv || 0 };
  const replyId = str(req.body.replyTo, 40);
  await withChat(req.st.cid, async () => {
    const list = (await kv.get(chatKey(req.st.cid))) || [];
    const o = replyId && list.find(x => x.id === replyId);
    if (o) m.reply = { id: o.id, pk: o.pk, name: o.name, text: o.text.length > 80 ? o.text.slice(0, 77) + '…' : o.text };
    list.push(m);
    await kv.set(chatKey(req.st.cid), list.slice(-150));
  });
  res.json({ message: pubMsg(m, req.st.pk) });
  notifyChat(req.st, m);
}));
app.post('/api/chat/react', sauth, wrap(async (req, res) => {
  const st = await chatState(req.st);
  if (!st.open) return fail(res, 403, st.reason);
  const id = str(req.body.id, 40), e = str(req.body.emoji, 8);
  if (!RX_OK.includes(e)) return fail(res, 400, 'Réaction non permise.');
  let out = [];
  await withChat(req.st.cid, async () => {
    const list = (await kv.get(chatKey(req.st.cid))) || [];
    const m = list.find(x => x.id === id);
    if (!m) return;
    m.rx = m.rx || {};
    if (m.rx[req.st.pk] === e) delete m.rx[req.st.pk]; else m.rx[req.st.pk] = e; // un seul emoji par élève et par message ; même emoji = retrait
    await kv.set(chatKey(req.st.cid), list);
    out = rxSum(m, req.st.pk);
  });
  res.json({ id, rx: out });
}));
app.post('/api/chat/report', sauth, wrap(async (req, res) => {
  const id = str(req.body.id, 40);
  await withChat(req.st.cid, async () => {
    const list = (await kv.get(chatKey(req.st.cid))) || [];
    const m = list.find(x => x.id === id);
    if (m && m.pk !== req.st.pk) { m.reports = [...new Set([...(m.reports || []), req.st.pk])]; await kv.set(chatKey(req.st.cid), list); }
  });
  res.json({ ok: true });
}));
app.get('/api/classes/:id/chat', auth, wrap(async (req, res) => {
  const cid = req.params.id.toUpperCase(), cls = await kv.get('class:' + cid);
  if (!cls) return fail(res, 404, 'Classe introuvable.');
  const list = (await kv.get(chatKey(cid))) || [];
  res.json({ settings: chatSettings(cls), now: hmNow(), messages: list.map(m => ({ id: m.id, pk: m.pk, name: m.name, text: m.text, ts: m.ts, reports: (m.reports || []).length })) });
}));
app.delete('/api/classes/:id/chat/:mid', auth, wrap(async (req, res) => {
  const cid = req.params.id.toUpperCase();
  await withChat(cid, async () => {
    const list = (await kv.get(chatKey(cid))) || [];
    await kv.set(chatKey(cid), list.filter(m => m.id !== req.params.mid));
  });
  res.json({ ok: true });
}));
app.post('/api/classes/:id/chat/settings', auth, wrap(async (req, res) => {
  const cid = req.params.id.toUpperCase(), cls = await kv.get('class:' + cid);
  if (!cls) return fail(res, 404, 'Classe introuvable.');
  const t = v => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : '');
  let from = t(req.body.from), to = t(req.body.to);
  if (!from || !to) from = to = '';
  cls.chat = { on: !!req.body.on, from, to };
  await kv.set('class:' + cid, cls);
  res.json({ settings: chatSettings(cls) });
}));
app.post('/api/classes/:id/students/:pk/mute', auth, wrap(async (req, res) => {
  const cid = req.params.id.toUpperCase(), pk = pseudoKey(req.params.pk), rec = await kv.get(stuKey(cid, pk));
  if (!rec) return fail(res, 404, 'Élève introuvable.');
  rec.muted = !!req.body.muted;
  await kv.set(stuKey(cid, pk), rec);
  res.json({ ok: true, muted: rec.muted });
}));

/* Libellé d'un devoir (page blanche côté élève) : il faut connaître le code de la classe */
app.post('/api/brief', sauth, wrap(async (req, res) => {
  const classId = req.st.cid, qid = str(req.body.qid, 8).toUpperCase();
  const quiz = await kv.get('quiz:' + qid);
  if (!quiz || quiz.draft || quiz.classId !== classId || !briefText(quiz.brief)) return fail(res, 404, 'Libellé introuvable.');
  res.json({ title: quiz.title, brief: quiz.brief });
}));

app.post('/api/start', sauth, wrap(async (req, res) => {
  if (limited(req, 600, 'start')) return fail(res, 429, 'Trop d\'essais. Attends une minute.');
  const id = str(req.body.qid, 8).toUpperCase(), classId = req.st.cid, name = req.st.name, key = req.st.sid;
  const quiz = await kv.get('quiz:' + id);
  if (!quiz || quiz.draft || quiz.classId !== classId) return fail(res, 404, 'Travail introuvable.');
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
  qtCache.delete(classId);
  att = { id, name, key, pseudo: req.st.pseudo, token: crypto.randomBytes(18).toString('base64url'), startedAt: now, qStart: now, endsAt: quiz.minutes > 0 ? now + quiz.minutes * 60000 : null, order, answers: [], flags: { paste: 0, leave: 0, leaveMs: 0, jump: 0 }, finished: false };
  await kv.set(attKey(id, key), att);
  res.json({ token: att.token, state: state(att, quiz) });
}));

async function loadAtt(req, res) {
  const id = str(req.body.qid, 8).toUpperCase(), key = req.st.sid;
  const [quiz, att] = await Promise.all([kv.get('quiz:' + id), kv.get(attKey(id, key))]);
  if (!quiz || !att || quiz.classId !== req.st.cid) { fail(res, 404, 'Travail introuvable.'); return null; }
  if (!req.body.token || !safeEq(String(req.body.token), att.token)) { fail(res, 403, 'Accès refusé.'); return null; }
  return { id, key, quiz, att };
}

app.post('/api/answer', sauth, wrap(async (req, res) => {
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

app.post('/api/finish', sauth, wrap(async (req, res) => {
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

app.post('/api/flags', sauth, wrap(async (req, res) => {
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
app.get('/api/classes/:id/stats', auth, wrap(async (req, res) => {
  const c = await kv.get('class:' + req.params.id.toUpperCase());
  if (!c) return fail(res, 404, 'Classe introuvable.');
  const qs = (await classQuizzes(c.id)).filter(q => q.qs.length);
  const eff = (a, i, man) => { const m = man && man[i]; if (m === 0 || m === 1) return m; return a.ok === true ? 1 : a.ok === false ? 0 : null; };
  const mean = v => v.length ? Math.round(v.reduce((x, y) => x + y, 0) / v.length) : null;
  const per = [], students = {}, all = [];
  let flagged = 0;
  for (const q of qs) {
    const keys = await kv.list('att:' + q.id + ':');
    const atts = (await Promise.all(keys.map(k => kv.get(k)))).filter(a => a && a.finished);
    const hard = {}, pcts = [];
    for (const a of atts) {
      let s = 0, g = 0;
      a.answers.forEach((x, i) => {
        const e = eff(x, i, a.manual); if (e === null) return;
        g++; if (e === 1) s++;
        const h = hard[x.q] || (hard[x.q] = { q: x.q, seen: 0, wrong: 0 });
        h.seen++; if (e === 0) h.wrong++;
      });
      if (g) { const p = Math.round(100 * s / g); pcts.push(p); all.push(p); (students[a.name] = students[a.name] || []).push(p); }
      const f = a.flags || {}; if (f.paste || f.leave || f.jump) flagged++;
    }
    per.push({
      id: q.id, title: q.title, mode: q.mode, copies: atts.length, avg: mean(pcts),
      min: pcts.length ? Math.min(...pcts) : null, max: pcts.length ? Math.max(...pcts) : null,
      hard: Object.values(hard).filter(h => h.wrong > 0).map(h => ({ q: h.q.slice(0, 200), seen: h.seen, wrong: h.wrong, pct: Math.round(100 * h.wrong / h.seen) }))
        .sort((x, y) => y.pct - x.pct || y.wrong - x.wrong).slice(0, 5),
    });
  }
  const low = Object.entries(students).map(([name, v]) => ({ name, avg: mean(v), n: v.length })).filter(s => s.avg < 50).sort((a, b) => a.avg - b.avg).slice(0, 5);
  res.json({ class: { id: c.id, name: c.name }, copies: all.length, avg: mean(all), flagged, per, low });
}));
app.get('/api/classes/:id/students', auth, wrap(async (req, res) => {
  const cid = req.params.id.toUpperCase();
  const recs = (await Promise.all((await kv.list('stu:' + cid + ':')).map(k => kv.get(k)))).filter(Boolean);
  recs.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  res.json({ students: recs.map(r => ({ name: r.name, pseudo: r.pseudo, created: r.created, muted: !!r.muted, avatar: Number.isInteger(r.avatar) ? r.avatar : null, photo: r.photo || '' })) });
}));
app.post('/api/classes/:id/students/:pk/reset', auth, wrap(async (req, res) => {
  const cid = req.params.id.toUpperCase(), pk = pseudoKey(req.params.pk), rec = await kv.get(stuKey(cid, pk));
  if (!rec) return fail(res, 404, 'Élève introuvable.');
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  const pw = Array.from({ length: 6 }, () => A[crypto.randomInt(A.length)]).join('');
  await kv.set(stuKey(cid, pk), { ...rec, ...(await hashPw(pw)) });
  lockMap.delete(cid + ':' + pk);
  res.json({ password: pw });
}));
app.delete('/api/classes/:id/students/:pk', auth, wrap(async (req, res) => {
  await kv.del(stuKey(req.params.id.toUpperCase(), pseudoKey(req.params.pk)));
  res.json({ ok: true });
}));
app.get('/api/classes/:id/carnet', auth, wrap(async (req, res) => {
  const c = await kv.get('class:' + req.params.id.toUpperCase());
  if (!c) return fail(res, 404, 'Classe introuvable.');
  const period = str(req.query.period, 40), zero = req.query.zero === '1';
  let quizzes = await gradedQuizzes(c.id);
  if (period) quizzes = quizzes.filter(q => q.period === period);
  const rows = new Map();
  const recs = (await Promise.all((await kv.list('stu:' + c.id + ':')).map(k => kv.get(k)))).filter(Boolean);
  recs.forEach(r => rows.set('u_' + r.pseudo, { sid: 'u_' + r.pseudo, name: r.name, pseudo: r.pseudo, items: {} }));
  for (const q of quizzes) {
    const atts = (await Promise.all((await kv.list('att:' + q.id + ':')).map(k => kv.get(k)))).filter(Boolean);
    for (const a of atts) {
      if (!rows.has(a.key)) rows.set(a.key, { sid: a.key, name: a.name, pseudo: '', legacy: true, items: {} });
      rows.get(a.key).items[q.id] = a.finished ? { ...attScore(a), coef: q.coef || 1 } : { inProgress: true, score10: null, p: 0, coef: q.coef || 1 };
    }
  }
  const students = [...rows.values()].map(r => {
    const list = quizzes.map(q => {
      const it = r.items[q.id];
      if (it && it.score10 !== null && it.score10 !== undefined) return { score10: it.score10, coef: q.coef || 1, p: it.p };
      return zero ? { score10: 0, coef: q.coef || 1, p: 0, missing: true } : { score10: null, coef: q.coef || 1, p: 0 };
    });
    const done = quizzes.filter(q => r.items[q.id] && r.items[q.id].score10 !== null && r.items[q.id].score10 !== undefined).length;
    const provisional = Object.values(r.items).some(it => it.p > 0);
    return { sid: r.sid, name: r.name, pseudo: r.pseudo, legacy: !!r.legacy, scores: Object.fromEntries(quizzes.map(q => [q.id, r.items[q.id] ? { score10: r.items[q.id].score10 ?? null, pending: r.items[q.id].p || 0, inProgress: !!r.items[q.id].inProgress } : null])), avg10: weighted(list), done, provisional };
  }).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const ranked = students.filter(s => s.avg10 !== null).sort((a, b) => b.avg10 - a.avg10);
  ranked.forEach((s, i) => { s.rank = i > 0 && ranked[i - 1].avg10 === s.avg10 ? ranked[i - 1].rank : i + 1; });
  res.json({
    class: { id: c.id, name: c.name }, periods: periodsOf(c), period, zero,
    quizzes: quizzes.map(q => ({ id: q.id, title: q.title, coef: q.coef || 1, period: q.period || '', mode: q.mode })),
    students, classAvg: meanOf(students.map(s => s.avg10)), rankedCount: ranked.length,
  });
}));
app.get('/api/classes/:id/students/:sid/history', auth, wrap(async (req, res) => {
  const cid = req.params.id.toUpperCase(), sid = String(req.params.sid).slice(0, 60);
  const h = await studentHistory(cid, sid);
  const rec = sid.startsWith('u_') ? await kv.get(stuKey(cid, sid.slice(2))) : null;
  const name = rec ? rec.name : (h.length ? ((await kv.get(attKey(h[0].qid, sid))) || {}).name : sid);
  const c = await kv.get('class:' + cid);
  const byPeriod = periodsOf(c).map(p => ({ period: p, avg10: weighted(h.filter(x => x.period === p)), n: h.filter(x => x.period === p).length }));
  res.json({ name: name || sid, history: h, avg10: weighted(h), byPeriod });
}));
/* ---------- Bulletin sur 100 : catégories pondérées + notes manuelles ---------- */
const CATS = ['quiz', 'devoir', 'lecon', 'examen'];
const DEF_W = { quiz: 30, devoir: 15, lecon: 25, examen: 30 };
const catOf = q => CATS.includes(q.cat) ? q.cat : (q.mode === 'devoir' ? 'devoir' : 'quiz');
function gradingOf(c) {
  const g = (c && c.grading) || {}, w = {};
  CATS.forEach(k => { const v = Number(g.w && g.w[k]); w[k] = Number.isFinite(v) && v >= 0 && v <= 100 ? v : DEF_W[k]; });
  return { w, absent: g.absent === 'zero' ? 'zero' : 'ns' };
}
const r1 = v => Math.round(v * 10) / 10;
const manKey = (cid, id) => 'man:' + cid + ':' + id;
async function manualEntries(cid) {
  const list = (await Promise.all((await kv.list('man:' + cid + ':')).map(k => kv.get(k)))).filter(Boolean);
  return list.sort((a, b) => (a.created || 0) - (b.created || 0));
}
const bulMemo = new Map();
async function bulletinData(c) {
  const m = bulMemo.get(c.id);
  if (m && Date.now() - m.t < 10000) return m.d;
  const quizzes = (await gradedQuizzes(c.id)).filter(q => q.mode !== 'libelle');
  const atts = {};
  for (const q of quizzes) {
    const l = (await Promise.all((await kv.list('att:' + q.id + ':')).map(k => kv.get(k)))).filter(Boolean);
    atts[q.id] = Object.fromEntries(l.map(a => [a.key, a]));
  }
  const manual = await manualEntries(c.id);
  const studs = (await Promise.all((await kv.list('stu:' + c.id + ':')).map(k => kv.get(k)))).filter(Boolean);
  const d = { quizzes, atts, manual, studs };
  if (bulMemo.size > 50) bulMemo.clear();
  bulMemo.set(c.id, { t: Date.now(), d });
  return d;
}
// Une note par catégorie = moyenne (pondérée par les coefficients) de ses travaux, multipliée par les points de la catégorie.
// Seules les catégories où l'élève a au moins une note comptent : le total s'accumule au fil de la période.
function bulRow(c, d, pseudo, period) {
  const g = gradingOf(c), sid = 'u_' + pseudo, items = { quiz: [], devoir: [], lecon: [], examen: [] }, cells = {};
  for (const q of d.quizzes) {
    if (period && q.period !== period) continue;
    const a = d.atts[q.id] && d.atts[q.id][sid];
    let f = null;
    if (a && a.finished) { const sc = attScore(a); if (sc.score10 !== null) { f = sc.score10 / 10; cells['q:' + q.id] = { v: sc.score10, p: sc.p > 0 }; } }
    else if (a) cells['q:' + q.id] = { ip: true };
    else if (g.absent === 'zero' && deadlinePassed(q)) { f = 0; cells['q:' + q.id] = { v: 0, z: true }; }
    if (a && a.finished && f === null) cells['q:' + q.id] = { p: true };
    if (f !== null) items[catOf(q)].push({ f, coef: q.coef || 1 });
  }
  for (const e of d.manual) {
    if (period && e.period !== period) continue;
    const v = e.notes && e.notes[pseudo];
    if (typeof v === 'number' && e.max > 0 && CATS.includes(e.cat)) { items[e.cat].push({ f: v / e.max, coef: 1 }); cells['m:' + e.id] = { v }; }
  }
  const cats = {}; let pts = 0, of = 0;
  for (const k of CATS) {
    const it = items[k], w = g.w[k];
    if (!it.length || !w) { cats[k] = { n: it.length, avg: null, pts: null, of: w }; continue; }
    const sw = it.reduce((t, x) => t + x.coef, 0), avg = it.reduce((t, x) => t + x.f * x.coef, 0) / sw;
    cats[k] = { n: it.length, avg: Math.round(avg * 1000) / 1000, pts: r1(avg * w), of: w };
    pts += avg * w; of += w;
  }
  return { cats, cells, pts: r1(pts), of, eq100: of ? r1(pts / of * 100) : null };
}
function bulTable(c, d, period) {
  const rows = d.studs.map(r => ({ pseudo: r.pseudo, name: r.name, ...bulRow(c, d, r.pseudo, period) })).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const ranked = rows.filter(r => r.eq100 !== null).sort((a, b) => b.eq100 - a.eq100);
  ranked.forEach((r, i) => { r.rank = i > 0 && ranked[i - 1].eq100 === r.eq100 ? ranked[i - 1].rank : i + 1; });
  const v = ranked.map(r => r.eq100);
  return { rows, rankedCount: ranked.length, classAvg: v.length ? r1(v.reduce((t, x) => t + x, 0) / v.length) : null };
}
app.get('/api/classes/:id/bulletin', auth, wrap(async (req, res) => {
  const c = await kv.get('class:' + req.params.id.toUpperCase());
  if (!c) return fail(res, 404, 'Classe introuvable.');
  const period = str(req.query.period, 40), d = await bulletinData(c), t = bulTable(c, d, period);
  res.json({ class: { id: c.id, name: c.name }, periods: periodsOf(c), period, grading: gradingOf(c), students: t.rows, classAvg: t.classAvg, rankedCount: t.rankedCount,
    columns: [
      ...d.quizzes.filter(q => !period || q.period === period).map(q => ({ id: 'q:' + q.id, title: q.title, cat: catOf(q), max: 10, auto: true, coef: q.coef || 1, period: q.period || '', created: q.created || 0 })),
      ...d.manual.filter(e => !period || e.period === period).map(e => ({ id: 'm:' + e.id, mid: e.id, title: e.title, cat: e.cat, max: e.max, auto: false, coef: 1, period: e.period || '', created: e.created || 0 })),
    ].sort((a, b) => CATS.indexOf(a.cat) - CATS.indexOf(b.cat) || a.created - b.created) });
}));
app.get('/api/student/bulletin', sauth, wrap(async (req, res) => {
  const c = await kv.get('class:' + req.st.cid);
  if (!c) return fail(res, 404, 'Classe introuvable.');
  const d = await bulletinData(c), out = [];
  for (const p of ['', ...periodsOf(c)]) {
    const t = bulTable(c, d, p), me = t.rows.find(r => r.pseudo === req.st.pseudo);
    if (me && me.eq100 !== null) out.push({ period: p, cats: me.cats, pts: me.pts, of: me.of, eq100: me.eq100, rank: me.rank, rankedCount: t.rankedCount });
  }
  res.json({ grading: gradingOf(c), periods: out });
}));
const CAT_LABEL = { quiz: 'Quiz', devoir: 'Devoir', lecon: 'Leçon', examen: 'Examen' };
app.get('/api/classes/:id/manual', auth, wrap(async (req, res) => {
  const c = await kv.get('class:' + req.params.id.toUpperCase());
  if (!c) return fail(res, 404, 'Classe introuvable.');
  const d = await bulletinData(c);
  res.json({ entries: d.manual, students: d.studs.map(r => ({ pseudo: r.pseudo, name: r.name })).sort((a, b) => a.name.localeCompare(b.name, 'fr')), periods: periodsOf(c), grading: gradingOf(c) });
}));
app.post('/api/classes/:id/manual', auth, wrap(async (req, res) => {
  const c = await kv.get('class:' + req.params.id.toUpperCase());
  if (!c) return fail(res, 404, 'Classe introuvable.');
  const b = req.body || {}, title = str(b.title, 80).trim();
  if (!title) return fail(res, 400, 'Donne un titre à cette note (ex : Récitation 1, Examen).');
  const max = Math.round((parseFloat(b.max) || 0) * 100) / 100;
  if (!(max > 0 && max <= 1000)) return fail(res, 400, 'Choisis le total de points (ex : 10, 20 ou 100).');
  const cat = CATS.includes(b.cat) ? b.cat : 'lecon';
  const period = periodsOf(c).includes(b.period) ? b.period : '';
  const pseudos = new Set((await kv.list('stu:' + c.id + ':')).map(k => k.slice(('stu:' + c.id + ':').length)));
  const notes = {};
  if (b.notes && typeof b.notes === 'object') for (const [pk, v] of Object.entries(b.notes)) {
    if (!pseudos.has(pk) || v === '' || v === null || v === undefined) continue;
    const n = parseFloat(String(v).replace(',', '.'));
    if (Number.isFinite(n)) notes[pk] = Math.round(Math.max(0, Math.min(max, n)) * 100) / 100;
  }
  let id = str(b.id, 12).replace(/[^a-z0-9]/gi, ''), old = id ? await kv.get(manKey(c.id, id)) : null;
  if (!old) id = crypto.randomBytes(4).toString('hex');
  const e = { id, title, cat, period, max, notes, created: old ? old.created : Date.now() };
  await kv.set(manKey(c.id, id), e);
  res.json({ entry: e });
}));
app.put('/api/classes/:id/manual/:mid/note', auth, wrap(async (req, res) => {
  const cid = req.params.id.toUpperCase(), mid = str(req.params.mid, 12).replace(/[^a-z0-9]/gi, '');
  const e = await kv.get(manKey(cid, mid));
  if (!e) return fail(res, 404, 'Colonne introuvable.');
  const pk = pseudoKey(str(req.body.pseudo, 20));
  if (!(await kv.get(stuKey(cid, pk)))) return fail(res, 404, 'Élève introuvable.');
  e.notes = e.notes || {};
  const raw = req.body.value;
  if (raw === '' || raw === null || raw === undefined) delete e.notes[pk];
  else {
    const n = parseFloat(String(raw).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > e.max) return fail(res, 400, 'La note doit être entre 0 et ' + e.max + '.');
    e.notes[pk] = Math.round(n * 100) / 100;
  }
  await kv.set(manKey(cid, mid), e);
  res.json({ ok: true, value: e.notes[pk] === undefined ? '' : e.notes[pk] });
}));
app.delete('/api/classes/:id/manual/:mid', auth, wrap(async (req, res) => {
  await kv.del(manKey(req.params.id.toUpperCase(), str(req.params.mid, 12).replace(/[^a-z0-9]/gi, '')));
  res.json({ ok: true });
}));

app.get('/api/classes/:id', auth, wrap(async (req, res) => {
  const c = await kv.get('class:' + req.params.id.toUpperCase());
  if (!c) return fail(res, 404, 'Classe introuvable.');
  const qs = await classQuizzes(c.id);
  const counts = await Promise.all(qs.map(async q => (await kv.list('att:' + q.id + ':')).length));
  qs.forEach((q, i) => { q.n = counts[i]; delete q.brief; });
  c.periods = periodsOf(c);
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
  if (Array.isArray(req.body.periods)) {
    const ps = [...new Set(req.body.periods.map(x => str(x, 40).trim()).filter(Boolean))].slice(0, 8);
    if (ps.length) c.periods = ps;
  }
  if (req.body.grading && typeof req.body.grading === 'object') {
    const w = {}; CATS.forEach(k => { const v = Number(req.body.grading.w && req.body.grading.w[k]); w[k] = Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v * 2) / 2)) : DEF_W[k]; });
    c.grading = { w, absent: req.body.grading.absent === 'zero' ? 'zero' : 'ns' };
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
  await Promise.all((await kv.list('stu:' + id + ':')).map(k => kv.del(k)));
  await Promise.all((await kv.list('man:' + id + ':')).map(k => kv.del(k)));
  await kv.del(chatKey(id));
  await kv.del('class:' + id);
  res.json({ ok: true });
}));
app.get('/api/quizzes/:id', auth, wrap(async (req, res) => {
  const q = await kv.get('quiz:' + req.params.id.toUpperCase());
  if (!q) return fail(res, 404, 'Introuvable.');
  res.json({ quiz: q });
}));
/* ---------- Notifications push (OneSignal) ---------- */
const OS_BASE = process.env.ONESIGNAL_BASE_URL || 'https://api.onesignal.com';
const osKey = () => process.env.ONESIGNAL_REST_API_KEY || process.env.ONESIGNAL_API_KEY || '';
const OS_APP = process.env.ONESIGNAL_APP_ID || '42d7f370-40da-48eb-954c-4feb568a53b3'; // identifiant public, pas un secret
const pushOn = () => !!(OS_APP && osKey());
const SITE = (process.env.RENDER_EXTERNAL_URL || 'https://m-michel.onrender.com').replace(/\/$/, '');
const PUSH_ICON = SITE + '/icon-192.png', PUSH_BADGE = SITE + '/badge.png';
const tagOf = (cid, pk) => 'u_' + cid + '_' + pk;
async function pushToClass(cid, { title, body, exclude, excludeSet, only, url, topic }) {
  const out = { sent: false, recipients: 0, status: 0, detail: '' };
  if (!pushOn()) { out.detail = 'Clé OneSignal absente dans Render (ONESIGNAL_REST_API_KEY).'; return out; }
  try {
    const keys = await kv.list('stu:' + cid + ':');
    const pks = keys.map(k => k.slice(('stu:' + cid + ':').length)).filter(pk => pk !== exclude && !(excludeSet && excludeSet.has(pk)) && (!only || only.includes(pk)));
    out.recipients = pks.length;
    if (!pks.length) { out.detail = 'Aucun élève à notifier dans cette classe.'; console.log('OneSignal : aucun destinataire pour', cid); return out; }
    // Ciblage par étiquette d'appareil : un même téléphone peut porter plusieurs comptes élèves.
    for (let i = 0; i < pks.length; i += 50) {
      const filters = [];
      pks.slice(i, i + 50).forEach((pk, n) => { if (n) filters.push({ operator: 'OR' }); filters.push({ field: 'tag', key: tagOf(cid, pk), relation: '=', value: '1' }); });
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(OS_BASE + '/notifications', {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Key ' + osKey() },
        body: JSON.stringify({
          app_id: OS_APP, target_channel: 'push', filters,
          headings: { fr: title, en: title }, contents: { fr: body, en: body },
          url: url || '/', ttl: 86400 * 2,
          chrome_web_icon: PUSH_ICON, chrome_web_badge: PUSH_BADGE, // logo + petite icône blanche de la barre d'état (la « pastille »)
          priority: 10, // haute priorité : livraison immédiate même quand le téléphone est en veille
          ...(topic ? { web_push_topic: topic } : {}),
        }),
      });
      clearTimeout(to);
      const txt = (await r.text()).slice(0, 400);
      let okId = false; try { okId = !!JSON.parse(txt).id; } catch (e) { /* texte non JSON */ }
      out.status = r.status; out.detail = txt; out.sent = r.ok && okId;
      console.log('OneSignal', r.status, 'élèves visés:', Math.min(50, pks.length - i), txt.slice(0, 200));
    }
  } catch (e) { out.detail = e.message; console.error('OneSignal erreur', e.message); }
  return out;
}
const chatAgg = new Map(); // classe -> { n, t } : messages récents regroupés dans une même notification
const qtCache = new Map();
kv.onSet = (k, v) => { if (/^(att|man|quiz|stu|class):/.test(k)) bulMemo.clear(); if (k.startsWith('att:') && (!v || v.finished || !(v.answers && v.answers.length))) qtCache.clear(); }; // un quiz commence ou se termine : on recalcule tout de suite
async function activeQuizTakers(cid) {
  const c = qtCache.get(cid);
  if (c && Date.now() - c.t < 8000) return c.set;
  const set = new Set();
  try {
    for (const q of await gradedQuizzes(cid)) for (const k of await kv.list('att:' + q.id + ':')) {
      const a = await kv.get(k);
      if (a && !a.finished && typeof a.key === 'string' && a.key.startsWith('u_')) set.add(a.key.slice(2));
    }
  } catch (e) { /* tant pis : on notifie tout le monde */ }
  qtCache.set(cid, { t: Date.now(), set });
  return set;
}
async function notifyChat(st, m) {
  try {
    const rp = m.reply && m.reply.pk !== st.pk ? m.reply.pk : null;
    const busy = await activeQuizTakers(st.cid);
    if (rp && !busy.has(rp)) {
      const sn = m.text.length > 90 ? m.text.slice(0, 87) + '…' : m.text;
      await pushToClass(st.cid, { title: '↩️ ' + st.name + ' t\'a répondu', body: sn, only: [rp], url: '/', topic: 'rep-' + st.cid + '-' + rp });
    }
    const now = Date.now(), cur = chatAgg.get(st.cid);
    const agg = cur && now - cur.t < 10 * 60000 ? { n: cur.n + 1, t: now } : { n: 1, t: now };
    chatAgg.set(st.cid, agg);
    const snippet = m.text.length > 90 ? m.text.slice(0, 87) + '…' : m.text;
    const title = agg.n > 1 ? '💬 ' + agg.n + ' nouveaux messages' : '💬 ' + st.name;
    const body = agg.n > 1 ? st.name + ' : ' + snippet : snippet;
    await pushToClass(st.cid, { title, body, exclude: st.pk, excludeSet: rp ? new Set([...busy, rp]) : busy, url: '/', topic: 'chat-' + st.cid });
  } catch (e) { console.error('notifyChat', e.message); }
}
app.post('/api/classes/:id/push-test', auth, wrap(async (req, res) => {
  const cid = req.params.id.toUpperCase();
  if (!(await kv.get('class:' + cid))) return fail(res, 404, 'Classe introuvable.');
  const r = await pushToClass(cid, { title: 'Test M.Michel 🔔', body: 'Si tu lis ceci, les notifications fonctionnent !', url: '/' });
  let info = '';
  try {
    const j = JSON.parse(r.detail);
    if (j.id) info = 'accepté par OneSignal (' + (j.recipients != null ? j.recipients + ' appareil(s)' : 'envoi lancé') + ')';
    else if (j.errors) info = 'Aucun appareil abonné ne porte l\'étiquette d\'un élève de cette classe. Chaque élève doit se connecter sur son téléphone après avoir autorisé les notifications. (' + JSON.stringify(j.errors).slice(0, 120) + ')';
  } catch (e) { info = r.detail; }
  res.json({ ...r, info });
}));
app.get('/api/classes/:id/push-diag', auth, wrap(async (req, res) => {
  const cid = req.params.id.toUpperCase();
  const out = { keyOk: pushOn(), appId: OS_APP.slice(0, 8) + '…', devices: null, subscribed: null, tagged: 0, taggedSubscribed: 0, students: [], error: '' };
  const pks = (await kv.list('stu:' + cid + ':')).map(k => k.slice(('stu:' + cid + ':').length));
  if (!pushOn()) { out.error = 'Clé OneSignal absente dans Render (ONESIGNAL_REST_API_KEY).'; return res.json(out); }
  try {
    // liste des appareils connus de OneSignal (300 derniers)
    let r = await fetch(OS_BASE + '/players?app_id=' + encodeURIComponent(OS_APP) + '&limit=300', { headers: { Authorization: 'Key ' + osKey() } });
    if (r.status === 401 || r.status === 403) r = await fetch(OS_BASE + '/players?app_id=' + encodeURIComponent(OS_APP) + '&limit=300', { headers: { Authorization: 'Basic ' + osKey() } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { out.error = 'OneSignal a répondu ' + r.status + ' : ' + JSON.stringify(j).slice(0, 200); return res.json(out); }
    const pl = Array.isArray(j.players) ? j.players : [];
    out.devices = pl.length;
    const sub = p => p.notification_types === 1 || (p.invalid_identifier === false && p.notification_types > 0);
    out.subscribed = pl.filter(sub).length;
    const per = new Map(pks.map(pk => [pk, { pseudo: pk, tagged: 0, subscribed: 0 }]));
    for (const p of pl) {
      const tags = p.tags || {};
      let any = false;
      for (const pk of pks) if (tags[tagOf(cid, pk)] === '1') { const e = per.get(pk); e.tagged++; if (sub(p)) e.subscribed++; any = true; }
      if (any) { out.tagged++; if (sub(p)) out.taggedSubscribed++; }
    }
    out.students = [...per.values()];
  } catch (e) { out.error = e.message; }
  res.json(out);
}));
app.get('/api/config', (req, res) => res.json({ onesignalAppId: pushOn() ? OS_APP : '' }));

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
  let announce = false;
  if (!d.id) {
    announce = !d.draft;
    d.id = await newCode();
    if (!d.id) return fail(res, 500, 'Impossible de créer un code. Réessaie.');
  } else {
    const old = await kv.get('quiz:' + d.id);
    if (!old) return fail(res, 404, 'Quiz introuvable.');
    d.created = old.created;
    announce = !d.draft && !!old.draft;
  }
  const cl = await kv.get('class:' + d.classId);
  if (!periodsOf(cl).includes(d.period)) d.period = '';
  await kv.set('quiz:' + d.id, d);
  res.json({ quiz: d });
  if (announce) pushToClass(d.classId, { title: 'Nouveau ' + (d.mode === 'libelle' ? 'travail' : d.mode === 'devoir' ? 'devoir' : 'quiz') + ' 📝', body: d.title, url: '/' });
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

/* ---------- Génération de questions par IA (Gemini) : toujours en brouillon ---------- */
const GEMINI_BASE = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
const GEMINI_MODELS = [process.env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-2.5-flash'].filter(Boolean);
const genHits = new Map();
function genLimited() {
  const now = Date.now(), v = (genHits.get('t') || []).filter(t => now - t < 3600e3);
  v.push(now); genHits.set('t', v); return v.length > 30;
}
function buildPrompt({ subject, level, count, types, text, mode }) {
  const T = { qcm: 'choix multiple (4 choix, une seule bonne réponse)', vf: 'vrai ou faux', court: 'réponse courte (un mot ou une expression)', long: 'réponse rédigée (question ouverte, sans réponse attendue)' };
  return [
    'Tu es un professeur du système éducatif haïtien (enseignement fondamental et secondaire). Tu prépares un ' + (mode === 'devoir' ? 'devoir à la maison' : 'quiz en classe') + '.',
    'Matière : ' + subject + (level ? '. Classe / niveau : ' + level : '') + '.',
    'Écris en français simple et clair, adapté à l\'âge des élèves. Utilise des exemples proches de la vie en Haïti quand c\'est naturel.',
    'Appuie-toi UNIQUEMENT sur le contenu ci-dessous. N\'invente aucun fait qui n\'y figure pas. Si le contenu est un simple titre de leçon, reste sur des notions de base et sûres, très largement enseignées.',
    'Crée exactement ' + count + ' questions, en mélangeant ces types : ' + types.map(t => T[t]).join(' ; ') + '.',
    'Règles : chaque question doit avoir une seule bonne réponse sans ambiguïté. Pas de piège gratuit. Les mauvais choix doivent être plausibles. Pas de « toutes les réponses » ni « aucune des réponses ». Varie la position de la bonne réponse.',
    'Réponds UNIQUEMENT avec un tableau JSON, sans texte autour ni balises. Chaque élément a ce format :',
    '{"t":"qcm","q":"...","opts":["...","...","...","..."],"a":0}  (a = position de la bonne réponse, de 0 à 3)',
    '{"t":"vf","q":"Affirmation à juger","a":"vrai"}  (a = "vrai" ou "faux")',
    '{"t":"court","q":"...","a":"réponse attendue | autre formulation acceptée"}',
    '{"t":"long","q":"..."}',
    '',
    'CONTENU :',
    text,
  ].join('\n');
}
function cleanGenerated(arr, types, count) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const q of arr) {
    if (!q || typeof q !== 'object') continue;
    const t = ['qcm', 'vf', 'court', 'long'].includes(q.t) && types.includes(q.t) ? q.t : null;
    const text = str(q.q, 1500).trim();
    if (!t || !text) continue;
    if (t === 'qcm') {
      const opts = (Array.isArray(q.opts) ? q.opts : []).slice(0, 4).map(o => str(o, 300).trim());
      let a = Number.isInteger(q.a) ? q.a : parseInt(q.a);
      if (!(a >= 0)) {
        const L = /^\s*([A-Da-d])\s*[).:]?\s*$/.exec(String(q.a));
        if (L) a = L[1].toUpperCase().charCodeAt(0) - 65;
        else { const k = opts.findIndex(o => norm(o) === norm(q.a)); if (k >= 0) a = k; }
      }
      if (opts.length < 2 || opts.some(o => !o) || !(a >= 0 && a < opts.length)) continue;
      const order = shuffle(opts.map((o, i) => i));
      out.push({ t, q: text, opts: order.map(i => opts[i]).concat(['', '', '', '']).slice(0, 4), a: order.indexOf(a), why: false });
    } else if (t === 'vf') {
      const a = String(q.a).toLowerCase().startsWith('f') ? 'faux' : 'vrai';
      out.push({ t, q: text, opts: ['', '', '', ''], a, why: false });
    } else if (t === 'court') {
      const a = str(q.a, 500).trim(); if (!a) continue;
      out.push({ t, q: text, opts: ['', '', '', ''], a, why: false });
    } else out.push({ t, q: text, opts: ['', '', '', ''], a: '', why: false });
    if (out.length >= count) break;
  }
  return out;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let modelCache = { at: 0, list: [] };
function modelScore(name) {
  const v = /gemini-(\d+(?:\.\d+)?)/.exec(name);
  const ver = v ? parseFloat(v[1]) : 0;
  return (/preview|exp/.test(name) ? 0 : 100) + ver * 10 + (/lite/.test(name) ? -5 : 0);
}
async function listModels(key) {
  if (modelCache.list.length && Date.now() - modelCache.at < 3600e3) return modelCache.list;
  const r = await fetch(GEMINI_BASE + '/v1beta/models?pageSize=100', { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000) });
  if (r.status === 400 || r.status === 401 || r.status === 403) { const e = new Error('key'); e.code = 'key'; console.error('Gemini liste', r.status, (await r.text()).slice(0, 200)); throw e; }
  if (!r.ok) { console.error('Gemini liste', r.status); return []; }
  const j = await r.json();
  const list = (j.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini-.*flash/.test(m.name) && !/image|tts|live|audio|embedding|vision|robotics|computer|learnlm|gemma/.test(m.name))
    .map(m => m.name.replace(/^models\//, ''))
    .sort((x, y) => modelScore(y) - modelScore(x));
  if (list.length) modelCache = { at: Date.now(), list };
  console.log('Modèles Gemini disponibles :', list.slice(0, 6).join(', '));
  return list;
}
async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) { const e = new Error('no-key'); e.code = 'no-key'; throw e; }
  let models = [];
  try { models = await listModels(key); } catch (e) { if (e.code === 'key') throw e; }
  const cands = [...new Set([process.env.GEMINI_MODEL, ...models.slice(0, 4), models.length ? null : 'gemini-flash-latest'].filter(Boolean))];
  let sawQuota = false, sawBusy = false, saw404 = false, lastErr;
  for (const model of cands) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(GEMINI_BASE + '/v1beta/models/' + model + ':generateContent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.5, responseMimeType: 'application/json', maxOutputTokens: 8192 } }),
          signal: AbortSignal.timeout(45000),
        });
        if (r.ok) {
          const j = await r.json();
          const parts = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
          const txt = parts ? parts.map(p => p.text || '').join('') : '';
          if (txt) { console.log('Génération réussie avec', model); return txt; }
          lastErr = new Error('empty'); break;
        }
        const body = (await r.text()).slice(0, 300);
        console.error('Gemini', model, r.status, body);
        if (r.status === 429) { sawQuota = true; break; }
        if (r.status === 500 || r.status === 503 || r.status === 504) { sawBusy = true; if (attempt === 0) { await sleep(1500); continue; } break; }
        if (r.status === 404) { saw404 = true; break; }
        if (r.status === 401 || r.status === 403 || /API key/i.test(body)) { const e = new Error('key'); e.code = 'key'; throw e; }
        lastErr = new Error('http ' + r.status); break;
      } catch (e) { if (e.code === 'key') throw e; lastErr = e; if (e.name === 'TimeoutError') { sawBusy = true; } break; }
    }
  }
  const e = new Error(sawQuota && !sawBusy ? 'quota' : 'fail');
  e.code = sawQuota && !sawBusy ? 'quota' : sawBusy ? 'busy' : saw404 ? 'nomodel' : 'fail';
  if (lastErr) e.detail = lastErr.message;
  throw e;
}
function parseJsonLoose(txt) {
  let t = String(txt).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch (e) {}
  const a = t.indexOf('['), b = t.lastIndexOf(']');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
  return null;
}
app.get('/api/generate/status', auth, (req, res) => res.json({ enabled: !!process.env.GEMINI_API_KEY }));
app.post('/api/generate', auth, wrap(async (req, res) => {
  if (genLimited()) return fail(res, 429, 'Trop de générations cette heure. Réessaie plus tard.');
  const text = str(req.body.text, 12000).trim();
  if (text.length < 8) return fail(res, 400, 'Colle ton résumé de cours ou écris le titre de la leçon.');
  const count = Math.max(1, Math.min(20, parseInt(req.body.count) || 10));
  let types = (Array.isArray(req.body.types) ? req.body.types : []).filter(t => ['qcm', 'vf', 'court', 'long'].includes(t));
  if (!types.length) types = ['qcm', 'vf'];
  const subject = SUBJECTS.includes(req.body.subject) ? req.body.subject : 'Autre';
  const prompt = buildPrompt({ subject, level: str(req.body.level, 80), count, types, text, mode: req.body.mode === 'devoir' ? 'devoir' : 'quiz' });
  let raw;
  try { raw = await callGemini(prompt); }
  catch (e) {
    if (e.code === 'no-key') return fail(res, 503, 'La clé de l\'IA n\'est pas configurée dans Render (GEMINI_API_KEY).');
    if (e.code === 'quota') return fail(res, 429, 'Le quota gratuit du jour est épuisé. Réessaie demain ou écris les questions toi-même.');
    if (e.code === 'key') return fail(res, 502, 'La clé de l\'IA est refusée. Vérifie GEMINI_API_KEY dans Render.');
    if (e.code === 'busy') return fail(res, 503, 'Les serveurs de Google sont surchargés en ce moment. Réessaie dans une minute.');
    if (e.code === 'nomodel') return fail(res, 502, 'Aucun modèle Gemini n\'est disponible avec cette clé.');
    console.error('Génération échouée', e.message, e.detail || '');
    return fail(res, 502, 'L\'IA ne répond pas pour le moment. Réessaie dans un instant.');
  }
  const qs = cleanGenerated(parseJsonLoose(raw), types, count);
  if (!qs.length) return fail(res, 502, 'L\'IA n\'a pas produit de questions utilisables. Réessaie avec plus de détails.');
  res.json({ qs, asked: count });
}));
app.get('/api/me', auth, (req, res) => res.json({ ok: true }));
app.get('/healthz', (req, res) => res.send('ok'));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d', index: false, setHeaders: (res, p) => { if (p.endsWith('.html') || p.endsWith('.js')) res.set('Cache-Control', 'no-cache'); } }));
app.get('/', (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((req, res) => res.status(404).send('Page introuvable'));

kv.init().then(() => app.listen(PORT, () => console.log('M.Michel en ligne sur le port ' + PORT)))
  .catch(e => { console.error('Erreur de démarrage', e); process.exit(1); });
