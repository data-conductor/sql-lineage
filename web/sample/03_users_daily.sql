-- Daily per-user rollup. This is the table the dashboard reads.

INSERT INTO analytics.users_daily (
    day, user_id, plan, sessions, events, last_seen
)
SELECT
    DATE(s.session_start)   AS day,
    s.user_id,
    u.plan,
    COUNT(DISTINCT s.session_id) AS sessions,
    SUM(s.event_count)           AS events,
    MAX(s.session_end)           AS last_seen
FROM analytics.sessions s
JOIN raw.users u
  ON u.user_id = s.user_id
WHERE s.session_start >= {{start_date}}
GROUP BY DATE(s.session_start), s.user_id, u.plan;
