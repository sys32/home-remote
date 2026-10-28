import SwiftUI
import UIKit

@main
struct DomaTVApp: App {
    @StateObject private var store = RemoteStore()
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("doma.native.light") private var light = false
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(store).tint(Style.accent)
                .preferredColorScheme(light ? .light : .dark)
                .alert(item: $store.trustPrompt) { prompt in
                    Alert(title: Text(prompt.changed ? "Сертификатот на TV е сменет" : "Доверлив телевизор?"),
                          message: Text("Адреса: \(prompt.host)\nSHA-256:\n\(prompt.fingerprint)\n\nПрифати само ако ова е твојот телевизор на доверлива Wi-Fi мрежа."),
                          primaryButton: .default(Text("Верувај на овој TV"), action: { prompt.answer(true) }),
                          secondaryButton: .cancel(Text("Откажи"), action: { prompt.answer(false) }))
                }
        }.onChange(of: scenePhase) { _, phase in if phase == .background { store.cancelSleep() } }
    }
}

enum Style {
    static let accent = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(red:0.41,green:0.91,blue:0.8,alpha:1) : UIColor(red:0.02,green:0.47,blue:0.38,alpha:1) })
    static let background = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(red:0.043,green:0.063,blue:0.086,alpha:1) : .systemGroupedBackground })
    static let surface = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(red:0.063,green:0.094,blue:0.125,alpha:1) : .secondarySystemGroupedBackground })
    static let raised = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(red:0.082,green:0.122,blue:0.161,alpha:1) : .tertiarySystemGroupedBackground })
}
struct Panel<Content: View>: View {
    let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View { content.frame(maxWidth:.infinity,alignment:.leading).padding(20).background(Style.surface,in:RoundedRectangle(cornerRadius:20)).overlay(RoundedRectangle(cornerRadius:20).stroke(Color.primary.opacity(0.08))) }
}
struct Micro: View { let text: String; var body: some View { Text(text).font(.system(size:10,weight:.semibold,design:.monospaced)).tracking(1.5).foregroundStyle(.secondary) } }

struct RootView: View {
    @EnvironmentObject private var store: RemoteStore
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var selection = 0
    var body: some View {
        Group {
            if sizeClass == .regular {
                NavigationSplitView {
                    List {
                        Button { selection = 0 } label: { Label("Далечинско",systemImage:"appletvremote.gen4") }
                        Button { selection = 1 } label: { Label("Телевизори",systemImage:"tv") }
                        Button { selection = 2 } label: { Label("Поставки",systemImage:"slider.horizontal.3") }
                        Section("Твоите екрани") {
                            ForEach(store.sorted) { device in Button { store.connect(device); selection = 0 } label: { VStack(alignment:.leading,spacing:5) { Text(device.name); Text(device.room.isEmpty ? device.brand : device.room).font(.caption).foregroundStyle(.secondary) } }.buttonStyle(.plain) }
                        }
                    }.navigationTitle("дома.").scrollContentBackground(.hidden).background(Style.surface)
                } detail: { NavigationStack { page } }
            } else {
                TabView(selection:$selection) {
                    NavigationStack { RemoteView() }.tabItem { Label("Далечинско",systemImage:"appletvremote.gen4") }.tag(0)
                    NavigationStack { DevicesView() }.tabItem { Label("Телевизори",systemImage:"tv") }.tag(1)
                    NavigationStack { SettingsView() }.tabItem { Label("Поставки",systemImage:"slider.horizontal.3") }.tag(2)
                }
            }
        }.safeAreaInset(edge:.bottom,spacing:0) {
            if !store.message.isEmpty { Text(store.message).font(.caption).foregroundStyle(.secondary).padding(.horizontal,18).padding(.vertical,10).frame(maxWidth:.infinity).background(.ultraThinMaterial).accessibilityIdentifier("connectionMessage") }
        }
    }
    @ViewBuilder private var page: some View { switch selection { case 1: DevicesView(); case 2: SettingsView(); default: RemoteView() } }
}

