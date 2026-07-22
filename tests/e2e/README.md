# Live e2e (opt-in)

Excluded from default pytest and tox (`addopts = -m "not e2e"`).

```bash
uv run --group tests pytest -m e2e -n auto
```

`-n auto` (pytest-xdist) runs the battery in parallel against one shared sidecar — much faster than serial.

**Session flow**

1. `installed_agents` — PATH only (`claude` / `gemini` / `agent|cursor`); ignores env
2. `agent_env` — sets **both** `CLI_AGENTS` and `ACPX_AGENTS`, and plants settings only under
   `{E2E_TEST_CWD}/.pi/pi-config-settings.json` (never `~/.pi` or the repo `.pi`)
3. `sidecar_url` — start/stop sidecar with **cwd=`E2E_TEST_CWD`** so ACPX project settings win
4. `working_models` — `dict[provider → model]` for `google` + each `cli-*` / `acpx-*`.
   Broken/missing providers are omitted (warned); **only that provider’s param cases fail**.

Live tests take `provider` (parametrized) + `model` (from the dict).
Validation tests do not use the probe.

Logs: SEND prompt / RECV text (`log_cli=true`). All calls via `pi_sidecar_client`.
E2e forces `httpx` `verify=False` (no SSL verify). Agents planted under test cwd only:
`{cwd}/.pi/agents` (Pi), `{cwd}/.claude/agents` (Claude), `{cwd}/.gemini/agents` (Gemini).
