#!/usr/bin/env python3
"""Run mock middleware server (port 8000). Use from backend dir: python run_mock_middleware.py"""
import sys
import os

# Ensure backend/app and mock_middleware are importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mock_middleware.app import app

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True, use_reloader=False)
