import AppKit
import WebKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var status: NSTextField!
    private var process: Process?
    private var logHandle: FileHandle?
    private var stopping = false
    private let address = URL(string: "http://127.0.0.1:43821/")!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let application = NSMenuItem()
        let submenu = NSMenu()
        submenu.addItem(withTitle: "За Дома TV", action: #selector(about), keyEquivalent: "")
        submenu.addItem(.separator())
        submenu.addItem(withTitle: "Освежи", action: #selector(reload), keyEquivalent: "r")
        submenu.addItem(.separator())
        submenu.addItem(withTitle: "Затвори Дома TV", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        application.submenu = submenu
        menu.addItem(application)
        let edit = NSMenuItem(title: "Уреди", action: nil, keyEquivalent: "")
        let edits = NSMenu(title: "Уреди")
        edits.addItem(withTitle: "Исечи", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edits.addItem(withTitle: "Копирај", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edits.addItem(withTitle: "Залепи", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edits.addItem(withTitle: "Избери сè", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        edit.submenu = edits
        menu.addItem(edit)
        NSApp.mainMenu = menu

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 850),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Дома TV"
        window.minSize = NSSize(width: 800, height: 650)
        window.center()
        window.setFrameAutosaveName("DomaTVWindow")
        window.isReleasedWhenClosed = false
        let configuration = WKWebViewConfiguration()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        window.contentView = webView

        status = NSTextField(wrappingLabelWithString: "Се стартува Дома TV…")
        status.alignment = .center
        status.font = .systemFont(ofSize: 18)
        status.translatesAutoresizingMaskIntoConstraints = false
        webView.addSubview(status)
        NSLayoutConstraint.activate([
            status.centerXAnchor.constraint(equalTo: webView.centerXAnchor),
            status.centerYAnchor.constraint(equalTo: webView.centerYAnchor),
            status.widthAnchor.constraint(lessThanOrEqualToConstant: 560)
        ])
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        Task { await start() }
    }

    private func serviceResponds() async -> Bool {
        var request = URLRequest(url: address, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 0.7)
        request.httpMethod = "GET"
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let html = String(data: data, encoding: .utf8) else { return false }
        return html.contains("<title>Дома · TV Remote</title>") && html.contains("name=\"session-key\"")
    }

    private func start() async {
        if await serviceResponds() { showRemote(); return }
        guard let resources = Bundle.main.resourceURL else { fail("Недостасуваат датотеките на апликацијата."); return }
        let server = resources.appendingPathComponent("TVRemote/server.mjs")
        let node = resources.appendingPathComponent("runtime/node")
        guard FileManager.default.isExecutableFile(atPath: node.path),
              FileManager.default.fileExists(atPath: server.path) else {
            fail("Апликацијата не е целосна. Отвори ја целата Дома TV.app папка.")
            return
        }
        let child = Process()
        child.executableURL = node
        child.arguments = [server.path]
        child.currentDirectoryURL = server.deletingLastPathComponent()
        var environment = ProcessInfo.processInfo.environment
        environment["TV_REMOTE_PORT"] = "43821"
        environment.removeValue(forKey: "TV_REMOTE_STORE_DIR")
        environment.removeValue(forKey: "NODE_OPTIONS")
        environment.removeValue(forKey: "NODE_PATH")
        child.environment = environment
        let log = FileManager.default.temporaryDirectory.appendingPathComponent("DomaTV.log")
        FileManager.default.createFile(atPath: log.path, contents: nil, attributes: [.posixPermissions: 0o600])
        logHandle = try? FileHandle(forWritingTo: log)
        child.standardOutput = logHandle ?? FileHandle.nullDevice
        child.standardError = logHandle ?? FileHandle.nullDevice
        do {
            try child.run()
            process = child
        } catch {
            fail("Сервисот не може да се стартува: \(error.localizedDescription)")
            return
        }
        for _ in 0..<40 {
            if stopping { return }
            if await serviceResponds() { showRemote(); return }
            try? await Task.sleep(for: .milliseconds(250))
        }
        fail("Локалниот сервис не одговори. Затвори ја апликацијата и отвори ја повторно. Ако друга програма го користи портот 43821, прво затвори ја.")
    }

    private func showRemote() {
        webView.load(URLRequest(url: address))
    }

    private func fail(_ message: String) {
        status.isHidden = false
        status.stringValue = message
    }

    @objc private func reload() {
        status.isHidden = false
        status.stringValue = "Се отвора далечинското…"
        Task {
            if await serviceResponds() { showRemote() }
            else { fail("Сервисот не работи. Затвори ја апликацијата и отвори ја повторно.") }
        }
    }

    @objc private func about() {
        NSApp.orderFrontStandardAboutPanel(options: [
            .applicationName: "Дома TV", .applicationVersion: "0.2.0",
            .credits: NSAttributedString(string: "Далечинско за твојот дом. Локално на твојот Mac.")
        ])
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { status.isHidden = true }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail("Не може да се отвори далечинското. Затвори ја апликацијата и отвори ја повторно.")
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        decisionHandler(url.scheme == "http" && url.host == "127.0.0.1" && url.port == 43821 ? .allow : .cancel)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        return true
    }
    func applicationWillTerminate(_ notification: Notification) {
        stopping = true
        if let process, process.isRunning { process.terminate() }
        try? logHandle?.close()
    }
}

@main
struct DomaTV {
    @MainActor
    static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) { application.run() }
    }
}
