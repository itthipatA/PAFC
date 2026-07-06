"""Shared fixtures and configuration for tests."""
import pytest
import os
import sys

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture
def sample_data():
    """Sample data fixture — customize as needed."""
    return {}


@pytest.fixture
def mock_env(monkeypatch):
    """Mock environment variables for testing."""
    monkeypatch.setenv("TESTING", "1")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")

