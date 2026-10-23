// 設定（settings/*）と勤務先のサンプル（sites）を Firestore に登録する。
// すでにあるドキュメントは上書きしない（--force を付けたときだけ上書きする）。
// 使い方:
//   npm run seed                           # settings のうち、ないものだけ登録
//   npm run seed -- --with-sample-sites    # 勤務先が1件もなければサンプルも登録
//   npm run seed -- --force                # settings を settings.json の内容で上書き
import { readFileSync } from "node:fs";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const force = process.argv.includes("--force");
initializeApp({ credential: applicationDefault(), projectId: "worknote-6dc51" });
const db = getFirestore();

const settings = JSON.parse(readFileSync(new URL("./settings.json", import.meta.url)));
for (const [docId, data] of Object.entries(settings)) {
  const ref = db.doc(`settings/${docId}`);
  if (!force && (await ref.get()).exists) {
    console.log(`settings/${docId} はすでにあるので、そのままにしました`);
    continue;
  }
  await ref.set(data);
  console.log(`settings/${docId} を登録しました`);
}

if (process.argv.includes("--with-sample-sites")) {
  const existing = await db.collection("sites").limit(1).get();
  if (!existing.empty) {
    console.log("sites はすでに登録されているので、サンプルは入れませんでした");
  } else {
    const sites = JSON.parse(readFileSync(new URL("./sites.sample.json", import.meta.url)));
    for (const { id, ...site } of sites) {
      await db.doc(`sites/${id}`).set(site);
      console.log(`sites/${id} を登録しました`);
    }
  }
}
