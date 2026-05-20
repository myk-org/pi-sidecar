import asyncio
import inspect
import os
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx
from simple_logger.logger import get_logger

logger = get_logger(name=__name__, level=os.environ.get("LOG_LEVEL", "INFO"))

SIDECAR_URL = os.environ.get("SIDECAR_URL", "http://127.0.0.1:9100")
DEFAULT_CWD = tempfile.gettempdir()

__all__ = [
    "AIResult",
    "AITokenUsage",
    "SidecarClient",
    "call_ai",
    "call_ai_once",
    "check_sidecar_available",
    "get_sidecar_client",
    "list_models",
    "run_parallel_with_limit",
    "set_usage_recorder",
]


@dataclass
class AITokenUsage:
    """Token usage data from an AI call."""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    cost_usd: float | None = None
    duration_ms: int | None = None
    provider: str = ""
    model: str = ""
    session_id: str = ""


# Module-level callback — consumers register their storage function
_usage_recorder: Callable | None = None


def set_usage_recorder(callback: Callable) -> None:
    """Register a callback for recording AI token usage.

    The callback may be sync or async:
        def recorder(*, request_id, result, call_type, prompt_chars, ai_provider, ai_model)
        async def recorder(*, request_id, result, call_type, prompt_chars, ai_provider, ai_model)
    """
    global _usage_recorder
    _usage_recorder = callback


@dataclass
class AIResult:
    """Result from an AI call."""

    success: bool
    text: str
    usage: AITokenUsage | None = None
    session_id: str | None = None

    async def record_usage(
        self,
        *,
        request_id: str,
        call_type: str,
        prompt_chars: int = 0,
        ai_provider: str = "",
        ai_model: str = "",
    ) -> None:
        """Record token usage via the registered callback. Best-effort — never raises."""
        if not _usage_recorder:
            return
        try:
            maybe_coro = _usage_recorder(
                request_id=request_id,
                result=self,
                call_type=call_type,
                prompt_chars=prompt_chars,
                ai_provider=ai_provider,
                ai_model=ai_model,
            )
            if inspect.isawaitable(maybe_coro):
                await maybe_coro
        except Exception:
            logger.debug("Failed to record usage", exc_info=True)


# Provider mapping: friendly provider names → sidecar provider names
_PROVIDER_MAP = {
    "cursor": "acpx-cursor",
    "claude": "google-vertex-claude",
    "gemini": "google",
}


def _map_provider_model(provider: str, model: str) -> tuple[str, str]:
    """Map friendly provider/model names to sidecar provider/model."""
    sidecar_provider = _PROVIDER_MAP.get(provider, provider)
    sidecar_model = model
    # Cursor models need the cursor: prefix
    if sidecar_provider == "acpx-cursor" and not model.startswith("cursor:"):
        sidecar_model = f"cursor:{model}"
    if sidecar_provider != provider or sidecar_model != model:
        logger.debug("Provider mapped: %s/%s → %s/%s", provider, model, sidecar_provider, sidecar_model)
    return sidecar_provider, sidecar_model


