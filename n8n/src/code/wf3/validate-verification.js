const ctx = $('Verification Context').last().json;
const plan = parseAgentJson($input.first().json.output, 'Fix Verification');
assertSchema(plan, {
  type: 'object', required: ['bug_key', 'ready', 'module', 'grep', 'repeat_each', 'projects', 'original_steps', 'regression_test_exists', 'build'],
  props: {
    bug_key: { type: 'string', enum: [ctx.bug.key] },
    ready: { type: 'boolean' },
    not_ready_reason: { type: 'string', nullable: true },
    module: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },
    grep: { type: 'string', pattern: '^@[A-Za-z0-9-]+$' },
    repeat_each: { type: 'number', min: 10, max: 10 },
    projects: { type: 'array', minItems: 1, items: { type: 'string', enum: ['chromium', 'firefox', 'webkit'] } },
    original_steps: { type: 'array', items: { type: 'string' } },
    regression_test_exists: { type: 'boolean' },
    build: { type: 'string' },
  },
}, 'Fix Verification');
if (!plan.ready && !plan.not_ready_reason) throw new Error('[Fix Verification] ready=false requires not_ready_reason');
return [{ json: { ...ctx, plan } }];
