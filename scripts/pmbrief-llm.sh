#!/bin/bash
# PMBRIEF_LLM_CMD wrapper: reads prompt on stdin, prints HTML on stdout (DeepSeek, retry x2)
python3 - <<'PYEOF'
import json, os, sys, time, urllib.request, urllib.error
prompt = sys.stdin.read()
key = os.environ.get("DEEPSEEK_API_KEY")
if not key:
    sys.stderr.write("DEEPSEEK_API_KEY missing\n")
    sys.exit(1)
body = json.dumps({
    "model": "deepseek-chat",
    "messages": [
        {"role": "system", "content": "You are a senior web designer. You output only raw HTML documents."},
        {"role": "user", "content": prompt},
    ],
    "temperature": 0.5,
    "max_tokens": 8000,
}).encode()
last = None
for attempt in (1, 2):
    req = urllib.request.Request("https://api.deepseek.com/chat/completions", data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=290) as r:
            data = json.loads(r.read().decode())
        print(data["choices"][0]["message"]["content"])
        sys.exit(0)
    except Exception as e:
        last = e
        sys.stderr.write(f"attempt {attempt} failed: {e}\n")
        time.sleep(3)
sys.stderr.write(f"both attempts failed: {last}\n")
sys.exit(1)
PYEOF