class SidecarClient:
    """HTTP client for the Pi SDK sidecar service."""

    def __init__(self, base_url: str = SIDECAR_URL):
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(base_url=self._base_url, timeout=600.0)
        self._closed = False

    async def health(self) -> dict:
        """Check sidecar health."""
        logger.debug("Checking sidecar health: url=%s", self._base_url)
        resp = await self._client.get("/health")
        resp.raise_for_status()
        data = resp.json()
        logger.debug("Sidecar health response: %s", data)
        return data

    async def get_models(self) -> list[dict]:
        """Get available models."""
        logger.debug("Fetching models from sidecar")
        resp = await self._client.get("/models")
        resp.raise_for_status()
        models = resp.json().get("models", [])
        logger.debug("Fetched %d models from sidecar", len(models))
        return models

    async def refresh_models(self) -> list[dict]:
        """Trigger model discovery and return updated list."""
        logger.debug("Triggering model refresh on sidecar")
        resp = await self._client.post("/models/refresh")
        resp.raise_for_status()
        models = resp.json().get("models", [])
        logger.info("Model refresh complete: %d models available", len(models))
        return models

    async def create_session(
        self,
        *,
        provider: str,
        model: str,
        system_prompt: str,
        cwd: str = DEFAULT_CWD,
        custom_tools: list | None = None,
    ) -> str:
        """Create a new AI session. Returns session_id."""
        sidecar_provider, sidecar_model = _map_provider_model(provider, model)
        logger.debug(
            "Creating session: provider=%s→%s, model=%s→%s, cwd=%s, custom_tools=%d",
            provider,
            sidecar_provider,
            model,
            sidecar_model,
            cwd,
            len(custom_tools or []),
        )
        body: dict[str, Any] = {
            "provider": sidecar_provider,
            "model": sidecar_model,
            "system_prompt": system_prompt,
            "cwd": cwd,
        }
        if custom_tools:
            body["custom_tools"] = custom_tools
        resp = await self._client.post("/sessions", json=body)
        resp.raise_for_status()
        session_id = resp.json()["session_id"]
        logger.info(
            "Session created: session_id=%s, provider=%s, model=%s", session_id, sidecar_provider, sidecar_model
        )
        return session_id

    async def prompt(self, session_id: str, message: str, timeout: float | None = None) -> AIResult:
        """Send a message to a session. Returns AIResult."""
        logger.debug("Sending prompt: session=%s, message_length=%d", session_id, len(message))
        request_timeout = timeout or self._client.timeout
        resp = await self._client.post(
            f"/sessions/{session_id}/prompt",
            json={"message": message},
            timeout=request_timeout,
        )
        if resp.status_code != 200:
            try:
                payload = resp.json()
                error = payload.get("error", resp.text) if isinstance(payload, dict) else resp.text
            except ValueError:
                error = resp.text or f"HTTP {resp.status_code}"
            logger.error("Prompt failed: session=%s, status=%d, error=%s", session_id, resp.status_code, error)
            return AIResult(success=False, text=error)

        data = resp.json()
        usage_data = data.get("usage", {})
        usage = AITokenUsage(
            input_tokens=usage_data.get("input_tokens", 0),
            output_tokens=usage_data.get("output_tokens", 0),
            cache_read_tokens=usage_data.get("cache_read_tokens", 0),
            cache_write_tokens=usage_data.get("cache_write_tokens", 0),
            cost_usd=usage_data.get("cost_usd"),
            duration_ms=usage_data.get("duration_ms"),
        )

        # Surface error from sidecar even on HTTP 200
        error = data.get("error")
        if error:
            logger.error(
                "Prompt returned error from AI: session=%s, error=%s, text_length=%d",
                session_id,
                error,
                len(data.get("text", "")),
            )
            return AIResult(success=False, text=error, usage=usage)

        text = data.get("text", "")
        if not text:
            logger.warning("Prompt returned empty text: session=%s, usage=%s", session_id, usage_data)

        logger.debug(
            "Prompt completed: session=%s, text_length=%d, input_tokens=%d, output_tokens=%d, duration_ms=%s",
            session_id,
            len(text),
            usage.input_tokens,
            usage.output_tokens,
            usage.duration_ms,
        )
        return AIResult(
            success=True,
            text=text,
            usage=usage,
        )

    async def abort(self, session_id: str) -> None:
        """Abort an in-progress prompt."""
        logger.debug("Aborting session: %s", session_id)
        resp = await self._client.post(f"/sessions/{session_id}/abort")
        resp.raise_for_status()
        logger.info("Session aborted: %s", session_id)

    async def delete_session(self, session_id: str) -> None:
        """Delete a session."""
        logger.debug("Deleting session: %s", session_id)
        resp = await self._client.delete(f"/sessions/{session_id}")
        resp.raise_for_status()
        logger.debug("Session deleted: %s", session_id)

    async def close(self) -> None:
        """Close the HTTP client."""
        logger.debug("Closing sidecar client: url=%s", self._base_url)
        await self._client.aclose()
        self._closed = True
        logger.debug("Sidecar client closed")


# Singleton client
_client: SidecarClient | None = None


def get_sidecar_client() -> SidecarClient:
    """Get the singleton sidecar client."""
    global _client
    if _client is None or _client._closed:
        _client = SidecarClient()
    return _client


# --- Convenience functions for single-shot AI calls ---


