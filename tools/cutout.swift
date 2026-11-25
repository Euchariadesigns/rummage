// Cuts the main subject out of photos using macOS's built-in subject lifting (Vision).
// Usage: swift tools/cutout.swift <input-image> <output.png> [<input> <output> ...]
//        swift tools/cutout.swift --split <input-image> <output-prefix>
// Writes a transparent PNG cropped to the subject. With --split, every separate thing
// in the photo becomes its own PNG: <prefix>-1.png, <prefix>-2.png, …
import Foundation
import Vision
import CoreImage
import ImageIO
import UniformTypeIdentifiers

let ctx = CIContext()

func analyse(_ inPath: String) throws -> (VNImageRequestHandler, VNInstanceMaskObservation, Int) {
    let url = URL(fileURLWithPath: inPath)
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
          let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
        throw NSError(domain: "cutout", code: 1, userInfo: [NSLocalizedDescriptionKey: "Can't read \(inPath)"])
    }
    let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any]
    let orientation = (props?[kCGImagePropertyOrientation] as? UInt32).flatMap(CGImagePropertyOrientation.init) ?? .up

    let handler = VNImageRequestHandler(cgImage: cg, orientation: orientation)
    let request = VNGenerateForegroundInstanceMaskRequest()
    try handler.perform([request])
    guard let result = request.results?.first, !result.allInstances.isEmpty else {
        throw NSError(domain: "cutout", code: 2, userInfo: [NSLocalizedDescriptionKey: "No subject found in \(inPath)"])
    }
    return (handler, result, cg.width * cg.height)
}

func write(_ buffer: CVPixelBuffer, _ outPath: String) throws -> (Int, Int) {
    let image = CIImage(cvPixelBuffer: buffer)
    guard let out = ctx.createCGImage(image, from: image.extent) else {
        throw NSError(domain: "cutout", code: 3, userInfo: [NSLocalizedDescriptionKey: "Can't render \(outPath)"])
    }
    let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: outPath) as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, out, nil)
    CGImageDestinationFinalize(dest)
    return (out.width, out.height)
}

func cutout(_ inPath: String, _ outPath: String) throws {
    let (handler, result, _) = try analyse(inPath)
    let buffer = try result.generateMaskedImage(ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: true)
    let (w, h) = try write(buffer, outPath)
    print("ok \(outPath) \(w)x\(h)")
}

/// One PNG per separate thing in the photo; specks smaller than 1.5% of the photo are skipped.
func split(_ inPath: String, _ prefix: String) throws {
    let (handler, result, area) = try analyse(inPath)
    var n = 0
    for instance in result.allInstances.sorted() {
        let buffer = try result.generateMaskedImage(ofInstances: [instance], from: handler, croppedToInstancesExtent: true)
        let w = CVPixelBufferGetWidth(buffer), h = CVPixelBufferGetHeight(buffer)
        if w * h < area * 15 / 1000 { continue }
        n += 1
        let outPath = "\(prefix)-\(n).png"
        _ = try write(buffer, outPath)
        print("ok \(outPath) \(w)x\(h)")
    }
    if n == 0 { print("fail nothing big enough in \(inPath)") }
}

var args = Array(CommandLine.arguments.dropFirst())
if args.first == "--split" {
    guard args.count == 3 else { print("usage: swift tools/cutout.swift --split <input> <output-prefix>"); exit(1) }
    do { try split(args[1], args[2]); exit(0) } catch { print("fail \(error.localizedDescription)"); exit(1) }
}
guard args.count >= 2, args.count % 2 == 0 else {
    print("usage: swift tools/cutout.swift <input> <output.png> [...]")
    exit(1)
}
var failed = false
for i in stride(from: 0, to: args.count, by: 2) {
    do { try cutout(args[i], args[i + 1]) } catch { print("fail \(error.localizedDescription)"); failed = true }
}
exit(failed ? 1 : 0)
