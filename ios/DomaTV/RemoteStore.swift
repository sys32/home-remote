import Foundation
import SwiftUI
import Security
import CryptoKit

struct TVTrustPrompt: Identifiable {
    let id = UUID()
    let host: String
    let fingerprint: String
    let changed: Bool
    let answer: (Bool) -> Void
}

final class TVTrustDelegate: NSObject, URLSessionDelegate, URLSessionTaskDelegate {
    let host: String
    weak var store: RemoteStore?
    init(host: String, store: RemoteStore) { self.host = host; self.store = store }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              challenge.protectionSpace.host == host, TVDevice.isLocal(host), let trust = challenge.protectionSpace.serverTrust,
              let certificates = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let certificate = certificates.first else { completionHandler(.performDefaultHandling, nil); return }
        let fingerprint = SHA256.hash(data: SecCertificateCopyData(certificate) as Data).map { String(format: "%02X", $0) }.joined(separator: ":")
        let saved = TVKeychain.read("certificate." + host)
        if saved == fingerprint { completionHandler(.useCredential, URLCredential(trust: trust)); return }
        if saved == nil && SecTrustEvaluateWithError(trust, nil) { completionHandler(.performDefaultHandling, nil); return }
        Task { @MainActor [weak store] in
            guard let store else { completionHandler(.cancelAuthenticationChallenge, nil); return }
            store.trustPrompt = TVTrustPrompt(host: self.host, fingerprint: fingerprint, changed: saved != nil) { accepted in
                if accepted {
                    do { try TVKeychain.write(fingerprint, account: "certificate." + self.host); completionHandler(.useCredential, URLCredential(trust: trust)) }
                    catch { store.trustDenied = true; store.message = error.localizedDescription; completionHandler(.cancelAuthenticationChallenge, nil) }
                } else { store.trustDenied = true; store.message = "Сертификатот не е одобрен. Врската е откажана."; completionHandler(.cancelAuthenticationChallenge, nil) }
                store.trustPrompt = nil
            }
        }
    }
}

@MainActor
final class RemoteStore: ObservableObject {
    @Published var devices: [TVDevice] = []
    @Published var selected: TVDevice?
    @Published var status = "Неповрзан"
    @Published var connected = false
    @Published var connecting = false
    @Published var scanning = false
    @Published var busy = false
    @Published var message = "Додај телевизор или скенирај ја домашната мрежа."
    @Published var trustPrompt: TVTrustPrompt?
    @Published var sleepEnd: Date?
    var trustDenied = false
    private var socket: URLSessionWebSocketTask?
    private var pointer: URLSessionWebSocketTask?
    private var session: URLSession?
    private var reader: Task<Void, Never>?
    private var pairingTimeout: Task<Void, Never>?
    private var sleepTask: Task<Void, Never>?
    private var generation = UUID()
    private var sequence = 0
    private var pending: [String: CheckedContinuation<[String: Any], Error>] = [:]
    private var philipsVersion = 1
    private let preferencesKey = "doma.native.devices.v1"

