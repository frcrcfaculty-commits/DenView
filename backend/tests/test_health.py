"""
Backend API Health Check Tests
Tests the /api/health endpoint for DentView application
"""
import pytest
import requests
import os
from pathlib import Path

# Get backend URL from environment or frontend .env
BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', '')

# If not in environment, try reading from frontend/.env
if not BASE_URL:
    frontend_env = Path(__file__).parent.parent.parent / 'frontend' / '.env'
    if frontend_env.exists():
        with open(frontend_env) as f:
            for line in f:
                if line.startswith('EXPO_PUBLIC_BACKEND_URL='):
                    BASE_URL = line.split('=', 1)[1].strip()
                    break

BASE_URL = BASE_URL.rstrip('/')

if not BASE_URL:
    pytest.skip("EXPO_PUBLIC_BACKEND_URL not set", allow_module_level=True)


class TestHealthEndpoint:
    """Health endpoint tests"""

    def test_health_endpoint_returns_200(self):
        """Test that /api/health returns 200 status code"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"

    def test_health_endpoint_returns_json(self):
        """Test that /api/health returns valid JSON"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict), "Response should be a JSON object"

    def test_health_endpoint_has_status_field(self):
        """Test that /api/health contains status field"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert "status" in data, "Response should contain 'status' field"
        assert data["status"] == "healthy", f"Expected status 'healthy', got {data.get('status')}"

    def test_health_endpoint_has_app_field(self):
        """Test that /api/health contains app field"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert "app" in data, "Response should contain 'app' field"
        assert data["app"] == "DentView", f"Expected app 'DentView', got {data.get('app')}"


class TestRootEndpoint:
    """Root API endpoint tests"""

    def test_root_endpoint_returns_200(self):
        """Test that /api/ returns 200 status code"""
        response = requests.get(f"{BASE_URL}/api/", timeout=10)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"

    def test_root_endpoint_has_message(self):
        """Test that /api/ contains message field"""
        response = requests.get(f"{BASE_URL}/api/", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert "message" in data, "Response should contain 'message' field"
        assert "version" in data, "Response should contain 'version' field"
