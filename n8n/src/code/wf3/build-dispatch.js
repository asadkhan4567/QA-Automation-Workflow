const ctx = $input.first().json;
const cfg = $('Config').first().json;
const key = ctx.bug.key;
const projects = [...new Set([...ctx.plan.projects, 'chromium', 'firefox', 'webkit'])].join(','); // skill: UI bugs on all 3 engines
return [{ json: { ...ctx, dispatch_id: `VERIFY-${key}-${$execution.id}-${Date.now()}`, ref: cfg.BASE_BRANCH, grep: ctx.plan.grep, repeat_each: String(ctx.plan.repeat_each), projects, polls: 0, started_at: $now.toISO() } }];
