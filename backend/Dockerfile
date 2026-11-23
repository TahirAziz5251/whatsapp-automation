# ==============================================================================
# BIZFLOW AI — FASTAPI BACKEND PRODUCTION DOCKERFILE
# Multi-stage, secure non-root user, optimized layer caching
# ==============================================================================

# Stage 1: Build & Dependencies
FROM python:3.11-slim as builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt


# Stage 2: Production Runner
FROM python:3.11-slim as runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create secure non-root user
RUN groupadd -g 1001 bizflow && \
    useradd -u 1001 -g bizflow -m -s /bin/bash bizflow

# Copy installed python packages from builder
COPY --from=builder /root/.local /home/bizflow/.local

ENV PATH=/home/bizflow/.local/bin:$PATH
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Copy application source code
COPY --chown=bizflow:bizflow . .

USER bizflow

EXPOSE 8000

# Healthcheck targeting Core FastAPI Health Endpoint
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/v1/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