struct RemoteView: View {
    @EnvironmentObject private var store: RemoteStore
    @State private var showPicker = false
    @State private var channel = ""
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:22) {
                VStack(alignment:.leading,spacing:10) { Micro(text:"YOUR SPACE. YOUR SIGNAL.").foregroundStyle(Style.accent); Text("Твојот дом.\nПод твоја контрола.").font(.system(size:32,weight:.medium)).tracking(-1); Text("Директно од твојот iPhone и iPad.").font(.subheadline).foregroundStyle(.secondary) }.padding(.top,8)
                Button { showPicker = true } label: { HStack { Image(systemName:"tv"); VStack(alignment:.leading,spacing:4) { Text(store.selected?.name ?? "Избери телевизор").fontWeight(.semibold); if let device = store.selected { Text([device.brand,device.room].filter { !$0.isEmpty }.joined(separator:" · ")).font(.caption).foregroundStyle(.secondary) } }; Spacer(); Image(systemName:"chevron.down") }.padding(16).background(Style.raised,in:RoundedRectangle(cornerRadius:12)) }.foregroundStyle(.primary)
                ViewThatFits(in:.horizontal) {
                    HStack(alignment:.top,spacing:20) { controls.frame(width:350); extras.frame(minWidth:290,maxWidth:.infinity) }
                    VStack(spacing:20) { controls; extras }
                }
            }.padding(18).frame(maxWidth:1100).frame(maxWidth:.infinity)
        }.background(Style.background).navigationTitle("дома.").navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented:$showPicker) {
            NavigationStack { List {
                ForEach(store.sorted) { device in Button { store.connect(device); showPicker = false } label: { VStack(alignment:.leading,spacing:6) { Text((device.favorite ? "★ " : "") + device.name).foregroundStyle(.primary); Text(device.room.isEmpty ? device.ip : device.room + " · " + device.ip).font(.caption).foregroundStyle(.secondary) } } }
                if store.devices.isEmpty { Text("Прво додај телевизор во Телевизори.").foregroundStyle(.secondary) }
            }.navigationTitle("Избери телевизор").toolbar { ToolbarItem(placement:.cancellationAction) { Button("Затвори") { showPicker = false } } } }.presentationDetents([.medium,.large])
        }
    }
    private var controls: some View {
        Panel {
            VStack(spacing:20) {
                HStack { Micro(text:"CONTROL / LIVE"); Spacer(); Text(store.status).font(.caption2).padding(.horizontal,9).padding(.vertical,6).background(store.connected ? Style.accent.opacity(0.15) : Style.raised,in:Capsule()).foregroundStyle(store.connected ? Style.accent : .secondary) }
                Image(systemName:"tv").font(.system(size:48,weight:.ultraLight)).foregroundStyle(Style.accent).padding(.top,8)
                VStack(spacing:7) { Text(store.selected?.name ?? "Твојот екран").font(.headline); if let device = store.selected { Text(device.ip).font(.system(.caption,design:.monospaced)).foregroundStyle(.secondary) }; if store.connecting { ProgressView() } }
                if !store.connected && !store.connecting, let device = store.selected { Button("Поврзи се") { store.connect(device) }.buttonStyle(.bordered) }
                if store.connected || store.connecting { Button("Прекини врска") { store.disconnect() }.font(.caption).foregroundStyle(.secondary) }
                HStack(spacing:12) { Button { store.wake() } label: { Label("Вклучи",systemImage:"power").frame(maxWidth:.infinity,minHeight:44) }.buttonStyle(.bordered).disabled(store.selected?.mac.isEmpty != false); command("Исклучи",symbol:"power",key:"powerOff",color:.red) }
                HStack { command("Почетна",symbol:"house",key:"home"); command("Извор",symbol:"rectangle.on.rectangle",key:"source",unsupported:store.selected?.brand == "LG"); command("Назад",symbol:"arrow.uturn.backward",key:"back") }
                ZStack {
                    Circle().fill(Style.raised).overlay(Circle().stroke(Style.accent.opacity(0.2)))
                    VStack(spacing:0) { arrow("chevron.up","up"); HStack(spacing:0) { arrow("chevron.left","left"); Button("OK") { send("ok") }.font(.headline).foregroundStyle(Style.background).frame(width:64,height:64).background(Style.accent,in:Circle()).disabled(!store.connected || store.busy); arrow("chevron.right","right") }; arrow("chevron.down","down") }
                }.frame(width:240,height:240).padding(.vertical,6)
                HStack(spacing:24) { rocker("VOL","volumeUp","volumeDown"); command("Без звук",symbol:"speaker.slash",key:"mute"); rocker("CH","channelUp","channelDown") }
                HStack(spacing:30) { command("Пушти",symbol:"play.fill",key:"play"); Micro(text:"MEDIA CONTROL"); command("Пауза",symbol:"pause.fill",key:"pause") }
                HStack { Circle().fill(Style.accent).frame(width:5,height:5); Micro(text:"DIRECT CONNECTION"); Spacer(); Text("дома.").fontWeight(.bold) }.padding(.top,5)
            }
        }
    }
    private var extras: some View {
        VStack(spacing:18) {
            Panel {
                Micro(text:"БРЗ ПРИСТАП / LG WEBOS")
                Text("Твоето следно гледање.").font(.title3).padding(.top,8)
                HStack { command("YouTube",symbol:"play.rectangle.fill",key:"youtube",color:.red,unsupported:store.selected?.brand != "LG"); command("Netflix",symbol:"film",key:"netflix",unsupported:store.selected?.brand != "LG") }.padding(.vertical,12)
                Text("За поврзан LG со инсталирани апликации.").font(.caption).foregroundStyle(.secondary)
            }
            Panel {
                Micro(text:"ВЛЕЗОВИ / LG WEBOS")
                LazyVGrid(columns:[GridItem(.flexible()),GridItem(.flexible())],spacing:10) { ForEach(1...4,id:\.self) { number in Button("HDMI \(number)") { send("hdmi\(number)") }.frame(maxWidth:.infinity,minHeight:44).buttonStyle(.bordered).disabled(!store.connected || store.selected?.brand != "LG" || store.busy) } }.padding(.top,14)
            }
            Panel {
                Micro(text:"ДИРЕКТЕН КАНАЛ")
                HStack {
                    TextField("Број на канал",text:$channel).keyboardType(.decimalPad).textFieldStyle(.roundedBorder)
                    Button("Префрли") { Task { await store.changeChannel(channel) } }.buttonStyle(.bordered).disabled(!store.connected || store.busy)
                }.padding(.top,12)
            }
            Panel {
                Micro(text:"SLEEP TIMER")
                Text("Уште една епизода.").font(.title3).padding(.top,8)
                HStack { ForEach([15,30,60,90],id:\.self) { minutes in Button("\(minutes)′") { store.scheduleSleep(minutes) }.frame(maxWidth:.infinity,minHeight:44).buttonStyle(.bordered).disabled(!store.connected) } }.padding(.vertical,12)
                if let end = store.sleepEnd { HStack { Text(end,style:.timer).monospacedDigit(); Spacer(); Button("Откажи") { store.cancelSleep() } }.foregroundStyle(Style.accent) }
                Text("Работи само додека апликацијата е активна. При одење во позадина се откажува.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
    private func send(_ key: String) { UIImpactFeedbackGenerator(style:.light).impactOccurred(); Task { await store.command(key) } }
    private func arrow(_ symbol: String,_ key: String) -> some View { Button { send(key) } label: { Image(systemName:symbol).font(.title3).frame(width:64,height:64) }.buttonStyle(.plain).foregroundStyle(.secondary).disabled(!store.connected || store.busy).accessibilityLabel(["up":"Горе","down":"Долу","left":"Лево","right":"Десно"][key]!) }
    private func command(_ title: String,symbol: String,key: String,color: Color = Style.accent,unsupported: Bool = false) -> some View { Button { send(key) } label: { VStack(spacing:7) { Image(systemName:symbol).font(.title3); Text(title).font(.caption2).lineLimit(1) }.frame(maxWidth:.infinity,minHeight:48) }.buttonStyle(.plain).foregroundStyle(color).disabled(!store.connected || store.busy || unsupported) }
    private func rocker(_ title: String,_ up: String,_ down: String) -> some View { VStack(spacing:3) { Button { send(up) } label: { Image(systemName:"plus").frame(width:54,height:44) }; Micro(text:title); Button { send(down) } label: { Image(systemName:"minus").frame(width:54,height:44) } }.buttonStyle(.plain).padding(5).background(Style.raised,in:Capsule()).disabled(!store.connected || store.busy) }
}

struct DevicesView: View {
    @EnvironmentObject private var store: RemoteStore
    @State private var editing: TVDevice?
    @State private var editor = false
    @State private var favorites = false
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:20) {
                Micro(text:"YOUR HOME / YOUR SCREENS"); Text("Секој екран.\nНа свое место.").font(.largeTitle).fontWeight(.medium).tracking(-1)
                HStack { Button { editing = nil; editor = true } label: { Label("Додај TV",systemImage:"plus") }.buttonStyle(.borderedProminent); Button { Task { await store.scan() } } label: { if store.scanning { ProgressView() } else { Label("Скенирај",systemImage:"antenna.radiowaves.left.and.right") } }.buttonStyle(.bordered).disabled(store.scanning) }
                Toggle("Само омилени",isOn:$favorites).font(.subheadline).tint(Style.accent)
                LazyVGrid(columns:[GridItem(.adaptive(minimum:280),spacing:16)],spacing:16) {
                    ForEach(store.sorted.filter { !favorites || $0.favorite }) { device in
                        Panel {
                            HStack(alignment:.top) { VStack(alignment:.leading,spacing:7) { Text(device.name).font(.headline); Text([device.brand,device.room].filter { !$0.isEmpty }.joined(separator:" · ")).font(.caption).foregroundStyle(.secondary) }; Spacer(); Button { store.favorite(device) } label: { Image(systemName:device.favorite ? "star.fill" : "star") }.buttonStyle(.plain).foregroundStyle(Style.accent).accessibilityLabel("Омилен телевизор") }
                            VStack(alignment:.leading,spacing:7) { Text("IP: " + device.ip); Text("MAC: " + (device.mac.isEmpty ? "Не е позната" : device.mac)) }.font(.system(.caption,design:.monospaced)).foregroundStyle(.secondary).padding(.vertical,15)
                            HStack { Button("Поврзи се") { store.connect(device) }.buttonStyle(.borderedProminent); Spacer(); Button("Измени") { editing = device; editor = true }.buttonStyle(.bordered) }
                        }
                    }
                }
                if store.devices.isEmpty { ContentUnavailableView { Label("Твојот прв телевизор",systemImage:"tv") } description: { Text("Додај IP-адреса од поставките на телевизорот. Не ти треба Mac.") } }
                Panel { Micro(text:"LOCAL DISCOVERY"); Text("Скенирањето на iOS може да бара multicast entitlement од Apple. Ако нема резултати, додај го телевизорот рачно. MAC-адресата за LG/Philips внеси ја од поставките на TV.").font(.caption).foregroundStyle(.secondary).padding(.top,8) }
            }.padding(18).frame(maxWidth:1100).frame(maxWidth:.infinity)
        }.background(Style.background).navigationTitle("Телевизори").navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented:$editor) { DeviceEditor(original:editing) }
    }
}

