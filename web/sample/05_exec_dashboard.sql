-- What the exec dashboard actually queries. One row per day.

CREATE TABLE analytics.exec_summary AS
SELECT
    u.day,
    SUM(u.sessions)      AS sessions,
    COUNT(DISTINCT u.user_id) AS active_users,
    MAX(m.mrr_cents)     AS mrr_cents
FROM analytics.users_daily u
LEFT JOIN analytics.mrr_daily m
       ON m.day = u.day
GROUP BY u.day;
