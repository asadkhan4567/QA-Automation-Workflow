// Merge generated files (later sources win on identical paths) for the review gate.
const ctx = $input.first().json;
const byPath = new Map();
for (const f of [...ctx.spec.files, ...(ctx.api?.files || []), ...(ctx.data?.files || [])]) byPath.set(f.path, f);
const all_files = [...byPath.values()];
return [{ json: { ...ctx, all_files } }];
