-- Escalations on requests that closed before resolution was recorded take the
-- request's closing time, so the register does not show them as still open.
UPDATE "escalations" e
SET "resolvedAt" = r."closedAt"
FROM "service_requests" r
WHERE e."requestId" = r.id
  AND r.status = 'CLOSED'
  AND r."closedAt" IS NOT NULL
  AND e."resolvedAt" IS NULL;
