-- Group cleaned events into sessions with a 30-minute inactivity gap.

CREATE TABLE analytics.sessions AS
SELECT
    user_id,
    session_id,
    MIN(event_time)   AS session_start,
    MAX(event_time)   AS session_end,
    COUNT(*)          AS event_count
FROM (
    SELECT
        user_id,
        event_time,
        SUM(new_session) OVER (PARTITION BY user_id ORDER BY event_time) AS session_id
    FROM (
        SELECT
            user_id,
            event_time,
            CASE WHEN event_time - LAG(event_time)
                      OVER (PARTITION BY user_id ORDER BY event_time) > INTERVAL '30 minutes'
                 THEN 1 ELSE 0 END AS new_session
        FROM analytics.events_clean
    ) gaps
) marked
GROUP BY user_id, session_id;
