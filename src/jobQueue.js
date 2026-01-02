// jobQueue.js
// Supports optional Redis-backed Bull queue when REDIS_URL is provided.
const REDIS_URL = process.env.REDIS_URL;
let bullQueue = null;
let inMemoryQueue = [];
let inMemoryRunning = false;

const { processJob } = require("./jobHandlers");

async function processInMemory() {
  if (inMemoryRunning) return;
  inMemoryRunning = true;
  while (inMemoryQueue.length > 0) {
    const item = inMemoryQueue.shift();
    try {
      if (typeof item === "function") {
        await item();
      } else {
        // serializable job object
        await processJob(item);
      }
    } catch (e) {
      try {
        console.error("jobQueue in-memory job error:", e);
      } catch (er) {}
    }
  }
  inMemoryRunning = false;
}

if (REDIS_URL) {
  try {
    const Bull = require("bull");
    bullQueue = new Bull("damas-jobs", REDIS_URL);
    // optional: handle failed jobs log
    bullQueue.on("failed", (job, err) => {
      try {
        console.error("Bull job failed", job.id, err);
      } catch (e) {}
    });
  } catch (e) {
    try {
      console.warn(
        "Failed to initialize Bull, falling back to in-memory queue"
      );
    } catch (er) {}
    bullQueue = null;
  }
}

/**
 * enqueue accepts either:
 * - a function: will be executed in-memory (current behavior)
 * - a serializable job object: { type: '...', payload: { ... } }
 */
function enqueue(jobOrFn) {
  if (typeof jobOrFn === "function") {
    inMemoryQueue.push(jobOrFn);
    setImmediate(processInMemory);
    try {
      console.log("[jobQueue] enqueued function job (in-memory)");
    } catch (e) {}
    return;
  }

  if (!jobOrFn || typeof jobOrFn.type !== "string")
    throw new Error("job must be a function or an object with a 'type' string");

  if (bullQueue) {
    // Push serializable job to Bull (shared across nodes)
    try {
      bullQueue.add(jobOrFn).catch(() => {});
      try {
        console.log(
          "[jobQueue] enqueued job to Bull:",
          jobOrFn.type || "<unknown>"
        );
      } catch (e) {}
    } catch (e) {
      // If enqueue to Bull fails, fallback to local processing
      inMemoryQueue.push(jobOrFn);
      setImmediate(processInMemory);
    }
  } else {
    // No Redis/Bull: process in-process via handlers
    inMemoryQueue.push(jobOrFn);
    setImmediate(processInMemory);
    try {
      console.log(
        "[jobQueue] enqueued job in-memory:",
        jobOrFn.type || "<unknown>"
      );
    } catch (e) {}
  }
}

module.exports = { enqueue };
