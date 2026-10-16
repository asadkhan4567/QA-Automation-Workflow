// shared strict-JSON helpers (prepended by n8n/build.py)
function parseAgentJson(raw, label) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.trim()) throw new Error(`[${label}] empty/non-string agent output`);
  let s = raw.trim();
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (m) s = m[1].trim();
  try { return JSON.parse(s); } catch (e) { throw new Error(`[${label}] invalid JSON (${e.message}): ${s.slice(0, 300)}`); }
}
// schema: {type:'object'|'array'|'string'|'number'|'boolean'|'any', required, props, items, minItems, enum, pattern, minLength, min, max, nullable}
function checkSchema(v, s, p, e) {
  if (v === null || v === undefined) { if (!(s.nullable && v === null)) e.push(`${p} is ${v === null ? 'null' : 'missing'}`); return; }
  const t = s.type;
  if (t === 'any') return;
  if (t === 'object') {
    if (typeof v !== 'object' || Array.isArray(v)) return void e.push(`${p} must be an object`);
    (s.required || []).forEach((k) => { if (!(k in v)) e.push(`${p}.${k} is required`); });
    Object.entries(s.props || {}).forEach(([k, sub]) => { if (k in v) checkSchema(v[k], sub, `${p}.${k}`, e); });
  } else if (t === 'array') {
    if (!Array.isArray(v)) return void e.push(`${p} must be an array`);
    if (s.minItems && v.length < s.minItems) e.push(`${p} needs >= ${s.minItems} items`);
    if (s.items) v.forEach((x, i) => checkSchema(x, s.items, `${p}[${i}]`, e));
  } else if (t === 'string') {
    if (typeof v !== 'string') return void e.push(`${p} must be a string`);
    if (s.minLength && v.length < s.minLength) e.push(`${p} too short`);
    if (s.enum && !s.enum.includes(v)) e.push(`${p} must be one of ${s.enum.join('|')} (got "${v}")`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) e.push(`${p} must match /${s.pattern}/`);
  } else if (t === 'number') {
    if (typeof v !== 'number' || Number.isNaN(v)) return void e.push(`${p} must be a number`);
    if (s.min !== undefined && v < s.min) e.push(`${p} must be >= ${s.min}`);
    if (s.max !== undefined && v > s.max) e.push(`${p} must be <= ${s.max}`);
  } else if (t === 'boolean') { if (typeof v !== 'boolean') e.push(`${p} must be a boolean`); }
  else e.push(`${p}: unknown schema type ${t}`);
}
function assertSchema(v, s, label) {
  const e = []; checkSchema(v, s, '$', e);
  if (e.length) throw new Error(`[${label}] schema mismatch (${e.length}): ${e.slice(0, 12).join('; ')}`);
  return v;
}
const FILE_SCHEMA = { type: 'object', required: ['path', 'content'], props: { path: { type: 'string', minLength: 1 }, content: { type: 'string', minLength: 1 } } };
function assertFiles(files, prefixes, label) {
  for (const f of files) {
    const p = f.path;
    if (p.includes('..') || p.startsWith('/') || p.includes('\\') || !prefixes.some((x) => p.startsWith(x))) throw new Error(`[${label}] path not allowed: "${p}" (allowed: ${prefixes.join(', ')})`);
    if (!p.endsWith('.ts')) throw new Error(`[${label}] only .ts files allowed: "${p}"`);
    if (/waitForTimeout\s*\(|setTimeout\s*\(/.test(f.content)) throw new Error(`[${label}] hard sleep found in ${p}`);
  }
  return files;
}
// end shared helpers
