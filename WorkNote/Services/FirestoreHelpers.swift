import Foundation
import FirebaseFirestore

extension Firestore {
    static var db: Firestore { Firestore.firestore() }
}

extension Query {
    /// スナップショットを型に変換して受け取る。
    /// 2つ目の引数は、まだサーバーに届いていない（オフラインで保存した）ドキュメントの ID。
    func listen<T: Decodable>(
        _ type: T.Type,
        onChange: @escaping ([T], Set<String>) -> Void
    ) -> ListenerRegistration {
        addSnapshotListener(includeMetadataChanges: true) { snapshot, error in
            guard let snapshot else {
                if let error { print("Firestore listen error: \(error)") }
                return
            }
            let items = snapshot.documents.compactMap { doc -> T? in
                do {
                    return try doc.data(as: T.self)
                } catch {
                    print("Firestore decode error \(doc.reference.path): \(error)")
                    return nil
                }
            }
            let pending = Set(snapshot.documents.filter { $0.metadata.hasPendingWrites }.map(\.documentID))
            onChange(items, pending)
        }
    }
}

extension DocumentReference {
    func listen<T: Decodable>(_ type: T.Type, onChange: @escaping (T?) -> Void) -> ListenerRegistration {
        addSnapshotListener { snapshot, error in
            if let error { print("Firestore listen error: \(error)") }
            guard let snapshot, snapshot.exists else { return onChange(nil) }
            onChange(try? snapshot.data(as: T.self))
        }
    }
}
