const ctx = $input.first().json;
const icon = { BLOCK: ':no_entry:', ALLOW_AFTER_FIX: ':warning:', ALLOW: ':white_check_mark:' }[ctx.merge_decision];
const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n);
const rows = ctx.triage.issues.map((i, k) => `${pad(k + 1, 2)} ${pad(i.category, 11)} ${pad(i.confidence.toFixed(2), 4)} ${pad(i.route, 12)} ${pad(i.tests[0]?.title, 46)}`);
const text = `${icon} *qa-pr triage* — ${ctx.ticket || ctx.head_branch} · <${ctx.run_url}|run ${ctx.run_id}> (attempt ${ctx.run_attempt})\n` +
  `Total ${ctx.total} · Failed ${ctx.failed} · Unique issues ${ctx.triage.issues.length}\n` +
  '```\n# Category    Conf Route        Test\n' + rows.join('\n') + '\n```\n' +
  `*MERGE: ${ctx.merge_decision}*` + (ctx.agent_merge_decision !== ctx.merge_decision ? ` (agent suggested ${ctx.agent_merge_decision})` : '') +
  (ctx.pr_url ? `\nPR: ${ctx.pr_url}` : '') + '\nQA owns the final call — nothing is merged or closed automatically.';
return [{ json: { ...ctx, slack_text: text } }];