struct DeviceEditor: View {
    @EnvironmentObject private var store: RemoteStore
    @Environment(\.dismiss) private var dismiss
    let original: TVDevice?
    @State private var name = ""
    @State private var ip = ""
    @State private var brand = "LG"
    @State private var room = ""
    @State private var mac = ""
    @State private var favorite = false
    @State private var error = ""
    var body: some View {
        NavigationStack {
            Form {
                Section("Твојот телевизор") { TextField("Име",text:$name); Picker("Марка",selection:$brand) { ForEach(TVDevice.brands,id:\.self) { Text($0) } }; TextField("Соба",text:$room); Toggle("Омилен",isOn:$favorite) }
                Section { TextField("IP, пр. 192.168.1.50",text:$ip).keyboardType(.decimalPad).textInputAutocapitalization(.never).autocorrectionDisabled().disabled(original != nil); TextField("MAC: AA:BB:CC:DD:EE:FF",text:$mac).textInputAutocapitalization(.characters).autocorrectionDisabled() } header: { Text("Домашна мрежа") } footer: { Text("MAC-адресата е потребна за Wake-on-LAN. IP-адресата ја гледаш во мрежните поставки на телевизорот.") }
                if !error.isEmpty { Text(error).foregroundStyle(.red).font(.caption) }
            }.navigationTitle(original == nil ? "Додај телевизор" : "Измени телевизор").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement:.cancellationAction) { Button("Откажи") { dismiss() } }; ToolbarItem(placement:.confirmationAction) { Button("Зачувај") { save() }.fontWeight(.semibold) } }
                .onAppear { if let d = original { name = d.name; ip = d.ip; brand = d.brand; room = d.room; mac = d.mac; favorite = d.favorite } }
        }
    }
    private func save() {
        let device = TVDevice(name:name.trimmingCharacters(in:.whitespaces),ip:ip.trimmingCharacters(in:.whitespaces),brand:brand,model:original?.model ?? "",mac:mac.trimmingCharacters(in:.whitespaces),room:room,favorite:favorite)
        do { try store.save(device); dismiss() } catch { self.error = error.localizedDescription }
    }
}

