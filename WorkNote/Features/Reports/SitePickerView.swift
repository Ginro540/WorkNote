import SwiftUI

/// 勤務先を選ぶ：管理者が登録した一覧から選ぶ（複数可）。名前・住所で検索。一覧にない現場は手入力
struct SitePickerView: View {
    @Binding var siteIds: [String]
    @Binding var manualSites: [String]

    @Environment(SettingsStore.self) private var settings
    @Environment(\.dismiss) private var dismiss

    @State private var selected: [String] = []
    @State private var manual: [String] = []
    @State private var query = ""
    @State private var newSite = ""
    @State private var loaded = false

    private var filtered: [Site] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return settings.sites }
        return settings.sites.filter { $0.name.localizedCaseInsensitiveContains(q) || $0.address.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section("勤務先の一覧") {
                    if settings.sites.isEmpty {
                        Text("登録されている勤務先はありません").foregroundStyle(.secondary)
                    } else if filtered.isEmpty {
                        Text("「\(query)」に当たる勤務先はありません").foregroundStyle(.secondary)
                    }
                    ForEach(filtered) { site in
                        let id = site.id ?? ""
                        Button {
                            if selected.contains(id) { selected.removeAll { $0 == id } } else { selected.append(id) }
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "mappin.circle.fill")
                                    .font(.title2)
                                    .foregroundStyle(Color(hex: 0x22B07D))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(site.name).foregroundStyle(.primary)
                                    Text(site.address).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: selected.contains(id) ? "checkmark.circle.fill" : "circle")
                                    .font(.title2)
                                    .foregroundStyle(selected.contains(id) ? Color(hex: 0x1E8FC4) : Color(.systemGray3))
                            }
                        }
                    }
                }

                Section {
                    ForEach(manual, id: \.self) { name in
                        HStack {
                            Image(systemName: "pencil.circle.fill").foregroundStyle(.secondary)
                            Text(name)
                        }
                    }
                    .onDelete { manual.remove(atOffsets: $0) }
                    HStack {
                        TextField("一覧にない勤務先を入力", text: $newSite)
                            .onSubmit(addManual)
                        Button("追加", action: addManual)
                            .disabled(newSite.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                } header: {
                    Text("一覧にない場合")
                } footer: {
                    Text("一覧への登録は管理者が行います。")
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "名前・住所で探す")
            .navigationTitle("勤務先を選ぶ")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("決定（\(selected.count + manual.count)件）") {
                        siteIds = selected
                        manualSites = manual
                        dismiss()
                    }
                }
            }
            .onAppear {
                guard !loaded else { return }
                loaded = true
                selected = siteIds
                manual = manualSites
            }
        }
    }

    private func addManual() {
        let name = newSite.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty, !manual.contains(name) else { return }
        manual.append(name)
        newSite = ""
    }
}
