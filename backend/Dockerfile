# ==============================================================================
# BIZFLOW AI — FASTAPI BACKEND PRODUCTION DOCKERFILE
# ==============================================================================
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies including libpq for PostgreSQL and curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application source code
COPY . .

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PORT=8000

EXPOSE 8000

# Healthcheck targeting Core FastAPI Health Endpoint
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
    CMD curl -f http://127.0.0.1:8000/api/v1/health || exit 1

# Start Uvicorn ASGI server
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
