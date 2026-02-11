# UI backend container: Flask app served with gunicorn (L4T / robot onboard)
FROM nvcr.io/nvidia/l4t-base:r36.2.0

ENV PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive

# Install Python3 and pip if not present
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies (gunicorn in requirements.txt)
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Application code (no app code changes)
COPY app ./app
COPY run.py .
COPY mock_middleware ./mock_middleware

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 8000

# Healthcheck: same path works for main app and mock middleware
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://127.0.0.1:8000/api/capabilities/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
