import Foundation
import Security
import Darwin

struct TVDevice: Identifiable, Codable, Hashable {
    var id: String { ip }
    var name: String
    var ip: String
    var brand: String
    var model = ""
    var mac = ""
    var room = ""
    var favorite = false
    static let brands = ["LG", "Samsung", "Philips"]
    static func isLocal(_ ip: String) -> Bool {
        let parts = ip.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4, parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isNumber) && Int($0).map { (0...255).contains($0) } == true }) else { return false }
        guard parts.allSatisfy({ part in guard let number = Int(part) else { return false }; return String(number) == String(part) }) else { return false }
        var address = in_addr(); guard inet_pton(AF_INET, ip, &address) == 1 else { return false }
        let a = Int(parts[0])!, b = Int(parts[1])!
        return a == 10 || a == 192 && b == 168 || a == 172 && (16...31).contains(b) || a == 169 && b == 254
    }
    static func normalizedMAC(_ value: String) -> String? {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "-", with: ":").uppercased()
        guard value.range(of: "^([A-F0-9]{2}:){5}[A-F0-9]{2}$", options: .regularExpression) != nil else { return nil }
        return value
    }
    func validate() throws {
        guard Self.isLocal(ip) else { throw TVError("Внеси приватна IPv4-адреса, пример 192.168.1.50.") }
        guard Self.brands.contains(brand) else { throw TVError("Избери поддржана марка.") }
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty && name.count <= 80 else { throw TVError("Внеси име до 80 знаци.") }
        guard room.count <= 40 else { throw TVError("Името на собата може да има до 40 знаци.") }
        guard mac.isEmpty || Self.normalizedMAC(mac) != nil else { throw TVError("Провери ја MAC-адресата.") }
    }
}

struct TVError: LocalizedError { let text: String; init(_ text: String) { self.text = text }; var errorDescription: String? { text } }

enum TVKeychain {
    static func read(_ account: String) -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "mk.doma.tv", kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func write(_ value: String, account: String) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "mk.doma.tv", kSecAttrAccount as String: account]
        let attributes: [String: Any] = [kSecValueData as String: Data(value.utf8), kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = query; for (key, value) in attributes { item[key] = value }
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw TVError("Не може да се зачува спарувањето во Keychain.") }; return
        }
        guard status == errSecSuccess else { throw TVError("Не може да се ажурира Keychain.") }
    }
}

enum TVNetwork {
    static func requireMulticastCapability() throws {
        #if !targetEnvironment(simulator)
        guard Bundle.main.object(forInfoDictionaryKey: "DomaMulticastEnabled") as? Bool == true else {
            throw TVError("SSDP и Wake-on-LAN бараат Apple multicast/broadcast дозвола во потписот. Користи рачно додавање со IP за поврзување.")
        }
        #endif
    }
    static func wake(mac: String) throws {
        try requireMulticastCapability()
        guard let normalized = TVDevice.normalizedMAC(mac) else { throw TVError("Внеси MAC-адреса преку Измени телевизор.") }
        let bytes = normalized.split(separator: ":").compactMap { UInt8($0, radix: 16) }
        let packet = Data(Array(repeating: UInt8(255), count: 6) + Array(repeating: bytes, count: 16).flatMap { $0 })
        let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        guard fd >= 0 else { throw TVError("Не може да се отвори локалната мрежа.") }
        defer { close(fd) }
        var flag: Int32 = 1
        guard setsockopt(fd, SOL_SOCKET, SO_BROADCAST, &flag, socklen_t(MemoryLayout.size(ofValue: flag))) == 0 else { throw TVError("Не е дозволен сигнал за будење.") }
        var destination = sockaddr_in(); destination.sin_len = UInt8(MemoryLayout<sockaddr_in>.size); destination.sin_family = sa_family_t(AF_INET); destination.sin_port = UInt16(9).bigEndian; destination.sin_addr.s_addr = INADDR_BROADCAST
        let result = packet.withUnsafeBytes { data in withUnsafePointer(to: &destination) { pointer in pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sendto(fd, data.baseAddress, data.count, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } } }
        guard result == packet.count else { throw TVError("Мрежата го одби сигналот. Провери Local Network и multicast/broadcast дозволите.") }
    }
    static func discover() async throws -> [URL] {
        try requireMulticastCapability()
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
                guard fd >= 0 else { continuation.resume(throwing: TVError("Мрежата не е достапна.")); return }
                defer { close(fd) }
                var timeout = timeval(tv_sec: 0, tv_usec: 250000)
                setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
                var local = sockaddr_in(); local.sin_len = UInt8(MemoryLayout<sockaddr_in>.size); local.sin_family = sa_family_t(AF_INET)
                let bound = withUnsafePointer(to: &local) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
                guard bound == 0 else { continuation.resume(throwing: TVError("Не може да се отвори локалната мрежа.")); return }
                var group = sockaddr_in(); group.sin_len = UInt8(MemoryLayout<sockaddr_in>.size); group.sin_family = sa_family_t(AF_INET); group.sin_port = UInt16(1900).bigEndian
                inet_pton(AF_INET, "239.255.255.250", &group.sin_addr)
                let message = Data("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n".utf8)
                let sent = message.withUnsafeBytes { data in withUnsafePointer(to: &group) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { sendto(fd, data.baseAddress, data.count, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } } }
                guard sent >= 0 else { continuation.resume(throwing: TVError("SSDP не е дозволен. Дозволи Local Network. На iOS може да е потребен multicast entitlement; рачното додавање со IP останува достапно.")); return }
                let deadline = Date().addingTimeInterval(4)
                var locations = Set<URL>(); var buffer = [UInt8](repeating: 0, count: 8192)
                while Date() < deadline {
                    let count = recv(fd, &buffer, buffer.count, 0)
                    guard count > 0, let text = String(bytes: buffer.prefix(count), encoding: .utf8) else { continue }
                    for line in text.components(separatedBy: "\r\n") where line.lowercased().hasPrefix("location:") {
                        if let url = URL(string: String(line.dropFirst(9)).trimmingCharacters(in: .whitespaces)), url.scheme == "http", let host = url.host, TVDevice.isLocal(host) { locations.insert(url) }
                    }
                }
                continuation.resume(returning: Array(locations))
            }
        }
    }
}
