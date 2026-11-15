// Copies the freshly built widget bundle into public/, so the home page can embed the real chat.
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const from = fileURLToPath(new URL("../../widget/dist/veil-widget.js", import.meta.url));
const to = fileURLToPath(new URL("../public/veil-widget.js", import.meta.url));
if (!existsSync(from)) { console.error("widget/dist/veil-widget.js is missing: run `npm --prefix ../widget run build` first"); process.exit(1); }
copyFileSync(from, to);
console.log("copied veil-widget.js into public/");
