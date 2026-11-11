-- Monthly recurring revenue, staged through a temp table because the
-- invoice join is expensive and we need it twice.

CREATE TEMP TABLE tmp_invoice_stage AS
SELECT
    invoice_id,
    customer_id,
    amount_cents,
    period_start,
    period_end
FROM raw.stripe_invoices
WHERE period_start >= {{start_date}}
  AND status = 'paid';

INSERT INTO analytics.mrr_daily (day, plan, mrr_cents, customers)
SELECT
    DATE(i.period_start)          AS day,
    sub.plan,
    SUM(i.amount_cents)           AS mrr_cents,
    COUNT(DISTINCT i.customer_id) AS customers
FROM tmp_invoice_stage i
JOIN raw.subscriptions sub
  ON sub.customer_id = i.customer_id
GROUP BY DATE(i.period_start), sub.plan;
