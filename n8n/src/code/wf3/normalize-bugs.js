// Jira Fixed bugs -> flat objects (description may be ADF on API v3).
function adfToText(n) {
  if (!n) return '';
  if (typeof n === 'string') return n;
  if (n.type === 'text') return n.text || '';
  const inner = (n.content || []).map(adfToText).join('');
  return ['paragraph', 'heading', 'listItem', 'codeBlock'].includes(n.type) ? inner + '\n' : inner;
}
return $input.all().filter((i) => i.json && i.json.key).map((i) => {
  const f = i.json.fields || {};
  return { json: { key: i.json.key, summary: f.summary || '', description: adfToText(f.description).trim().slice(0, 6000), labels: f.labels || [], components: (f.components || []).map((c) => c.name), priority: f.priority?.name || '', status: f.status?.name || '', fix_versions: (f.fixVersions || []).map((v) => v.name) } };
});
