import pytest

import pi_sidecar_client


@pytest.fixture(autouse=True)
def _reset_singleton():
    """Reset the module-level singleton client between tests."""
    pi_sidecar_client._client = None
    pi_sidecar_client._usage_recorder = None
    yield
    pi_sidecar_client._client = None
    pi_sidecar_client._usage_recorder = None
