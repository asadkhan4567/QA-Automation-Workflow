const ticket = $('Current Ticket').last().json;
const design = parseAgentJson($input.first().json.output, 'Test Design');
assertSchema(design, {
  type: 'object',
  required: ['ticket', 'module', 'has_endpoints', 'endpoints', 'touches_db', 'db_entities', 'assumptions', 'gherkin', 'test_matrix'],
  props: {
    ticket: { type: 'string', enum: [ticket.key] },
    module: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },
    has_endpoints: { type: 'boolean' },
    endpoints: { type: 'array', items: { type: 'object', required: ['method', 'path'], props: { method: { type: 'string' }, path: { type: 'string' } } } },
    touches_db: { type: 'boolean' },
    db_entities: { type: 'array', items: { type: 'string' } },
    assumptions: { type: 'array', items: { type: 'string' } },
    gherkin: { type: 'string', minLength: 10 },
    test_matrix: {
      type: 'array', minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'title', 'priority', 'type', 'steps', 'expected', 'tags'],
        props: {
          id: { type: 'string' }, title: { type: 'string' },
          priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          type: { type: 'string', enum: ['Positive', 'Negative', 'Boundary', 'Security', 'Performance', 'Accessibility', 'Usability'] },
          steps: { type: 'array', minItems: 1, items: { type: 'string' } },
          expected: { type: 'string' },
          tags: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^@' } },
        },
      },
    },
  },
}, 'Test Design');
if (design.has_endpoints && design.endpoints.length === 0) throw new Error('[Test Design] has_endpoints=true but endpoints is empty');
return [{ json: { ticket, design, attempt: 0, review_feedback: [] } }];