    init() {
        if let data = UserDefaults.standard.data(forKey: preferencesKey), let list = try? JSONDecoder().decode([TVDevice].self, from: data) { devices = list }
        if let ip = UserDefaults.standard.string(forKey: "doma.native.selected") { selected = devices.first { $0.ip == ip } }
    }
    var sorted: [TVDevice] { devices.sorted { if $0.favorite != $1.favorite { return $0.favorite }; return ($0.room, $0.name) < ($1.room, $1.name) } }
    func save(_ input: TVDevice) throws {
        try input.validate()
        var device = input
        if !device.mac.isEmpty { device.mac = TVDevice.normalizedMAC(device.mac)! }
        if let index = devices.firstIndex(where: { $0.ip == device.ip }) { devices[index] = device } else { devices.append(device) }
        if selected?.ip == device.ip { if selected?.brand != device.brand { disconnect() }; selected = device }
        if let data = try? JSONEncoder().encode(devices) { UserDefaults.standard.set(data, forKey: preferencesKey) }
    }
    func favorite(_ device: TVDevice) { var device = device; device.favorite.toggle(); try? save(device) }
    func disconnect() {
        cancelSleep(silent: true)
        generation = UUID(); reader?.cancel(); pairingTimeout?.cancel()
        if let prompt = trustPrompt { prompt.answer(false) }
        socket?.cancel(with: .goingAway, reason: nil); pointer?.cancel(with: .goingAway, reason: nil)
        session?.invalidateAndCancel(); socket = nil; pointer = nil; session = nil
        for (_, continuation) in pending { continuation.resume(throwing: TVError("Врската е затворена.")) }; pending.removeAll()
        connected = false; connecting = false; busy = false; status = "Неповрзан"
    }
    func connect(_ device: TVDevice) {
        disconnect()
        do { try device.validate() } catch { message = error.localizedDescription; return }
        selected = device; UserDefaults.standard.set(device.ip, forKey: "doma.native.selected")
        connecting = true; status = "Поврзување…"; message = "Провери го екранот на телевизорот за одобрување."; trustDenied = false
        let current = generation
        pairingTimeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(60))
            guard !Task.isCancelled, let self, self.generation == current, !self.connected else { return }
            self.disconnect(); self.message = "Поврзувањето истече. Вклучи го TV и одобри го пристапот на екранот."
        }
        reader = Task { [weak self] in
            guard let self else { return }
            if device.brand == "Philips" {
                for version in [1, 5] {
                    do { _ = try await self.http("http://\(device.ip):1925/\(version)/system"); guard self.generation == current else { return }; self.philipsVersion = version; self.connected = true; self.connecting = false; self.status = "Поврзан"; self.message = "Поврзан преку JointSpace."; self.pairingTimeout?.cancel(); try self.save(device); return } catch { if Task.isCancelled { return } }
                }
                guard self.generation == current else { return }; self.disconnect(); self.message = "Овој Philips не нуди JointSpace 1/5. Поновите Philips/Android TV протоколи сè уште не се поддржани."; return
            }
            let config = URLSessionConfiguration.ephemeral; config.timeoutIntervalForRequest = 12; config.timeoutIntervalForResource = 75
            let delegate = TVTrustDelegate(host: device.ip, store: self)
            self.session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
            let schemes = device.brand == "LG" ? [("wss",3001),("ws",3000)] : [("wss",8002),("ws",8001)]
            for (scheme, port) in schemes {
                guard self.generation == current, !Task.isCancelled else { return }
                if scheme == "ws" { self.message = "Се пробува нешифрирана врска на доверливата домашна мрежа." }
                var components = URLComponents(); components.scheme = scheme; components.host = device.ip; components.port = port
                components.path = device.brand == "LG" ? "/" : "/api/v2/channels/samsung.remote.control"
                if device.brand == "Samsung" { components.queryItems = [URLQueryItem(name: "name", value: Data("Doma TV iOS".utf8).base64EncodedString())]; if let token = TVKeychain.read("samsung." + device.ip) { components.queryItems?.append(URLQueryItem(name: "token", value: token)) } }
                guard let url = components.url else { continue }
                let websocket = self.session!.webSocketTask(with: url); self.socket = websocket; websocket.resume()
                do {
                    if device.brand == "LG" {
                        var payload: [String: Any] = ["forcePairing": false, "pairingType": "PROMPT", "manifest": ["manifestVersion": 1, "appVersion": "0.3", "permissions": ["LAUNCH","CONTROL_AUDIO","CONTROL_POWER","CONTROL_INPUT_TV","CONTROL_INPUT_MEDIA_PLAYBACK","CONTROL_MOUSE_AND_KEYBOARD","READ_INPUT_DEVICE_LIST"]]]
                        if let key = TVKeychain.read("lg." + device.ip) { payload["client-key"] = key }
                        try await self.send(["id":"register", "type":"register", "payload":payload], socket: websocket)
                    }
                    while self.generation == current, !Task.isCancelled {
                        let received = try await websocket.receive()
                        guard self.generation == current else { return }
                        let data: Data
                        switch received { case .data(let value): data = value; case .string(let value): data = Data(value.utf8); @unknown default: continue }
                        if let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] { try self.received(object, device: device) }
                    }
                    return
                } catch {
                    websocket.cancel(with: .goingAway, reason: nil)
                    guard self.generation == current, !Task.isCancelled else { return }
                    if self.connected || self.trustDenied { let reason = self.trustDenied ? self.message : "Врската е прекината. Поврзи го телевизорот повторно."; self.disconnect(); self.message = reason; return }
                }
            }
            guard self.generation == current else { return }; self.disconnect(); self.message = "Телевизорот не одговори. Провери IP, Wi-Fi и дозволата за мрежно управување."
        }
    }
    private func received(_ object: [String: Any], device: TVDevice) throws {
        let type = object["type"] as? String, event = object["event"] as? String
        if type == "registered" || event == "ms.channel.connect" {
            if let payload = object["payload"] as? [String: Any], let key = payload["client-key"] as? String { try TVKeychain.write(key, account: "lg." + device.ip) }
            if let data = object["data"] as? [String: Any], let token = data["token"] as? String { try TVKeychain.write(token, account: "samsung." + device.ip) }
            try save(selected ?? device); connected = true; connecting = false; status = "Поврзан"; message = "Далечинското е подготвено."; pairingTimeout?.cancel(); return
        }
        if event == "ms.channel.unauthorized" || event == "ms.channel.timeOut" { trustDenied = true; message = "Телевизорот не го одобри пристапот."; throw TVError(message) }
        if let id = object["id"] as? String, let continuation = pending.removeValue(forKey: id) {
            if type == "error" { continuation.resume(throwing: TVError(object["error"] as? String ?? "Телевизорот ја одби командата.")) }
            else { continuation.resume(returning: object["payload"] as? [String: Any] ?? [:]) }; return
        }
        if type == "error" { message = object["error"] as? String ?? "Телевизорот ја одби командата." }
    }
    private func send(_ object: [String: Any], socket: URLSessionWebSocketTask) async throws {
        let data = try JSONSerialization.data(withJSONObject: object)
        try await socket.send(.string(String(decoding: data, as: UTF8.self)))
    }
    private func lg(_ uri: String, payload: [String: Any] = [:]) async throws -> [String: Any] {
        guard let socket, connected else { throw TVError("Нема активна врска.") }
        sequence += 1; let id = "request-\(sequence)"
        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            Task { [weak self] in
                do { try await self?.send(["id":id,"type":"request","uri":"ssap://" + uri,"payload":payload], socket: socket) }
                catch { self?.pending.removeValue(forKey: id)?.resume(throwing: error) }
            }
            Task { [weak self] in try? await Task.sleep(for: .seconds(6)); self?.pending.removeValue(forKey: id)?.resume(throwing: TVError("Нема потврда од телевизорот.")) }
        }
    }
    func command(_ name: String) async {
        guard connected, !busy else { return }; busy = true; defer { busy = false }
        do { try await execute(name); message = "Командата е испратена." } catch { message = error.localizedDescription }
    }
    private func execute(_ name: String) async throws {
        guard let device = selected, connected else { throw TVError("Прво поврзи го телевизорот.") }
        if device.brand == "Philips" { try await philipsCommand(name); return }
        guard let socket else { throw TVError("Прво поврзи го телевизорот.") }
        let samsung = ["up":"KEY_UP","down":"KEY_DOWN","left":"KEY_LEFT","right":"KEY_RIGHT","ok":"KEY_ENTER","back":"KEY_RETURN","home":"KEY_HOME","source":"KEY_SOURCE","volumeUp":"KEY_VOLUP","volumeDown":"KEY_VOLDOWN","mute":"KEY_MUTE","channelUp":"KEY_CHUP","channelDown":"KEY_CHDOWN","powerOff":"KEY_POWEROFF","play":"KEY_PLAY","pause":"KEY_PAUSE"]
        if device.brand == "Samsung" { guard let key = samsung[name] else { throw TVError("Непозната команда.") }; try await send(["method":"ms.remote.control","params":["Cmd":"Click","DataOfCmd":key,"Option":"false","TypeOfRemote":"SendRemoteKey"]], socket: socket); return }
        let nav = ["up":"UP","down":"DOWN","left":"LEFT","right":"RIGHT","ok":"ENTER","back":"BACK","home":"HOME"]
        if let key = nav[name] {
            if pointer == nil {
                let payload = try await lg("com.webos.service.networkinput/getPointerInputSocket")
                guard let address = payload["socketPath"] as? String, let url = URL(string: address), url.host == device.ip, ["ws","wss"].contains(url.scheme ?? "") else { throw TVError("Невалидна адреса од телевизорот.") }
                pointer = session?.webSocketTask(with: url); pointer?.resume()
            }
            try await pointer?.send(.string("type:button\nname:\(key)\n\n")); return
        }
        if name.hasPrefix("hdmi"), let input = Int(name.dropFirst(4)), (1...4).contains(input) { _ = try await lg("system.launcher/launch", payload:["id":"com.webos.app.hdmi\(input)"]); return }
        if ["youtube","netflix"].contains(name) { _ = try await lg("system.launcher/launch", payload:["id":name == "youtube" ? "youtube.leanback.v4" : "netflix"]); return }
        if name == "mute" { let volume = try await lg("audio/getVolume"); let muted = volume["muted"] as? Bool ?? (volume["volumeStatus"] as? [String: Any])?["muteStatus"] as? Bool ?? false; _ = try await lg("audio/setMute", payload:["mute":!muted]); return }
        let uris = ["volumeUp":"audio/volumeUp","volumeDown":"audio/volumeDown","channelUp":"tv/channelUp","channelDown":"tv/channelDown","powerOff":"system/turnOff","play":"media.controls/play","pause":"media.controls/pause"]
        guard let uri = uris[name] else { throw TVError("За LG користи ги HDMI копчињата.") }; _ = try await lg(uri)
    }
    private func philipsCommand(_ command: String) async throws {
        let keys = ["up":"CursorUp","down":"CursorDown","left":"CursorLeft","right":"CursorRight","ok":"Confirm","back":"Back","home":"Home","source":"Source","volumeUp":"VolumeUp","volumeDown":"VolumeDown","mute":"Mute","channelUp":"ChannelStepUp","channelDown":"ChannelStepDown","powerOff":"Standby","play":"PlayPause","pause":"Pause"]
        guard let ip = selected?.ip, let key = keys[command] else { throw TVError("Неподдржана команда.") }
        _ = try await http("http://\(ip):1925/\(philipsVersion)/input/key", payload:["key":key])
    }
    func changeChannel(_ number: String) async {
        guard connected, !busy, let device = selected else { return }; busy = true; defer { busy = false }
        do {
            guard number.range(of:"^[0-9]{1,4}([.-][0-9]{1,3})?$",options:.regularExpression) != nil else { throw TVError("Внеси број на канал.") }
            if device.brand == "LG" { _ = try await lg("tv/openChannel",payload:["channelNumber":number]) }
            else {
                guard number.range(of:"^[0-9]{1,4}$",options:.regularExpression) != nil else { throw TVError("За оваа марка внеси цел број.") }
                for digit in number {
                    if device.brand == "Samsung", let socket { try await send(["method":"ms.remote.control","params":["Cmd":"Click","DataOfCmd":"KEY_"+String(digit),"Option":"false","TypeOfRemote":"SendRemoteKey"]],socket:socket) }
                    else { _ = try await http("http://\(device.ip):1925/\(philipsVersion)/input/key",payload:["key":"Digit"+String(digit)]) }
                    try await Task.sleep(for:.milliseconds(150))
                }
            }
            message = "Испратен е бројот на каналот."
        } catch { message = error.localizedDescription }
    }
    func wake() {
        guard let device = selected else { return }
        do { try TVNetwork.wake(mac: device.mac); message = "Испратен е сигнал за будење. Палењето зависи од поставките на TV." } catch { message = error.localizedDescription }
    }
    func scheduleSleep(_ minutes: Int) {
        guard connected, let device = selected else { return }; cancelSleep(silent: true)
        let current = generation; sleepEnd = Date().addingTimeInterval(Double(minutes) * 60)
        message = "Гасење за \(minutes) минути, само додека апликацијата е активна."
        sleepTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Double(minutes) * 60))
            guard !Task.isCancelled, let self, self.generation == current, self.selected?.ip == device.ip, self.connected else { return }
            self.sleepEnd = nil
            do { try await self.execute("powerOff"); self.message = "Испратена е команда за гасење." } catch { self.message = error.localizedDescription }
        }
    }
    func cancelSleep(silent: Bool = false) { let hadTimer = sleepEnd != nil; sleepTask?.cancel(); sleepTask = nil; sleepEnd = nil; if hadTimer && !silent { message = "Тајмерот е откажан. На iOS не се гарантира работа во позадина." } }
    func scan() async {
        guard !scanning else { return }; scanning = true; defer { scanning = false }
        do {
            let locations = try await TVNetwork.discover(); var count = 0
            for location in locations.prefix(40) {
                guard let ip = location.host else { continue }
                do {
                    let data = try await http(location.absoluteString)
                    let xml = String(decoding: data, as: UTF8.self)
                    func field(_ name: String) -> String { guard let range = xml.range(of:"<\(name)[^>]*>([\\s\\S]*?)</\(name)>",options:.regularExpression), let content = xml[range].range(of:">") else { return "" }; return String(xml[content.upperBound..<range.upperBound].components(separatedBy:"</")[0]).replacingOccurrences(of:"&amp;",with:"&") }
                    let all = (field("manufacturer") + " " + field("modelName") + " " + field("friendlyName")).lowercased()
                    let brand = all.contains("samsung") ? "Samsung" : all.contains("webos") || all.contains("lg electronics") || all.contains("lge") ? "LG" : all.contains("philips") || all.contains("tp vision") ? "Philips" : ""
                    guard !brand.isEmpty else { continue }
                    let existing = devices.first { $0.ip == ip }
                    var device = existing ?? TVDevice(name:field("friendlyName").isEmpty ? brand + " TV" : field("friendlyName"),ip:ip,brand:brand)
                    device.model = field("modelName")
                    if brand == "Samsung", let data = try? await http("http://\(ip):8001/api/v2/"), let json = try? JSONSerialization.jsonObject(with:data) as? [String:Any], let info = json["device"] as? [String:Any], let mac = info["wifiMac"] as? String, let valid = TVDevice.normalizedMAC(mac) { device.mac = valid }
                    try save(device); count += 1
                } catch { continue }
            }
            message = count > 0 ? "Пронајдени телевизори: \(count). Зачувани се на овој уред." : "Нема нови резултати. Додај со IP; SSDP може да бара Apple multicast дозвола."
        } catch { message = error.localizedDescription }
    }
    private func http(_ address: String, payload: [String: Any]? = nil) async throws -> Data {
        guard let url = URL(string:address), let host = url.host, TVDevice.isLocal(host), url.scheme == "http" else { throw TVError("Дозволени се само локални TV адреси.") }
        var request = URLRequest(url:url); request.timeoutInterval = 3
        if let payload { request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField:"Content-Type"); request.httpBody = try JSONSerialization.data(withJSONObject:payload) }
        let config = URLSessionConfiguration.ephemeral
        let client = URLSession(configuration:config,delegate:NoRedirect(),delegateQueue:nil); defer { client.finishTasksAndInvalidate() }
        let (data,response) = try await client.data(for:request)
        guard let response = response as? HTTPURLResponse, (200...299).contains(response.statusCode), data.count <= 1_048_576 else { throw TVError("Телевизорот го одби барањето.") }; return data
    }
}

final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