struct SettingsView: View {
    @AppStorage("doma.native.light") private var light = false
    var body: some View {
        Form {
            Section("Изглед") { Toggle("Светла тема",isOn:$light) }
            Section("Самостојна апликација") { Label("Не бара вклучен Mac",systemImage:"iphone.and.arrow.forward"); Label("Спарувања во Keychain",systemImage:"key.fill"); Label("Без облак и аналитика",systemImage:"lock.shield"); Text("Зачуваните телевизори се локални на овој iPhone/iPad. Не се синхронизираат автоматски со Mac.").font(.caption).foregroundStyle(.secondary) }
            Section("Мрежа и компатибилност") { Text("iPhone/iPad и телевизорот треба да бидат на истата доверлива мрежа. Дозволи Local Network кога iOS ќе побара."); Text("LG webOS · Samsung Tizen · Philips JointSpace 1/5. Можностите зависат од моделот. Некои телевизори бараат нешифриран локален протокол."); Text("При самопотпишан TV сертификат ќе видиш адреса и SHA-256 отпечаток. По одобрување се зачувува во Keychain; промена бара ново одобрување.") }.font(.caption)
            Section("Брзи контроли") { Text("На Mac апликацијата има menu bar далечинско. iPhone/iPad немаат ист тип menu bar; Widget и Control Center контроли се планирани како посебна надградба.").font(.caption) }
            Section("Sleep timer") { Text("Тајмерот на iOS работи само додека апликацијата е активна. При одење во позадина се откажува. За гасење со заклучен телефон користи го вградениот тајмер на телевизорот.").font(.caption) }
            Section { Text("ДОМА / HOME CONTROL · 0.3").font(.system(.caption,design:.monospaced)).foregroundStyle(.secondary) }
        }.navigationTitle("Поставки")
    }
}
