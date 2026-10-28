import Foundation

@main struct ModelsCheck {
    static func main() throws {
        for ip in ["10.0.0.3","192.168.1.5","172.16.0.1","172.31.255.254","169.254.1.3"] { precondition(TVDevice.isLocal(ip),ip) }
        for ip in ["127.0.0.1","8.8.8.8","192.168.1.5.evil.com","::1","172.32.1.3","010.0.0.1","192.168.001.1","localhost"] { precondition(!TVDevice.isLocal(ip),ip) }
        precondition(TVDevice.normalizedMAC("ab-cd-ef-12-34-56") == "AB:CD:EF:12:34:56")
        precondition(TVDevice.normalizedMAC("not-a-mac") == nil)
        let device = TVDevice(name:"Дневна",ip:"192.168.1.50",brand:"LG",mac:"AA:BB:CC:DD:EE:FF",room:"Дневна",favorite:true)
        try device.validate()
        let data = try JSONEncoder().encode(device)
        let decoded = try JSONDecoder().decode(TVDevice.self,from:data)
        precondition(decoded == device)
        var bad = device; bad.ip = "8.8.8.8"
        do { try bad.validate(); fatalError("Public destination accepted") } catch {}
        print("Native model checks passed: private addresses, canonical IPv4, MAC normalization, validation and persistence.")
    }
}
