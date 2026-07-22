"""Live e2e fixtures — pytest owns the full sidecar lifecycle.

Flow (session):
  installed_agents  → PATH only (ignore CLI_AGENTS / ACPX_AGENTS env)
  agent_env         → set both env vars + e2e-only project settings under test_cwd
  sidecar_url       → start sidecar with cwd=test_cwd; always stop
  working_models    → dict[provider → model] for google + cli-* + acpx-*
                      (omit broken providers; those param cases fail via ``model``)

Never reads or writes ~/.pi or the repo's .pi/pi-config-settings.json.
ACPX getSetting is project → global → env; global ~/.pi often pins acpx_agents=["cursor"].
We plant settings only under {E2E_TEST_CWD}/.pi/ and start the sidecar with that cwd
so process.cwd() picks the e2e project settings (never the user's home or repo .pi).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import socket
import subprocess
import time
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import httpx
import pytest
import pytest_asyncio

import pi_sidecar_client
from pi_sidecar_client import SidecarClient
from tests.e2e.helpers import log_recv, log_send

REPO_ROOT = Path(__file__).resolve().parents[2]
START_SCRIPT = REPO_ROOT / "scripts" / "start-sidecar.sh"
PROBE_TIMEOUT_S = 120
NATIVE_PROVIDER = "google"

logger = logging.getLogger("e2e")


def _detect_installed_agents() -> list[str]:
    """PATH only — never reads CLI_AGENTS / ACPX_AGENTS."""
    found: list[str] = []
    if shutil.which("claude"):
        found.append("claude")
    if shutil.which("gemini"):
        found.append("gemini")
    if shutil.which("agent") or shutil.which("cursor"):
        found.append("cursor")
    return found


def _providers_for_agents(agents: list[str]) -> list[str]:
    """Native google + all cli-* + all acpx-* for installed agents."""
    return [NATIVE_PROVIDER] + [f"cli-{a}" for a in agents] + [f"acpx-{a}" for a in agents]


def pytest_generate_tests(metafunc: pytest.Metafunc) -> None:
    """Parametrize every test that asks for ``provider`` from installed CLIs + google."""
    if "provider" not in metafunc.fixturenames:
        return
    agents = _detect_installed_agents()
    providers = _providers_for_agents(agents)
    metafunc.parametrize("provider", providers, ids=providers)


def _pick_free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _health_ok(url: str) -> bool:
    try:
        r = httpx.get(f"{url}/health", timeout=2.0)
        return r.status_code == 200 and r.json().get("status") == "ok"
    except Exception:
        return False


def _stop_sidecar(port: int, url: str) -> None:
    env = {**os.environ, "SIDECAR_PORT": str(port)}
    subprocess.run([str(START_SCRIPT), "--stop"], cwd=REPO_ROOT, env=env, check=False)
    if _health_ok(url):
        subprocess.run(["fuser", "-k", f"{port}/tcp"], check=False, capture_output=True)
        time.sleep(1)
    if _health_ok(url):
        raise RuntimeError(f"sidecar still up at {url} after stop; kill on host: fuser -k {port}/tcp")


def _model_ids(models: list[dict], provider: str) -> list[str]:
    ids = [m["id"] for m in models if m.get("provider") == provider]
    # Skip pinned junk / flaky ids on cli-* and acpx-*.
    if provider.startswith(("cli-", "acpx-")):
        skip = {"cursor:auto", "cursor:default[]"}
        ids = [mid for mid in ids if mid not in skip and "claude-3-5-haiku" not in mid.lower()]
    return ids


async def _probe_first_working(
    client: SidecarClient,
    *,
    provider: str,
    model_ids: list[str],
    cwd: str,
) -> str | None:
    for mid in model_ids:
        logger.info("PROBE try provider=%s model=%r", provider, mid)
        try:
            sid = await client.create_session(
                provider=provider,
                model=mid,
                system_prompt="Reply with exactly: PING",
                cwd=cwd,
                tools=[],
            )
        except Exception as exc:
            logger.info("PROBE create failed provider=%s model=%s err=%s", provider, mid, exc)
            continue
        try:
            prompt = "Reply with exactly: PING"
            log_send(provider=provider, model=mid, prompt=prompt, session_id=sid, tools=[])
            result = await asyncio.wait_for(
                client.prompt(sid, prompt),
                timeout=PROBE_TIMEOUT_S,
            )
            log_recv(result, provider=provider, model=mid)
            if result.success and (result.text or "").strip():
                logger.info("PROBE WORKING provider=%s model=%s", provider, mid)
                return mid
            logger.info(
                "PROBE not usable provider=%s model=%s success=%s",
                provider,
                mid,
                result.success,
            )
        except Exception as exc:
            logger.info("PROBE prompt failed provider=%s model=%s err=%s", provider, mid, exc)
        finally:
            try:
                await client.delete_session(sid)
            except Exception:
                pass
    return None


@pytest.fixture(scope="session", autouse=True)
def _e2e_disable_ssl_verify() -> Iterator[None]:
    """Force httpx verify=False for the whole e2e process (incl. call_ai_once singleton)."""
    _orig_async = httpx.AsyncClient
    _orig_sync = httpx.Client

    class _NoVerifyAsyncClient(_orig_async):  # type: ignore[valid-type,misc]
        def __init__(self, *args: object, **kwargs: object) -> None:
            kwargs["verify"] = False
            super().__init__(*args, **kwargs)

    class _NoVerifyClient(_orig_sync):  # type: ignore[valid-type,misc]
        def __init__(self, *args: object, **kwargs: object) -> None:
            kwargs["verify"] = False
            super().__init__(*args, **kwargs)

    httpx.AsyncClient = _NoVerifyAsyncClient  # type: ignore[misc,assignment]
    httpx.Client = _NoVerifyClient  # type: ignore[misc,assignment]
    try:
        yield
    finally:
        httpx.AsyncClient = _orig_async  # type: ignore[misc,assignment]
        httpx.Client = _orig_sync  # type: ignore[misc,assignment]


@pytest.fixture(scope="session")
def test_cwd() -> Path:
    cwd = Path(os.environ.get("E2E_TEST_CWD", "/tmp/e2e-pi-sidecar-tests"))
    cwd.mkdir(parents=True, exist_ok=True)
    return cwd


@pytest.fixture(scope="session")
def installed_agents() -> list[str]:
    """PATH detection only — ignores any pre-set CLI_AGENTS / ACPX_AGENTS."""
    detected = _detect_installed_agents()
    if not detected:
        pytest.fail("no CLI agents on PATH (need claude, gemini, and/or agent|cursor)")
    logger.info("installed_agents=%s", detected)
    return detected


@pytest.fixture(scope="session")
def agent_env(installed_agents: list[str], test_cwd: Path) -> Iterator[list[str]]:
    """Set CLI_AGENTS + ACPX_AGENTS and plant e2e-only project settings under test_cwd.

    Does not touch ~/.pi or the repo .pi. Sidecar must start with cwd=test_cwd so
    acpx-provider's getSetting(process.cwd()) reads this file instead of global ~/.pi.
    """
    value = ",".join(installed_agents)
    os.environ["CLI_AGENTS"] = value
    os.environ["ACPX_AGENTS"] = value

    settings_path = test_cwd / ".pi" / "pi-config-settings.json"
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "acpx_agents": list(installed_agents),
        "cli_agents": list(installed_agents),
    }
    settings_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    logger.info(
        "agent_env CLI_AGENTS=%s ACPX_AGENTS=%s e2e_settings=%s",
        value,
        value,
        settings_path,
    )

    try:
        yield installed_agents
    finally:
        settings_path.unlink(missing_ok=True)


@pytest.fixture(scope="session")
def sidecar_url(agent_env: list[str], test_cwd: Path) -> Iterator[str]:
    host = os.environ.get("SIDECAR_HOST", "127.0.0.1")
    port = int(os.environ["SIDECAR_PORT"]) if os.environ.get("SIDECAR_PORT") else _pick_free_port()
    url = f"http://{host}:{port}"
    agents_csv = ",".join(agent_env)

    if not (REPO_ROOT / "dist" / "server.js").is_file():
        subprocess.run(["npm", "run", "build"], cwd=REPO_ROOT, check=True)

    env = {
        **os.environ,
        "SIDECAR_HOST": host,
        "SIDECAR_PORT": str(port),
        "SIDECAR_URL": url,
        "CLI_AGENTS": agents_csv,
        "ACPX_AGENTS": agents_csv,
        "PI_SIDECAR_LOG_LEVEL": os.environ.get("PI_SIDECAR_LOG_LEVEL", "INFO"),
    }
    os.environ.update({
        "SIDECAR_HOST": host,
        "SIDECAR_PORT": str(port),
        "SIDECAR_URL": url,
        "CLI_AGENTS": agents_csv,
        "ACPX_AGENTS": agents_csv,
    })

    if _health_ok(url):
        _stop_sidecar(port, url)

    # cwd=test_cwd so acpx-provider getSetting reads e2e project settings, not ~/.pi.
    logger.info(
        "sidecar start url=%s cwd=%s CLI_AGENTS=%s ACPX_AGENTS=%s",
        url,
        test_cwd,
        agents_csv,
        agents_csv,
    )
    subprocess.run([str(START_SCRIPT)], cwd=str(test_cwd), env=env, check=True)

    deadline = time.time() + 60
    while time.time() < deadline:
        if _health_ok(url):
            break
        time.sleep(0.5)
    else:
        _stop_sidecar(port, url)
        pytest.fail(f"sidecar did not become healthy at {url}")

    try:
        yield url
    finally:
        logger.info("sidecar stop port=%s", port)
        try:
            _stop_sidecar(port, url)
        except Exception as exc:
            logger.error("sidecar stop FAILED: %s", exc)
            raise


@pytest.fixture(scope="session")
def working_models(
    sidecar_url: str,
    agent_env: list[str],
    test_cwd: Path,
) -> dict[str, str]:
    """provider → first model that completes a tiny prompt.

    Missing/broken providers are omitted (logged). Per-provider tests fail via ``model``.
    """
    providers = _providers_for_agents(agent_env)

    async def _discover() -> dict[str, str]:
        pi_sidecar_client._client = None
        pi_sidecar_client.SIDECAR_URL = sidecar_url
        os.environ["SIDECAR_URL"] = sidecar_url
        client = SidecarClient(base_url=sidecar_url, verify=False)
        cwd = str(test_cwd)
        out: dict[str, str] = {}
        try:
            catalog = await client.get_models()
            counts = {p: sum(1 for m in catalog if m.get("provider") == p) for p in providers}
            logger.info(
                "probing working models catalog=%d providers=%s counts=%s",
                len(catalog),
                providers,
                counts,
            )
            empty_catalog = [p for p, n in counts.items() if n == 0]
            if empty_catalog:
                logger.warning(
                    "providers missing from GET /models (per-provider tests will fail): %s counts=%s",
                    empty_catalog,
                    counts,
                )
            for provider in providers:
                if counts.get(provider, 0) == 0:
                    continue
                mid = await _probe_first_working(
                    client,
                    provider=provider,
                    model_ids=_model_ids(catalog, provider),
                    cwd=cwd,
                )
                if mid:
                    out[provider] = mid
            missing = [p for p in providers if p not in out]
            logger.info("working_models=%s missing=%s", out, missing)
            if missing:
                logger.warning(
                    "no working model after probe for %s (those provider cases will fail)",
                    missing,
                )
            return out
        finally:
            await client.close()
            pi_sidecar_client._client = None

    return asyncio.run(_discover())


@pytest.fixture
def model(provider: str, working_models: dict[str, str]) -> str:
    mid = working_models.get(provider)
    if not mid:
        pytest.fail(f"no working model for {provider}; working_models={working_models}")
    return mid


@pytest.fixture(autouse=True)
def _reset_client_singleton(sidecar_url: str) -> Iterator[None]:
    pi_sidecar_client._client = None
    pi_sidecar_client.SIDECAR_URL = sidecar_url
    os.environ["SIDECAR_URL"] = sidecar_url
    yield
    pi_sidecar_client._client = None


@pytest_asyncio.fixture
async def client(sidecar_url: str) -> AsyncIterator[SidecarClient]:
    c = SidecarClient(base_url=sidecar_url, verify=False)
    try:
        yield c
    finally:
        await c.close()


@pytest_asyncio.fixture
async def models(client: SidecarClient) -> list[dict]:
    return await client.get_models()


@pytest.fixture
def project_math_agent(test_cwd: Path) -> Path:
    """Plant e2e-math where each harness looks for agents (never home dirs).

    - Pi native ``subagent``: ``{cwd}/.pi/agents/``
    - Claude Code (cli-/acpx-claude): ``{cwd}/.claude/agents/``
    - Gemini CLI (cli-/acpx-gemini): ``{cwd}/.gemini/agents/``
    """
    body = """---
name: e2e-math
description: Tiny math helper for e2e tests. Answers arithmetic with a single number. Use for 2+2 style questions.
---

You are a math helper. Reply with ONLY the numeric answer. No words, no tools.
"""
    paths = [
        test_cwd / ".pi" / "agents" / "e2e-math.md",
        test_cwd / ".claude" / "agents" / "e2e-math.md",
        test_cwd / ".gemini" / "agents" / "e2e-math.md",
    ]
    for path in paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
    return paths[0]
