// One command to run the app locally: the blob store and the web app together. Ctrl+C stops both.
//   npm run demo           (after `npm run setup`)
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const procs = [["blobs", ["run", "blobs"]], ["app", ["run", "dev"]]].map(([name, args]) => {
  // npm is npm.cmd on Windows, which spawn only finds through a shell.
  const p = spawn("npm", args, { cwd: fileURLToPath(new URL("../web/", import.meta.url)), stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  const tag = (d) => String(d).split("\n").filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  p.stdout.on("data", tag); p.stderr.on("data", tag);
  p.on("exit", (code) => { if (code) { console.error(`[${name}] exited with ${code}`); stop(1); } });
  return p;
});
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; procs.forEach((p) => p.kill()); setTimeout(() => process.exit(code), 300); }
process.on("SIGINT", () => stop()); process.on("SIGTERM", () => stop());
console.log("\nVeil: open http://localhost:5173/#/app  (Ctrl+C to stop)\n");
