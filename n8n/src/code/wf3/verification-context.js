// Gather everything the Verification agent needs for one Fixed bug.
const bug = $('Current Bug').last().json;
const comments = ($('Jira · Get Comments').last().json.comments || []).slice(-15).map((c) => ({ author: c.author?.displayName, created: c.created, body: String(c.body || '').slice(0, 1500) }));
const links = $('Jira · Get Remote Links').all().map((i) => i.json).filter((l) => l && l.object).map((l) => ({ title: l.object.title, url: l.object.url }));
const sheet = $('Bug Sheet · Find Row').all().map((i) => i.json).find((r) => r && (r['Jira Key'] === bug.key || r['Bug ID'] === bug.key)) || null;
return [{ json: { bug, comments, links, sheet_row: sheet } }];
