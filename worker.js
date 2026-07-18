// Worker process entry point: `npm run worker`
//
// This runs alongside the web app, not inside it. A campaign to 10,000
// customers takes many minutes at a safe send rate — far longer than any HTTP
// request may live — so the web app only ever enqueues, and this process sends.

// .env is loaded by Node itself via --env-file-if-exists (see the npm script),
// so there is no dotenv dependency. In production the host supplies the vars and
// the flag is a no-op.
import { createWorker } from "./app/lib/queue/worker.server.js";

const worker = createWorker();
console.log("Worker process started. Waiting for jobs…");

// Finish what is in flight before exiting, so a deploy does not abandon
// half-sent campaigns.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`\n${signal} received — finishing in-flight jobs…`);
    worker.stop();
  });
}

await worker.start();
process.exit(0);
