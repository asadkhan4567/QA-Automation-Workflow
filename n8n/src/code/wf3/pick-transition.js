const ctx = $('Verification Decision').last().json;
const transitions = $input.first().json.transitions || [];
const want = ctx.target_statuses.map((s) => s.toLowerCase());
const t = transitions.find((x) => want.includes(String(x.to?.name || '').toLowerCase()) || want.includes(String(x.name || '').toLowerCase()));
if (!t) throw new Error(`[Fix Verification] no transition to ${ctx.target_statuses.join('/')} available for ${ctx.bug.key} (have: ${transitions.map((x) => x.name + '→' + (x.to?.name || '?')).join(', ')})`);
if (/clos|done|resolv/i.test(String(t.to?.name || t.name))) throw new Error(`[Fix Verification] refusing transition "${t.name}" — automation never closes tickets`);
return [{ json: { ...ctx, transition_id: t.id, transition_name: t.name } }];
