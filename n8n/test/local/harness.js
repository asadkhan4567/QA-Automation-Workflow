// Run an n8n Code-node body locally with mocked globals.
const fs = require('fs');
module.exports = async function run(codeFile, { nodes = {}, input = [], binary = null }) {
  const body = fs.readFileSync(codeFile, 'utf8');
  const $ = (n) => { const items = nodes[n]; if (!items) throw new Error('no node ' + n); return { first: () => items[0], last: () => items[items.length - 1], all: () => items, item: items[0] }; };
  const $input = { first: () => input[0], all: () => input, item: input[0] };
  const helpers = { getBinaryDataBuffer: async () => binary };
  const fn = new Function('$', '$input', 'require', '$now', `return (async function(){ ${body} }).call(this);`);
  return fn.call({ helpers }, $, $input, require, null);
};
