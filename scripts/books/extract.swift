// scripts/books/extract.swift — texto por página de los libros de research/books/.
//
// Qué hace: lee cada PDF con PDFKit (capa de texto) y, solo con --ocr, reconoce con el framework
// Vision (en el propio equipo, español e inglés) las páginas que no tienen texto utilizable.
// Escribe UN archivo por libro con una línea JSON por página y un _manifest.json.
//
// Dónde: research/books/_text/ — queda IGNORADO por git (research/books/* está en .gitignore) y
// debe seguir así: los libros y sus textos son privados y no se versionan (ver
// research/notes/00-books-manifest.md). Esta herramienta no copia nada a docs/ ni a la app.
//
// Uso (compilar una vez; es mucho más rápido que `swift script.swift`):
//   swiftc -O scripts/books/extract.swift -o /tmp/extract-books
//   /tmp/extract-books research/books research/books/_text [--ocr] [--only=<slug>]
//
// Numeración: «página» es el índice de página del PDF (1-based), no el número impreso del libro.
// Es la misma convención de las auditorías anteriores («página PDF»).

import AppKit
import Foundation
import PDFKit
import Vision

let MIN_TEXT_CHARS = 60  // por debajo de esto una página se considera sin texto utilizable

// slug → fragmento del nombre de archivo (en minúsculas)
let BOOKS: [(slug: String, match: String, title: String, author: String)] = [
    ("weinstein-es", "weinstein", "Los secretos de ganar dinero en los mercados alcistas y bajistas (ed. española)", "Stan Weinstein"),
    ("minervini-think-trade", "think & trade", "Think & Trade Like a Champion", "Mark Minervini"),
    ("minervini-mark", "mark minervini", "Mark Minervini (segundo título; ver el PDF)", "Mark Minervini"),
    ("oneil-htmmis", "william-j-o-neil", "How to Make Money in Stocks", "William J. O'Neil"),
    ("momentum-masters", "momentum_masters", "Momentum Masters", "varios"),
    ("point-figure", "point and figure", "Point and Figure Charting", "Thomas Dorsey"),
    ("livermore", "jesse livermore", "Trade Like Jesse Livermore", "Richard Smitten"),
]

func ocr(_ page: PDFPage) -> String {
    let box = page.bounds(for: .mediaBox)
    let scale: CGFloat = 2.2
    let image = page.thumbnail(of: CGSize(width: box.width * scale, height: box.height * scale), for: .mediaBox)
    guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return "" }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["es-ES", "en-US"]
    request.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do { try handler.perform([request]) } catch { return "" }
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

func jsonLine(_ object: [String: Any]) -> Data {
    var data = (try? JSONSerialization.data(withJSONObject: object, options: [.withoutEscapingSlashes])) ?? Data()
    data.append(0x0A)
    return data
}

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("uso: extract-books <carpeta-pdf> <carpeta-salida> [--ocr] [--only=slug]\n".data(using: .utf8)!)
    exit(2)
}
let inDir = args[1], outDir = args[2]
let useOcr = args.contains("--ocr")
let only = args.first(where: { $0.hasPrefix("--only=") }).map { String($0.dropFirst(7)) }
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

let files = (try? FileManager.default.contentsOfDirectory(atPath: inDir))?.filter { $0.lowercased().hasSuffix(".pdf") }.sorted() ?? []
var manifest: [[String: Any]] = []

for book in BOOKS {
    if let only = only, only != book.slug { continue }
    guard let file = files.first(where: { $0.lowercased().contains(book.match) }) else {
        print("\(book.slug): no encuentro el PDF (\(book.match))")
        continue
    }
    guard let doc = PDFDocument(url: URL(fileURLWithPath: inDir).appendingPathComponent(file)) else {
        print("\(book.slug): no se pudo abrir")
        continue
    }
    let outPath = "\(outDir)/\(book.slug).jsonl"
    FileManager.default.createFile(atPath: outPath, contents: nil)
    let handle = FileHandle(forWritingAtPath: outPath)!
    var withText = 0, ocrPages = 0, empty = 0, totalChars = 0
    let started = Date()
    for index in 0..<doc.pageCount {
        guard let page = doc.page(at: index) else { continue }
        var text = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        var fromOcr = false
        if text.count < MIN_TEXT_CHARS, useOcr {
            let recognized = ocr(page).trimmingCharacters(in: .whitespacesAndNewlines)
            if recognized.count > text.count { text = recognized; fromOcr = true; ocrPages += 1 }
        }
        if text.count >= MIN_TEXT_CHARS { withText += 1 } else { empty += 1 }
        totalChars += text.count
        handle.write(jsonLine(["page": index + 1, "chars": text.count, "ocr": fromOcr, "text": text]))
        if useOcr, (index + 1) % 200 == 0 { print("  \(book.slug): \(index + 1)/\(doc.pageCount) páginas…") }
    }
    handle.closeFile()
    let seconds = Int(Date().timeIntervalSince(started))
    print("\(book.slug.padding(toLength: 22, withPad: " ", startingAt: 0)) páginas=\(doc.pageCount) con_texto=\(withText) sin_texto=\(empty) ocr=\(ocrPages) caracteres=\(totalChars) (\(seconds) s)")
    manifest.append([
        "slug": book.slug, "title": book.title, "author": book.author, "file": file,
        "pages": doc.pageCount, "pagesWithText": withText, "pagesWithoutText": empty,
        "ocrPages": ocrPages, "totalChars": totalChars, "tool": useOcr ? "PDFKit+Vision" : "PDFKit",
        "extractedAt": ISO8601DateFormatter().string(from: Date()),
    ])
}

if only == nil || !manifest.isEmpty {
    let data = (try? JSONSerialization.data(withJSONObject: ["books": manifest], options: [.prettyPrinted, .sortedKeys])) ?? Data()
    try? data.write(to: URL(fileURLWithPath: "\(outDir)/_manifest.json"))
}
