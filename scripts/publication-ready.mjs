import { appendFile } from "node:fs/promises";
import { CONFIG } from "../public/config.js";
import { publicConfigReady } from "../public/validation.js";
const ready = publicConfigReady(CONFIG) && Boolean(CONFIG.operatorName.trim()) && /^https:\/\//.test(CONFIG.contactUrl);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `ready=${ready}\n`);
console.log(ready ? "接続設定がそろいました。公開ビルドへ進みます。" : "初期設定が未完了です。テストのみ実行し、Pages公開は保留します。");
