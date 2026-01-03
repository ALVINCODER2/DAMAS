#!/usr/bin/env node
// tools/run_worker_daemon.js
// Simple supervisor that restarts src/worker.js if it exits.
// Usage: node tools/run_worker_daemon.js

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const workerPath = path.join(__dirname, "..", "src", "worker.js");
let restartAttempts = 0;
let child = null;

function startWorker() {
  console.log(new Date().toISOString(), "Starting worker...");
  child = spawn(process.execPath, [workerPath], {
    env: Object.assign({}, process.env),
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });

  child.on("exit", (code, signal) => {
    console.log(
      new Date().toISOString(),
      `Worker exited with code=${code} signal=${signal}`
    );
    // avoid tight crash loop: exponential backoff
    restartAttempts = Math.min(restartAttempts + 1, 10);
    const backoff = Math.min(300000, Math.pow(2, restartAttempts) * 1000); // up to 5min
    console.log(
      new Date().toISOString(),
      `Restarting worker in ${backoff / 1000}s`
    );
    setTimeout(startWorker, backoff);
  });

  child.on("error", (err) => {
    console.error(new Date().toISOString(), "Worker process error", err);
  });
}

// write pid file for external monitoring
const pidFile = path.join(__dirname, "..", "run", "worker_daemon.pid");
try {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
} catch (e) {}
fs.writeFileSync(pidFile, String(process.pid));
console.log("Supervisor PID:", process.pid, "pidfile:", pidFile);

startWorker();

process.on("SIGINT", () => {
  console.log("Supervisor SIGINT, stopping...");
  try {
    if (child) child.kill("SIGTERM");
  } catch (e) {}
  try {
    fs.unlinkSync(pidFile);
  } catch (e) {}
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("Supervisor SIGTERM, stopping...");
  try {
    if (child) child.kill("SIGTERM");
  } catch (e) {}
  try {
    fs.unlinkSync(pidFile);
  } catch (e) {}
  process.exit(0);
});
