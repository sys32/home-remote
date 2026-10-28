import AppKit

let destination = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
for (name, size) in [("icon_16x16",16),("icon_16x16@2x",32),("icon_32x32",32),("icon_32x32@2x",64),("icon_128x128",128),("icon_128x128@2x",256),("icon_256x256",256),("icon_256x256@2x",512),("icon_512x512",512),("icon_512x512@2x",1024)] {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    let scale = CGFloat(size) / 1024
    let transform = AffineTransform(scaleByX: scale, byY: scale)
    (transform as NSAffineTransform).concat()
    NSColor(calibratedRed: 0.19, green: 0.32, blue: 0.24, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 40, y: 40, width: 944, height: 944), xRadius: 210, yRadius: 210).fill()
    NSColor(calibratedRed: 0.94, green: 0.96, blue: 0.88, alpha: 1).setStroke()
    let screen = NSBezierPath(roundedRect: NSRect(x: 215, y: 328, width: 594, height: 406), xRadius: 55, yRadius: 55)
    screen.lineWidth = 38
    screen.stroke()
    let stand = NSBezierPath()
    stand.move(to: NSPoint(x: 512,y: 328));stand.line(to: NSPoint(x: 512,y: 240))
    stand.move(to: NSPoint(x: 410,y: 240));stand.line(to: NSPoint(x: 614,y: 240))
    stand.lineWidth = 38;stand.lineCapStyle = .round;stand.stroke()
    let power = NSBezierPath()
    power.appendArc(withCenter: NSPoint(x: 512,y: 530), radius: 100, startAngle: 135, endAngle: 405)
    power.lineWidth = 30;power.lineCapStyle = .round;power.stroke()
    let stem = NSBezierPath();stem.move(to: NSPoint(x:512,y:550));stem.line(to: NSPoint(x:512,y:650));stem.lineWidth = 30;stem.lineCapStyle = .round;stem.stroke()
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: destination.appendingPathComponent(name + ".png"))
}
