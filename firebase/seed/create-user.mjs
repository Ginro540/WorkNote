// 従業員アカウントを発行する（アプリからは新規登録できないため）。
// 使い方:
//   npm run create-user -- <email> <password> <表示名> [employee|admin]
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const [email, password, displayName, role = "employee"] = process.argv.slice(2);
if (!email || !password || !displayName || !["employee", "admin"].includes(role)) {
  console.error("使い方: npm run create-user -- <email> <password> <表示名> [employee|admin]");
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId: "worknote-6dc51" });
const user = await getAuth().createUser({ email, password, displayName });
await getFirestore().doc(`users/${user.uid}`).set({
  displayName,
  email,
  role,
  createdAt: FieldValue.serverTimestamp(),
});
console.log(`${displayName}（${email}、${role}）を登録しました uid=${user.uid}`);
