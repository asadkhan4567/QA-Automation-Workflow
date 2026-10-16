#!/usr/bin/env python3
"""Render n8n/src/*.ts SDK templates into n8n/build/*.sdk.ts.

Injects: Code-node JS (n8n/src/code/*.js, validators get _lib.js prepended),
agent system prompts (prompts/*.md), and shared HTTP/credential snippets.
Config placeholders (__CFG_*__) are left as visible "<SET_ME:...>" strings for the user.
"""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "n8n" / "src"
OUT = ROOT / "n8n" / "build"
OUT.mkdir(exist_ok=True)

STUB = "--stub" in sys.argv
STUB_PROMPTS = STUB or "--stub-prompts" in sys.argv
LIB = (SRC / "code" / "_lib.js").read_text()
MODEL_ID = "claude-sonnet-5-5"
DATA_TABLE_ID = "9mMnRlpTU4S4ezRU"  # qa_runs

SNIPPETS = {
    "__HTTP_RETRY__": "retryOnFail: true,\n    maxTries: 3,\n    waitBetweenTries: 5000,",
    "__GH_AUTH__": (
        "authentication: 'predefinedCredentialType',\n      nodeCredentialType: 'githubApi',\n"
        "      sendHeaders: true,\n      specifyHeaders: 'keypair',\n"
        "      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }, { name: 'X-GitHub-Api-Version', value: '2022-11-28' }] },\n"
        "      options: { timeout: 60000 },"
    ),
    "__GH_CRED__": "credentials: { githubApi: newCredential('GitHub (GITHUB_TOKEN)') }",
    "__DT_SCHEMA__": "schema: [" + ", ".join(
        f"{{ id: '{c}', displayName: '{c}', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }}"
        for c in ["ticket", "branch", "pr_url", "run_id", "status", "kind", "dispatch_id", "conclusion", "merge_decision", "review_verdict", "module"]
    ) + "]",
    "__MODEL_ID__": MODEL_ID,
    "__DATA_TABLE_ID__": DATA_TABLE_ID,
}

def lit(s: str) -> str:
    """Multi-line string literal as '+'-concatenated JSON strings (keeps lines short for review)."""
    parts = s.splitlines(keepends=True) or [""]
    return "(" + " +\n      ".join(json.dumps(x) for x in parts) + ")"

def code(name: str) -> str:
    if STUB:
        return json.dumps(f"return $input.all(); // stub {name}")
    body = (SRC / "code" / f"{name}.js").read_text()
    uses_lib = re.search(r"\b(parseAgentJson|assertSchema|assertFiles|FILE_SCHEMA)\b", body)
    return lit((LIB + "\n" + body) if uses_lib else body)

def prompt(name: str) -> str:
    if STUB_PROMPTS:
        return json.dumps(f"[PROMPT PENDING: prompts/{name}.md — injected by update_workflow]")
    return lit((ROOT / "prompts" / f"{name}.md").read_text())

def render(path: pathlib.Path) -> str:
    text = path.read_text()
    text = re.sub(r"__CODE:([a-z0-9-]+)__", lambda m: code(m.group(1)), text)
    text = re.sub(r"__PROMPT:([a-z0-9-]+)__", lambda m: prompt(m.group(1)), text)
    text = re.sub(r"__CFG_([A-Z_]+)__", lambda m: f"<SET_ME:{m.group(1)}>", text)
    for k, v in SNIPPETS.items():
        text = text.replace(k, v)
    leftover = re.findall(r"__[A-Z][A-Z_:a-z0-9-]*__", text)
    if leftover:
        sys.exit(f"{path.name}: unreplaced tokens {sorted(set(leftover))}")
    return text

args = [a for a in sys.argv[1:] if not a.startswith("--")]
targets = args or [p.name for p in sorted(SRC.glob("wf*.ts"))]
for name in targets:
    out = OUT / name.replace(".ts", ".stub.sdk.ts" if STUB else (".noprompt.sdk.ts" if STUB_PROMPTS else ".sdk.ts"))
    out.write_text(render(SRC / name))
    print(f"built {out.relative_to(ROOT)} ({out.stat().st_size} bytes)")
