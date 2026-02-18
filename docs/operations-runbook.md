# Operations Runbook

## Service Startup

```bash
docker compose up --build -d
docker compose ps
```

## Database Bootstrap

```bash
npm --workspace @chat3d/backend run db:bootstrap
```

## Health Checks

- Liveness:
```bash
curl -s http://localhost:3001/health
```
- Readiness:
```bash
curl -s http://localhost:3001/ready
```

## Security Controls Verification

- Security headers:
```bash
curl -i http://localhost:3001/health
```
- CORS preflight:
```bash
curl -i -X OPTIONS http://localhost:3001/api/auth/login \
  -H 'Origin: http://localhost' \
  -H 'Access-Control-Request-Method: POST'
```

## Account Deletion Sweep

Runs cleanup for users whose 30-day deactivation window expired.

```bash
npm --workspace @chat3d/backend run worker:account-deletion
```

## Logs

- Backend container logs:
```bash
docker compose logs backend --tail=200
```
- Build123d logs:
```bash
docker compose logs build123d --tail=200
```

## Recovery

1. Restart stack:
```bash
docker compose down
docker compose up -d
```
2. Re-run migrations:
```bash
npm --workspace @chat3d/backend run db:migrate
```
3. Validate readiness endpoint.
