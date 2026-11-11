-- Flatten raw event and pageview streams into one clean table.
-- Runs nightly from cron. Nothing downstream knows that.

CREATE TABLE analytics.events_clean AS
SELECT
    e.event_id,
    e.user_id,
    e.event_name,
    e.event_time,
    p.page_path,
    p.referrer
FROM raw.events e
LEFT JOIN raw.pageviews p
       ON p.event_id = e.event_id
WHERE e.event_time >= {{start_date}};
