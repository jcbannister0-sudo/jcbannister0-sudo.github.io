import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DAILY_DIR = path.join(ROOT, 'daily');
const QUEUE_DIR = path.join(DAILY_DIR, 'queue');
const INDEX_PATH = path.join(DAILY_DIR, 'index.json');
const ROUNDS = 7;

export const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’]s\b/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\blabour\b/g, 'labor')
    .replace(/\bbehaviour/g, 'behavior')
    .replace(/\bfavour/g, 'favor')
    .replace(/\bcolour/g, 'color')
    .replace(/\bneighbour/g, 'neighbor')
    .replace(/\bcentre/g, 'center')
    .replace(/\bdefence\b/g, 'defense')
    .replace(/\bprogramme/g, 'program')
    .replace(/\bchequing\b/g, 'checking')
    .replace(/\bcheque/g, 'check')
    .replace(/\baluminium\b/g, 'aluminum')
    .replace(/\bsulphur/g, 'sulfur')
    .replace(/\bsignalling\b/g, 'signaling')
    .replace(/\bturkiye\b/g, 'turkey')
    .replace(/([a-z]{3,})isation\b/g, '$1ization')
    .replace(/([a-z]{3,})ising\b/g, '$1izing')
    .replace(/([a-z]{3,})ise\b/g, '$1ize')
    .replace(/\b(the|a|an|of)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function validateDrop(drop, label = 'drop') {
  if (!drop || typeof drop !== 'object') {
    throw new Error(`${label}: expected JSON object`);
  }
  if (!Array.isArray(drop.prompts) || drop.prompts.length !== ROUNDS) {
    throw new Error(`${label}: expected exactly ${ROUNDS} prompts, got ${drop.prompts?.length}`);
  }
  const seenIds = new Set();
  for (const P of drop.prompts) {
    if (!P || typeof P.id !== 'string' || !P.id.trim()) {
      throw new Error(`${label}: prompt missing non-empty id`);
    }
    if (seenIds.has(P.id)) {
      throw new Error(`${label}: duplicate prompt id "${P.id}"`);
    }
    seenIds.add(P.id);
    if (typeof P.cat !== 'string' || !P.cat.trim()) {
      throw new Error(`${label} (${P.id}): missing cat`);
    }
    if (typeof P.q !== 'string' || !P.q.trim()) {
      throw new Error(`${label} (${P.id}): missing question text q`);
    }
    if (typeof P.a !== 'string' || !P.a.trim()) {
      throw new Error(`${label} (${P.id}): missing answers string a`);
    }
    const tierCounts = [0, 0, 0, 0, 0, 0, 0];
    const seenAliases = new Map();
    const lines = P.a.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const [tRaw, dRaw, alRaw] = line.split('|');
      const tier = Number(tRaw);
      if (!Number.isInteger(tier) || tier < 1 || tier > 6) {
        throw new Error(`${label} (${P.id}): invalid tier "${tRaw}" on line "${line}"`);
      }
      const d = (dRaw || '').trim();
      if (!d) {
        throw new Error(`${label} (${P.id}): empty display answer on line "${line}"`);
      }
      tierCounts[tier]++;
      const aliases = new Set([norm(d)]);
      (alRaw || '')
        .split(';')
        .map((x) => norm(x))
        .filter(Boolean)
        .forEach((nx) => aliases.add(nx));
      if (P.people) {
        const parts = norm(d).split(' ');
        if (parts[parts.length - 1]) aliases.add(parts[parts.length - 1]);
      }
      for (const al of aliases) {
        if (!al) continue;
        if (seenAliases.has(al)) {
          throw new Error(
            `${label} (${P.id}): alias collision "${al}" -> "${seenAliases.get(al)}" AND "${d}"`
          );
        }
        seenAliases.set(al, d);
      }
    }
    for (let t = 1; t <= 5; t++) {
      if (tierCounts[t] < 2) {
        throw new Error(`${label} (${P.id}): tier ${t} has only ${tierCounts[t]} answers (need >= 2)`);
      }
    }
    if (tierCounts[6] !== 1) {
      throw new Error(`${label} (${P.id}): tier 6 must have exactly 1 Monopoly answer (got ${tierCounts[6]})`);
    }
  }
}

