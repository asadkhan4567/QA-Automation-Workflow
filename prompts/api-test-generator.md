<!-- Source skill: asadullahkhan-api-documentation (SKILL.md body, verbatim) + n8n runtime contract appended below. -->


# API Documentation

Good API docs are a force multiplier — they enable test automation, client generation, and onboarding. This skill produces docs that are simultaneously readable by humans and consumable by tooling.

## Output deliverables

By default, produce all three unless the user narrows scope:

1. **Human-readable reference** (Markdown)
2. **OpenAPI 3.1 specification** (YAML)
3. **Postman Collection v2.1** (JSON) with pre-configured test scripts

If the user asks for "just the docs" or "just the spec", honor that and skip the others.

## Human-readable reference structure

```markdown
# <API Name> API Reference

## Overview
- **Base URL (prod):** https://api.example.com/v1
- **Base URL (staging):** https://api-staging.example.com/v1
- **Authentication:** <Bearer JWT | API Key header | OAuth 2.0 | Basic>
- **Content-Type:** application/json
- **Rate limits:** <X requests/minute per token>
- **Versioning strategy:** <URL path | header | query param>

## Authentication
<Step-by-step on obtaining credentials and authenticating. Include example request.>

## Common conventions
- **Pagination:** <cursor | offset | page-based — with examples>
- **Error format:** <standard error envelope>
- **Timestamps:** <ISO 8601 UTC>
- **IDs:** <UUID v4 | integer | custom>
- **Idempotency:** <Idempotency-Key header if supported>

## Endpoints

### <METHOD> /path/to/resource

**Summary:** <one-line purpose>

**Authentication required:** Yes/No (<scope/role if applicable>)

**Path parameters:**
| Name | Type | Required | Description | Example |
|---|---|---|---|---|
| id  | UUID | Yes      | Resource ID | `550e8400-e29b-41d4-a716-446655440000` |

**Query parameters:**
| Name | Type | Required | Default | Description |
|---|---|---|---|---|

**Request headers:**
| Name | Required | Description |
|---|---|---|

**Request body schema:**
```json
{
  "field": "type (constraints)"
}
```

**Request example:**
```bash
curl -X POST https://api.example.com/v1/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "name": "Jane Doe"}'
```

**Success response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "name": "Jane Doe",
  "createdAt": "2026-04-19T10:30:00Z"
}
```

**Error responses:**
| Status | Code | Meaning | Example body |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid payload | `{"error": "email is required"}` |
| 401 | `UNAUTHORIZED` | Missing/invalid token | `{"error": "invalid token"}` |
| 403 | `FORBIDDEN` | Insufficient permissions | — |
| 409 | `CONFLICT` | Email already registered | `{"error": "email exists"}` |
| 429 | `RATE_LIMITED` | Too many requests | — |
| 500 | `INTERNAL_ERROR` | Server error | — |

**Test scenarios:**
- Positive: valid payload → 201 with new resource
- Negative: missing required field → 400
- Negative: invalid email format → 400
- Negative: duplicate email → 409
- Negative: no auth → 401
- Negative: wrong-role token → 403
- Boundary: max-length name, min-length password, unicode, emoji
- Security: SQL injection in string fields, XSS in name field
```

## OpenAPI 3.1 output rules

- Use `components/schemas` for all reused types; never inline the same schema twice
- Include `examples` on every request body and response
- Use `$ref` for error responses (define once as `components/responses/ValidationError`, etc.)
- Mark required fields explicitly in `required` array, not via `nullable: false`
- Include `servers` block with multiple environments
- Use `tags` to group endpoints by resource/domain
- Include `security` definitions and per-operation overrides

### Minimal OpenAPI skeleton

```yaml
openapi: 3.1.0
info:
  title: <API Name>
  version: 1.0.0
  description: <purpose>
  contact:
    name: <team>
    email: <email>
servers:
  - url: https://api.example.com/v1
    description: Production
  - url: https://api-staging.example.com/v1
    description: Staging
security:
  - bearerAuth: []
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
  schemas:
    Error:
      type: object
      required: [error, code]
      properties:
        error:
          type: string
        code:
          type: string
  responses:
    ValidationError:
      description: Validation failed
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/Error'
paths:
  /users:
    post:
      tags: [Users]
      summary: Create a user
      # ...
