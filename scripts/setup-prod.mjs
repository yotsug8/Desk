// Поднимает боевой Supabase через Management API: проект, вход, схема, ключи.
// Нужна переменная SUPABASE_ACCESS_TOKEN. Повторный запуск безопасен: проект ищется по имени.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const NAME = process.env.SUPABASE_PROJECT_NAME || 'desk';
const REGION = process.env.SUPABASE_REGION || 'eu-central-1';
const API = 'https://api.supabase.com/v1';
if (!TOKEN) throw new Error('Нет SUPABASE_ACCESS_TOKEN');

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Проект
let project = (await api('GET', '/projects')).find((p) => p.name === NAME);
if (!project) {
  // у нового аккаунта организации нет: создаём на бесплатном тарифе
  let [org] = await api('GET', '/organizations');
  if (!org) {
    try {
      org = await api('POST', '/organizations', { name: 'Desk' });
      console.log('создана организация', org.id);
    } catch (err) {
      // организация с таким именем есть, но токен её не видит: ищем ещё раз, иначе заводим свою
      console.log(err.message);
      await sleep(5000);
      [org] = await api('GET', '/organizations');
      if (!org) org = await api('POST', '/organizations', { name: 'Desk Board' });
    }
  }
  console.log('организация', org.id);
  project = await api('POST', '/projects', {
    name: NAME,
    organization_id: org.id,
    region: REGION,
    db_pass: randomBytes(24).toString('base64url'),
  });
  console.log('создан проект', project.id);
}
const ref = project.id || project.ref;

for (let i = 0; i < 90; i++) {
  const p = await api('GET', `/projects/${ref}`);
  if (p.status === 'ACTIVE_HEALTHY') break;
  if (i === 89) throw new Error('Проект не поднялся: ' + p.status);
  await sleep(10_000);
}
console.log('проект работает', ref);

// 2. Вход: только анонимный, почта выключена, письма не уходят
await api('PATCH', `/projects/${ref}/config/auth`, {
  external_anonymous_users_enabled: true,
  external_email_enabled: false,
  external_phone_enabled: false,
  disable_signup: false,
  rate_limit_anonymous_users: 300,
});
console.log('вход настроен');

// 3. Схема: миграции по порядку, учёт в отдельной таблице
const q = (query) => api('POST', `/projects/${ref}/database/query`, { query });
await q('create schema if not exists desk_meta; create table if not exists desk_meta.migrations (name text primary key, applied_at timestamptz default now());');
const done = new Set((await q('select name from desk_meta.migrations')).map((r) => r.name));
const files = (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) {
  if (done.has(f)) continue;
  const sql = await readFile(`supabase/migrations/${f}`, 'utf8');
  await q(`begin;\n${sql}\ninsert into desk_meta.migrations (name) values ('${f}');\ncommit;`);
  console.log('миграция', f);
}

// 4. Публичный ключ в config.js
const keys = await api('GET', `/projects/${ref}/api-keys`);
const anon = keys.find((k) => k.name === 'anon')?.api_key;
if (!anon) throw new Error('Не нашёл публичный ключ');
const cfgPath = 'js/config.js';
let cfg = await readFile(cfgPath, 'utf8');
cfg = cfg.replace(/const PROD = \{[\s\S]*?\};/, `const PROD = {\n  url: 'https://${ref}.supabase.co',\n  key: '${anon}',\n};`);
await writeFile(cfgPath, cfg);
console.log('config.js обновлён');