function listDateDrops() {
  if (!fs.existsSync(DAILY_DIR)) return [];
  return fs
    .readdirSync(DAILY_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort()
    .reverse();
}

function writeIndex(dates) {
  fs.mkdirSync(DAILY_DIR, { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify({ drops: dates }, null, 2) + '\n', 'utf8');
}

function resolveTargetDate() {
  const envDate = (process.env.TARGET_DATE || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(envDate)) return envDate;
  const tz = process.env.TZ || 'America/Denver';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

async function generateDropWithGemini(targetDate, apiKey) {
  const promptText = [
    `Generate a 7-prompt daily drop JSON for VEBL, a rare-answer economics trivia game, for ${targetDate}.`,
    'Return ONLY valid JSON with shape: {"theme":"<short theme>","prompts":[{"id":"drop-' +
      targetDate.replace(/-/g, '') +
      '-<slug>","cat":"<2-3 word label>","q":"<question prompt>","a":"<newline-delimited rows>"}]}',
    'Rules for each prompt:',
    '- Tier 1 = obvious everyday "Common Cents" answers anyone knows immediately (12-16 rows). Tiers 2-4 = concrete real-world examples (12-16 rows each). Tier 5 = harder/niche answers (20-30 rows). Tier 6 = EXACTLY 1 secret "Monopoly" row per prompt — an answer almost nobody else thinks of. Aim for 70-90+ total accepted answers per prompt!',
    '- Keep EVERY prompt concrete, accessible, and fun (e.g. specific brands, everyday bills, jobs, products, cities, countries, famous people, movies, scams). NEVER write vague academic prompts like "Name a [topic] economics concept".',
    '- Row format: <tier>|<Display Name> or <tier>|<Display Name>|<alias1>;<alias2>;<alias3>;<alias4> — pack EVERY row with 2-5 rich alternate aliases (slang, abbreviations, common variants, synonyms) so alternate phrasings always count!',
    '- Zero duplicate or colliding normalized aliases within a prompt. Accurate factual economics only.'
  ].join('\n');

  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' +
    encodeURIComponent(apiKey);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.7 }
    })
  });
  if (!res.ok) {
    throw new Error(`Gemini API failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!txt) throw new Error('Gemini API returned empty content');
  return JSON.parse(txt);
}

function runCheck() {
  const dates = listDateDrops();
  for (const d of dates) {
    const p = path.join(DAILY_DIR, `${d}.json`);
    const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
    validateDrop(obj, `daily/${d}.json`);
  }
  if (fs.existsSync(INDEX_PATH)) {
    const idx = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    if (!idx || !Array.isArray(idx.drops)) {
      throw new Error('daily/index.json: missing drops array');
    }
    for (const d of dates) {
      if (!idx.drops.includes(d)) {
        throw new Error(`daily/index.json: missing published drop "${d}"`);
      }
    }
  }
  let queueCount = 0;
  if (fs.existsSync(QUEUE_DIR)) {
    const qFiles = fs.readdirSync(QUEUE_DIR).filter((f) => f.endsWith('.json')).sort();
    queueCount = qFiles.length;
    for (const f of qFiles) {
      const p = path.join(QUEUE_DIR, f);
      const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
      validateDrop(obj, `daily/queue/${f}`);
    }
  }
  console.log(`Daily drop check OK: ${dates.length} published drop(s), ${queueCount} queued drop(s).`);
}

async function runRelease() {
  const targetDate = resolveTargetDate();
  const outPath = path.join(DAILY_DIR, `${targetDate}.json`);
  if (fs.existsSync(outPath)) {
    const existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    validateDrop(existing, `daily/${targetDate}.json`);
    writeIndex(listDateDrops());
    console.log(`Daily drop for ${targetDate} already published.`);
    return;
  }

  let candidate = null;
  let sourceLabel = '';
  let popPath = null;

  if (fs.existsSync(QUEUE_DIR)) {
    const qFiles = fs.readdirSync(QUEUE_DIR).filter((f) => f.endsWith('.json')).sort();
    if (qFiles.length > 0) {
      popPath = path.join(QUEUE_DIR, qFiles[0]);
      candidate = JSON.parse(fs.readFileSync(popPath, 'utf8'));
      sourceLabel = `daily/queue/${qFiles[0]}`;
    }
  }

  if (!candidate && process.env.GEMINI_API_KEY) {
    candidate = await generateDropWithGemini(targetDate, process.env.GEMINI_API_KEY);
    sourceLabel = 'Gemini API';
  }

  if (!candidate) {
    console.log(
      `No queued drops in daily/queue/ and no GEMINI_API_KEY set; keeping built-in prompt rotation for ${targetDate}.`
    );
    writeIndex(listDateDrops());
    return;
  }

  const stamped = {
    date: targetDate,
    theme: candidate.theme || `Daily Climb ${targetDate}`,
    prompts: candidate.prompts
  };
  validateDrop(stamped, sourceLabel);
  fs.mkdirSync(DAILY_DIR, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(stamped, null, 2) + '\n', 'utf8');
  if (popPath && fs.existsSync(popPath)) fs.unlinkSync(popPath);
  const dates = listDateDrops();
  writeIndex(dates);
  console.log(`Released daily/${targetDate}.json from ${sourceLabel}. Total drops: ${dates.length}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    runCheck();
  } else {
    await runRelease();
    runCheck();
  }
}
