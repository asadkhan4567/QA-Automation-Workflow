const ctx = $('Touches DB?').last().json;
const key = ctx.ticket.key;
const data = parseAgentJson($input.first().json.output, 'Data Checks');
assertSchema(data, {
  type: 'object', required: ['dialect', 'checks', 'files'],
  props: {
    dialect: { type: 'string' },
    checks: { type: 'array', minItems: 1, items: { type: 'object', required: ['name', 'severity', 'sql'], props: { severity: { type: 'string', enum: ['critical', 'warning', 'info'] }, sql: { type: 'string' } } } },
    files: { type: 'array', minItems: 1, items: FILE_SCHEMA },
  },
}, 'Data Checks');
for (const c of data.checks) {
  if (!/^\s*(with|select)\b/i.test(c.sql) || /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|merge)\b/i.test(c.sql)) {
    throw new Error(`[Data Checks] check "${c.name}" is not read-only SQL`);
  }
}
assertFiles(data.files, [`tests/data/${key.toLowerCase()}/`, 'tests/fixtures/'], 'Data Checks');
return [{ json: { ...ctx, data } }];
