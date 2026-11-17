ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.21
FROM ${BUILD_FROM}

RUN apk add --no-cache python3 py3-aiohttp

COPY app /app
WORKDIR /app

CMD ["python3", "-u", "/app/main.py"]
