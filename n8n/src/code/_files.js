// file-output helpers (prepended by n8n/build.py when used)
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
