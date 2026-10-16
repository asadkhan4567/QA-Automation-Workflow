// Jira issues -> flat ticket objects. Description may be plain text (API v2) or ADF (API v3).
const cfg = $('Config').first().json;
function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  const inner = (node.content || []).map(adfToText).join(node.type === 'bulletList' || node.type === 'orderedList' ? '\n' : '');
  return ['paragraph', 'heading', 'listItem', 'codeBlock'].includes(node.type) ? inner + '\n' : inner;
}
return $input.all()
  .filter((i) => i.json && i.json.key)
  .map((i) => {
    const f = i.json.fields || {};
    return {
      json: {
        key: i.json.key,
        summary: f.summary || '',
        description: adfToText(f.description).trim(),
        labels: f.labels || [],
        components: (f.components || []).map((c) => c.name),
        priority: f.priority?.name || '',
        status: f.status?.name || '',
        issuetype: f.issuetype?.name || '',
        url: `${String(cfg.JIRA_BASE_URL).replace(/\/$/, '')}/browse/${i.json.key}`,
      },
    };
  });
