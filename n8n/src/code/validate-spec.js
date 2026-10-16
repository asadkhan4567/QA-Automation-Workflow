const ctx = $('Spec Context').last().json;
const key = ctx.ticket.key;
const spec = parseAgentJson($input.first().json.output, 'Spec Generator');
assertSchema(spec, {
  type: 'object', required: ['ticket', 'grep', 'files'],
  props: {
    ticket: { type: 'string', enum: [key] },
    grep: { type: 'string', pattern: '^@' },
    files: { type: 'array', minItems: 1, items: FILE_SCHEMA },
    notes: { type: 'array', items: { type: 'string' } },
  },
}, 'Spec Generator');
assertFiles(spec.files, [`tests/e2e/${key.toLowerCase()}/`, 'tests/pages/', 'tests/fixtures/'], 'Spec Generator');
if (!spec.files.some((f) => f.path.endsWith('.spec.ts'))) throw new Error('[Spec Generator] no .spec.ts file returned');
if (!spec.files.filter((f) => f.path.endsWith('.spec.ts')).every((f) => f.content.includes(`@${key}`))) {
  throw new Error(`[Spec Generator] every spec must carry the @${key} tag`);
}
return [{ json: { ...ctx, spec } }];
