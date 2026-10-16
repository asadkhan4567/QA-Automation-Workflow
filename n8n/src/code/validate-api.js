const ctx = $('Has Endpoints?').last().json;
const key = ctx.ticket.key;
const api = parseAgentJson($input.first().json.output, 'API Test Generator');
assertSchema(api, {
  type: 'object', required: ['files', 'endpoint_coverage'],
  props: {
    files: { type: 'array', minItems: 1, items: FILE_SCHEMA },
    endpoint_coverage: { type: 'array', minItems: 1, items: { type: 'object', required: ['method', 'path', 'scenarios'], props: { scenarios: { type: 'array', minItems: 1, items: { type: 'string' } } } } },
  },
}, 'API Test Generator');
assertFiles(api.files, [`tests/api/${key.toLowerCase()}/`, 'tests/fixtures/'], 'API Test Generator');
return [{ json: { ...ctx, api } }];