async def call_ai(
    prompt: str,
    *,
    ai_provider: str = "",
    ai_model: str = "",
    cwd: str | None = None,
    system_prompt: str = "",
    ai_call_timeout: int | None = None,
    session_id: str | None = None,
    custom_tools: list | None = None,
) -> AIResult:
    """Call AI via the sidecar.

    Creates a new session (or reuses *session_id*), sends the prompt,
    and returns the result with session_id attached.

    Session lifecycle:
    - Caller is responsible for deleting sessions when done.
    - For single-shot calls, use ``call_ai_once(...)``
      or call ``client.delete_session()`` manually after.
    - For multi-turn (peer debate), pass ``session_id`` from the
      previous result to continue the conversation.
    """
    logger.debug(
        "call_ai: provider=%s, model=%s, session_id=%s, prompt_length=%d",
        ai_provider,
        ai_model,
        session_id or "new",
        len(prompt),
    )
    client = get_sidecar_client()
    created_session = False
    try:
        if not session_id:
            session_id = await client.create_session(
                provider=ai_provider,
                model=ai_model,
                system_prompt=system_prompt or "You are a helpful assistant.",
                cwd=cwd or DEFAULT_CWD,
                custom_tools=custom_tools,
            )
            created_session = True
        # Convert minutes to seconds for httpx timeout
        timeout = ai_call_timeout * 60.0 if ai_call_timeout else None
        result = await client.prompt(session_id, prompt, timeout=timeout)
        # Attach session_id to result so callers can reuse or clean up
        result.session_id = session_id
        return result
    except Exception as e:
        logger.error("Sidecar call failed: %s", e, exc_info=True)
        # Clean up session if WE created it and the prompt failed
        cleanup_succeeded = False
        if created_session and session_id:
            try:
                await client.delete_session(session_id)
                cleanup_succeeded = True
            except Exception:
                logger.debug("Failed to cleanup leaked session %s", session_id, exc_info=True)
        return AIResult(
            success=False,
            text=str(e),
            session_id=None if cleanup_succeeded else session_id,
        )


async def call_ai_once(
    prompt: str,
    *,
    ai_provider: str = "",
    ai_model: str = "",
    cwd: str | None = None,
    system_prompt: str = "",
    ai_call_timeout: int | None = None,
    custom_tools: list | None = None,
) -> AIResult:
    """Single-shot AI call with automatic session cleanup.

    Creates a session, sends the prompt, and deletes the session.
    Cleanup is best-effort — if deletion fails, result.session_id is
    preserved so the caller can retry cleanup.
    Use ``call_ai`` directly for multi-turn conversations.
    """
    logger.debug("call_ai_once: provider=%s, model=%s, prompt_length=%d", ai_provider, ai_model, len(prompt))
    result = await call_ai(
        prompt,
        ai_provider=ai_provider,
        ai_model=ai_model,
        cwd=cwd,
        system_prompt=system_prompt,
        ai_call_timeout=ai_call_timeout,
        custom_tools=custom_tools,
    )
    # Always clean up — this is a single-shot call
    if result.session_id:
        try:
            await get_sidecar_client().delete_session(result.session_id)
            result.session_id = None  # Clear so caller doesn't try to reuse
        except Exception:
            logger.warning("Failed to cleanup session %s after call_ai_once", result.session_id, exc_info=True)
            # Preserve session_id so caller can retry cleanup
    return result


async def list_models(provider: str = "") -> list[dict]:
    """List available models, optionally filtered by provider."""
    logger.debug("list_models: provider_filter=%s", provider or "none")
    client = get_sidecar_client()
    models = await client.get_models()
    if provider:
        sidecar_provider = _PROVIDER_MAP.get(provider, provider)
        models = [m for m in models if m.get("provider") == sidecar_provider]
    return models


async def check_sidecar_available() -> tuple[bool, str]:
    """Check if the sidecar service is available and ready."""
    logger.debug("Checking sidecar availability")
    try:
        client = get_sidecar_client()
        data = await client.health()
        if data.get("status") == "ok":
            return True, "Sidecar is ready"
        if data.get("status") == "starting":
            return False, f"Sidecar starting: {data.get('message', 'model discovery in progress')}"
        return False, f"Sidecar unhealthy: {data}"
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 503:
            try:
                data = e.response.json()
                return False, f"Sidecar starting: {data.get('message', 'model discovery in progress')}"
            except ValueError:
                pass
        return False, f"Sidecar unhealthy (HTTP {e.response.status_code})"
    except Exception as e:
        return False, f"Sidecar unavailable: {e}"


async def run_parallel_with_limit(
    tasks: list,
    max_concurrency: int = 5,
) -> list:
    """Run async tasks in parallel with concurrency limit."""
    if max_concurrency < 1:
        raise ValueError("max_concurrency must be >= 1")

    semaphore = asyncio.Semaphore(max_concurrency)

    async def limited(coro):
        async with semaphore:
            return await coro

    return await asyncio.gather(*(limited(t) for t in tasks), return_exceptions=True)
