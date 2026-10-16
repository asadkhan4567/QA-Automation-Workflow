const ctx = $('Run Context').first().json;
const arts = $input.first().json.artifacts || [];
const a = arts.find((x) => x.name === 'results-json' && !x.expired);
return [{ json: { ...ctx, has_results: !!a, artifact_url: a ? a.archive_download_url : '', artifact_size: a ? a.size_in_bytes : 0 } }];
