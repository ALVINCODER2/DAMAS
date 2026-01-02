// src/worker.js
// Background worker to process Bull jobs when REDIS_URL is configured.
// Connects to MongoDB to perform DB writes like saveMatchHistory.

require("dotenv").config();
const REDIS_URL = process.env.REDIS_URL;
const MONGO_URI = process.env.MONGO_URI;
const mongoose = require("mongoose");

async function ensureMongo() {
  if (!MONGO_URI) {
    console.warn("Worker: MONGO_URI not configured — DB ops will fail.");
    return;
  }
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Worker: connected to MongoDB");
  } catch (e) {
    console.error("Worker: failed to connect to MongoDB:", e);
    throw e;
  }
}

const { processJob } = require("./jobHandlers");

async function start() {
  await ensureMongo();

  // Background cleanup of old match history (moved from index.js)
  try {
    const MatchHistory = require("../models/MatchHistory");
    const CLEANUP_INTERVAL =
      Number(process.env.CLEANUP_INTERVAL_MS) || 60 * 60 * 1000; // 1h
    const HISTORY_RETENTION =
      Number(process.env.HISTORY_RETENTION_MS) || 24 * 60 * 60 * 1000; // 24h
    let cleanupRunning = false;
    // Optional Redis lock to prevent multiple workers from running cleanup concurrently
    let redisClient = null;
    let haveRedisLockSupport = false;
    const LOCK_KEY =
      process.env.CLEANUP_LOCK_KEY || "damas:worker:cleanup:lock";
    const LOCK_TTL = Number(process.env.CLEANUP_LOCK_TTL_MS) || 1000 * 60 * 30; // 30 minutes
    const { createClient } = require("redis");
    if (REDIS_URL) {
      try {
        redisClient = createClient({ url: REDIS_URL });
        redisClient.on("error", (e) => console.warn("Worker Redis error:", e));
        await redisClient.connect();
        haveRedisLockSupport = true;
        console.log("Worker: connected to Redis for cleanup locking");
      } catch (e) {
        console.warn(
          "Worker: failed to connect Redis for cleanup lock, continuing without distributed lock:",
          e
        );
        redisClient = null;
        haveRedisLockSupport = false;
      }
    }

    async function runCleanup() {
      // local guard to prevent overlapping runs in same process
      if (cleanupRunning) return;

      // distributed lock: try to acquire if supported
      const lockValue = `${process.pid}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;
      let lockAcquired = false;
      if (haveRedisLockSupport && redisClient) {
        const setRes = await redisClient.set(LOCK_KEY, lockValue, {
          NX: true,
          PX: LOCK_TTL,
        });
        if (setRes !== "OK") {
          // another worker holds the lock
          return;
        }
        lockAcquired = true;
      }

      cleanupRunning = true;
      try {
        const cutoff = new Date(Date.now() - HISTORY_RETENTION);
        const BATCH_SIZE = 500;
        let totalDeleted = 0;
        while (true) {
          const docs = await MatchHistory.find({ createdAt: { $lt: cutoff } })
            .select("_id")
            .sort({ _id: 1 })
            .limit(BATCH_SIZE)
            .lean();
          if (!docs || docs.length === 0) break;
          const ids = docs.map((d) => d._id);
          const res = await MatchHistory.deleteMany({ _id: { $in: ids } });
          totalDeleted += res.deletedCount || 0;
          if (docs.length < BATCH_SIZE) break;
        }
        if (totalDeleted > 0) {
          console.log(
            `[Worker Cleanup] Removidos ${totalDeleted} registros antigos de histórico.`
          );
        }
      } catch (e) {
        console.error("[Worker Cleanup] Erro ao limpar histórico:", e);
      } finally {
        cleanupRunning = false;
        // release distributed lock if we acquired it
        if (haveRedisLockSupport && redisClient && lockAcquired) {
          try {
            // safe delete: only delete if value matches
            const script =
              "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
            await redisClient.eval(script, {
              keys: [LOCK_KEY],
              arguments: [lockValue],
            });
          } catch (er) {
            console.warn("Worker cleanup: failed to release lock:", er);
          }
        }
      }
    }

    // Run once shortly after startup, then on interval
    setTimeout(runCleanup, 5000);
    setInterval(runCleanup, CLEANUP_INTERVAL);
  } catch (e) {
    console.error("Worker: failed to schedule cleanup:", e);
  }

  if (!REDIS_URL) {
    console.log("No REDIS_URL configured — worker running in no-op mode.");
    console.log(
      "If you want background job processing, set REDIS_URL and restart worker."
    );
    return;
  }

  try {
    const Bull = require("bull");
    const queue = new Bull("damas-jobs", REDIS_URL);

    console.log("Worker connected to Bull queue (damas-jobs).");

    queue.process(async (job) => {
      try {
        const data = job && job.data;
        if (data && data.type) {
          await processJob(data);
        } else {
          // marker job
        }
      } catch (e) {
        console.error("Worker: error processing job", job.id, e);
        throw e;
      }
    });

    queue.on("failed", (job, err) => {
      console.error("Job failed:", job.id, err);
    });

    queue.on("completed", (job) => {
      // quiet by default
    });
  } catch (e) {
    console.error(
      "Failed to start Bull worker, falling back to no-op worker:",
      e
    );
  }
}

start().catch((e) => {
  console.error("Worker crashed:", e);
  process.exit(1);
});
