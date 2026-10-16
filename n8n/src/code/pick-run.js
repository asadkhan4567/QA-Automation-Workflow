// Find the run we just dispatched by the dispatch_id embedded in qa-pr.yml's run-name.
const ctx = $('Build PR Payload').last().json;
const runs = $input.first().json.workflow_runs || [];
const run = runs.find((r) => (r.display_title || r.name || '').includes(ctx.dispatch_id));
return [{ json: { run_id: run ? String(run.id) : '', run_url: run ? run.html_url : '', run_found: !!run } }];
