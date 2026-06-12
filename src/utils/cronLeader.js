'use strict';

/**
 * Single-runner guard for scheduled jobs.
 *
 * Under a PM2 cluster (or any multi-instance deploy) every instance boots server.js and would
 * schedule the SAME crons — double-firing the daily attendance sweep, so auto-approve /
 * auto-reject / month-close run concurrently on the same rows and race each other. This returns
 * true only on the one designated "leader" instance:
 *
 *   1. CRON_LEADER=true|1   -> this instance is the leader   (explicit override, wins)
 *      CRON_LEADER=false|0  -> this instance is NOT the leader
 *   2. else, PM2 cluster    -> leader is worker 0 only (PM2 sets NODE_APP_INSTANCE per worker)
 *   3. else (fork / single process, NODE_APP_INSTANCE unset) -> leader (nothing to dedupe)
 *
 * Tradeoff (why this over a DB advisory lock): an env/instance flag is zero-overhead, needs no
 * database round-trip, and is trivial to reason about. The cost is no automatic failover — if
 * the leader instance is down at fire time, that run is skipped until it returns, and it trusts
 * the operator to either run PM2 in cluster mode or set CRON_LEADER explicitly. A per-job
 * `pg_try_advisory_lock` would add failover (any instance can grab the lock) but costs a held
 * connection + lock bookkeeping on every run; for once-daily jobs that's not worth it.
 */
function isCronLeader() {
  const flag = String(process.env.CRON_LEADER || '').trim().toLowerCase();
  if (flag === 'true' || flag === '1') return true;
  if (flag === 'false' || flag === '0') return false;

  const inst = process.env.NODE_APP_INSTANCE; // PM2 cluster worker index ('0', '1', ...)
  return inst === undefined || inst === '' || inst === '0';
}

module.exports = { isCronLeader };
