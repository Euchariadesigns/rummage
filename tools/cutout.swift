// Cuts the main subject out of photos using macOS's built-in subject lifting (Vision).
// Usage: swift tools/cutout.swift <input-image> <output.png> [<input> <output> ...]
// Writes a transparent PNG cropped to the subject.
import Foundation
import Vision
import CoreImage
import ImageIO
import UniformTypeIdentifiers

let ctx = CIContext()

func cutout(_ inPath: String, _ outPath: String) throws {
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
    let buffer = try result.generateMaskedImage(ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: true)
    let image = CIImage(cvPixelBuffer: buffer)
    guard let out = ctx.createCGImage(image, from: image.extent) else {
        throw NSError(domain: "cutout", code: 3, userInfo: [NSLocalizedDescriptionKey: "Can't render \(inPath)"])
    }
    let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: outPath) as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, out, nil)
    CGImageDestinationFinalize(dest)
    print("ok \(outPath) \(out.width)x\(out.height)")
}

let args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 2, args.count % 2 == 0 else {
    print("usage: swift tools/cutout.swift <input> <output.png> [...]")
    exit(1)
}
var failed = false
for i in stride(from: 0, to: args.count, by: 2) {
    do { try cutout(args[i], args[i + 1]) } catch { print("fail \(error.localizedDescription)"); failed = true }
}
exit(failed ? 1 : 0)
