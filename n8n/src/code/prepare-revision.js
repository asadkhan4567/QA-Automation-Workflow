const ctx = $input.first().json;
return [{
  json: {
    ticket: ctx.ticket,
    design: ctx.design,
    attempt: ctx.attempt + 1,
    review_feedback: ctx.review.issues.filter((i) => i.severity !== 'nit'),
  },
}];
