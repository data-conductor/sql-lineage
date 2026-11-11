-- Older backfill job. Still scheduled. Writes a narrower column set
-- into the same table 03_users_daily.sql writes.

INSERT INTO analytics.users_daily (day, user_id, sessions)
SELECT
    DATE(u.created_at) AS day,
    u.user_id,
    0                  AS sessions
FROM raw.users u
WHERE u.created_at >= CURRENT_DATE - INTERVAL '90 days';