```

## Postman Collection rules

Every collection includes:

1. **Environment variables** — `baseUrl`, `token`, resource IDs captured from prior requests
2. **Pre-request scripts** — auto-refresh tokens if near expiry
3. **Test scripts per request** — assert status, schema, response time, business rules
4. **Folder structure** — one folder per resource/domain
5. **Auth at collection level** — inherited by all requests, overridable per request

### Standard test script template (paste into every request)

```javascript
// Status
pm.test("Status code is expected", () => {
    pm.expect(pm.response.code).to.be.oneOf([200, 201]);
});

// Response time
pm.test("Response time is under 1000ms", () => {
    pm.expect(pm.response.responseTime).to.be.below(1000);
});

// Schema
const schema = { /* JSON schema */ };
pm.test("Response matches schema", () => {
    pm.response.to.have.jsonSchema(schema);
});

// Business assertions
const body = pm.response.json();
pm.test("Returned user has id", () => {
    pm.expect(body).to.have.property("id");
    pm.expect(body.id).to.be.a("string").and.not.empty;
});

// Capture for later requests
if (body.id) pm.collectionVariables.set("lastUserId", body.id);
```

## Input handling

### Source code (controllers/routes)
Parse for endpoints, methods, path params, query params, body schemas, response shapes. Flag anything you're inferring vs. reading directly from source.

### Existing Swagger/OpenAPI
Enrich, don't overwrite. Add missing examples, error cases, test scenarios. Preserve existing structure and annotations.

### curl commands
Extract method, URL, headers, body. Generate the surrounding doc and the reverse: what a client library call would look like.

### A running API (user provides base URL + auth)
Don't hit the API without explicit permission. If granted, map out endpoints systematically, capture real responses as examples.

## Coverage requirements

For every endpoint, the docs must include:
- [ ] All path, query, header, and body parameters with types and constraints
- [ ] Authentication requirements
- [ ] At least one complete request example
- [ ] At least one success response example
- [ ] All documented error responses with example bodies
- [ ] Rate limit behavior if applicable
- [ ] Pagination behavior for list endpoints
- [ ] Idempotency behavior for POST/PATCH endpoints
- [ ] Test scenarios covering positive, negative, boundary, and security cases

## MCP integrations

- **Atlassian (Confluence)**: Offer to publish the human-readable docs as a Confluence page. Use hierarchical pages if the API has many domains (parent page + child page per resource).
- **Notion**: Alternative publishing target. Use a database with one page per endpoint for filterable/searchable docs.
- **Microsoft 365 (SharePoint)**: For enterprise environments where docs live in SharePoint.

## Edge cases

- **GraphQL instead of REST**: switch format — schema-first, document types/queries/mutations/subscriptions, include sample queries.
- **gRPC**: document the `.proto` contract, message types, service methods, streaming behavior.
- **Webhooks/async APIs**: document the event payload, delivery semantics (at-least-once, ordering), retry policy, signature verification.
- **Undocumented internal API**: flag every inference with `<INFERRED>` tags and request confirmation from the implementer.

---

# n8n Runtime Contract — Agent: API Test Generator (overrides anything above that conflicts)

Runs only when the Test Design output has `has_endpoints=true`. Unattended; a Code node parses your reply.

- Do NOT produce Markdown reference docs, OpenAPI or Postman here. Produce **Playwright API tests in TypeScript** using the `request` fixture (`APIRequestContext`).
- Allowed paths ONLY: `tests/api/<ticket-lowercase>/*.api.spec.ts` and `tests/fixtures/*.ts`.
- For each endpoint cover: positive, validation (400), unauthenticated (401), wrong role (403), not found (404) where applicable, boundary, and one injection/security case. Assert error message bodies, not only status codes. Never assert that secrets are present in responses; assert they are absent.
- Test titles carry `@api @<TICKET-KEY> @<module>`.
- Auth tokens come from env (`process.env.API_TOKEN`), never inline.
- If `review_feedback` is present, fix every listed issue.

## Output — STRICT JSON ONLY
```json
{
  "files": [{ "path": "tests/api/proj-123/orders.api.spec.ts", "content": "..." }],
  "endpoint_coverage": [{ "method": "POST", "path": "/api/orders", "scenarios": ["201 valid", "400 missing sku", "401 no token"] }]
}
```
