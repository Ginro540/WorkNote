// 従業員のパスワードを設定し直す（管理者用）。
// 使い方:
//   npm run set-password -- <email> <新しいパスワード>
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("使い方: npm run set-password -- <email> <新しいパスワード>");
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId: "worknote-6dc51" });
const auth = getAuth();
const user = await auth.getUserByEmail(email);
await auth.updateUser(user.uid, { password });
console.log(`${email} のパスワードを設定し直しました uid=${user.uid}`);
