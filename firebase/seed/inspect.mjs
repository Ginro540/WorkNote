// 読み取り専用：今の Firestore の中身（コレクションごとの件数・フィールドの型・settings）を表示する。何も書き込まない。
// 使い方: npm run inspect
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

initializeApp({ credential: applicationDefault(), projectId: "worknote-6dc51" });
const db = getFirestore();

function typeOf(v) {
  if (v === null) return "null";
  if (v instanceof Timestamp) return "timestamp";
  if (Array.isArray(v)) return `array<${[...new Set(v.map(typeOf))].join("|") || "empty"}>`;
  if (typeof v === "object" && v.constructor?.name === "GeoPoint") return "geopoint";
  if (typeof v === "object") return "{" + Object.entries(v).map(([k, x]) => `${k}:${typeOf(x)}`).join(", ") + "}";
  return typeof v;
}

async function describe(col, depth = 0) {
  const snap = await col.limit(300).get();
  const pad = "  ".repeat(depth);
  const fields = {};
  const values = {};
  for (const d of snap.docs) {
    for (const [k, v] of Object.entries(d.data())) {
      (fields[k] ??= new Set()).add(typeOf(v));
      if (["status", "kind", "role", "locationStatus", "month", "type"].includes(k) && typeof v === "string") (values[k] ??= new Set()).add(v);
    }
  }
  console.log(`${pad}■ ${col.path}  ${snap.size}${snap.size === 300 ? "+" : ""}件  ID例: ${snap.docs.slice(0, 3).map(d => d.id).join(", ")}`);
  for (const [k, t] of Object.entries(fields)) console.log(`${pad}    ${k}: ${[...t].join(" / ")}${values[k] ? "   値: " + [...values[k]].join(", ") : ""}`);
  for (const d of snap.docs.slice(0, 5)) {
    for (const sub of await d.ref.listCollections()) await describe(sub, depth + 1);
  }
}

const roots = await db.listCollections();
console.log("ルートのコレクション:", roots.map(c => c.id).join(", ") || "(なし)");
for (const c of roots) {
  if (c.id === "settings") {
    const snap = await c.get();
    console.log(`■ settings  ${snap.size}件`);
    for (const d of snap.docs) console.log(`  [${d.id}]`, JSON.stringify(d.data()).slice(0, 1500));
  } else {
    await describe(c);
  }
}
