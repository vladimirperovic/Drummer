// Snima MIDI sa Roland TD-17 (ili bilo kog MIDI uređaja) u JSONL fajl, uz opcioni metronom.
//
//   ./midirec --list                      spisak MIDI uređaja
//   ./midirec --identity                  pita modul ko je i koja je verzija (SysEx Identity)
//   ./midirec --seconds 60 --out a.jsonl  snima 60 s
//   ./midirec --seconds 120 --bpm 90      snima uz klik od 90 BPM (prva 4 udarca su odbrojavanje)
//   --source <dio imena>                  bira uređaj ako ih ima više

import AVFoundation
import CoreMIDI
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

var timebase = mach_timebase_info_data_t()
mach_timebase_info(&timebase)
let tickToSec = Double(timebase.numer) / Double(timebase.denom) / 1e9
func secToTicks(_ s: Double) -> UInt64 { UInt64(s / tickToSec) }

let args = CommandLine.arguments
func opt(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

func displayName(_ obj: MIDIObjectRef) -> String {
    var cf: Unmanaged<CFString>?
    guard MIDIObjectGetStringProperty(obj, kMIDIPropertyDisplayName, &cf) == noErr,
          let s = cf?.takeRetainedValue() else { return "?" }
    return s as String
}

func pick(_ endpoints: [MIDIEndpointRef]) -> [MIDIEndpointRef] {
    if let f = opt("--source")?.lowercased() {
        return endpoints.filter { displayName($0).lowercased().contains(f) }
    }
    let roland = endpoints.filter {
        let n = displayName($0).lowercased()
        return n.contains("td-17") || n.contains("td17") || n.contains("roland")
    }
    return roland.isEmpty ? endpoints : roland
}

let sources = (0..<MIDIGetNumberOfSources()).map { MIDIGetSource($0) }
let destinations = (0..<MIDIGetNumberOfDestinations()).map { MIDIGetDestination($0) }
print("MIDI ulazi (\(sources.count)): " + sources.map(displayName).joined(separator: ", "))
print("MIDI izlazi (\(destinations.count)): " + destinations.map(displayName).joined(separator: ", "))
if args.contains("--list") { exit(0) }

let chosen = pick(sources)
guard !chosen.isEmpty else {
    fputs("Nema MIDI uređaja. Da li je modul uključen i povezan USB kablom?\n", stderr)
    exit(1)
}

// MARK: - Izlazni fajl

let identityMode = args.contains("--identity")
let seconds = Double(opt("--seconds") ?? "") ?? (identityMode ? 2 : 60)
let outPath = identityMode ? nil : (opt("--out") ?? "snimak-\(Int(Date().timeIntervalSince1970)).jsonl")
let out: FileHandle? = outPath.flatMap { path in
    FileManager.default.createFile(atPath: path, contents: nil)
    return FileHandle(forWritingAtPath: path)
}
let writeQueue = DispatchQueue(label: "write")
let t0 = mach_absolute_time()
func rel(_ ticks: UInt64) -> Double { Double(Int64(bitPattern: ticks &- t0)) * tickToSec }

func emit(_ dict: [String: Any]) {
    guard let out, let data = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]) else { return }
    writeQueue.async {
        out.write(data)
        out.write(Data([0x0A]))
    }
}

emit(["type": "meta", "sources": chosen.map(displayName), "date": ISO8601DateFormatter().string(from: Date())])

// MARK: - MIDI ulaz

var sysexBuffer: [UInt8] = []

func handleChannelVoice(_ word: UInt32, _ ts: UInt64) {
    let status = UInt8((word >> 16) & 0xFF)
    let d1 = Int((word >> 8) & 0x7F), d2 = Int(word & 0x7F)
    let ch = Int(status & 0x0F) + 1
    let t = rel(ts)
    switch status & 0xF0 {
    case 0x90 where d2 > 0:
        print(String(format: "%8.3f  nota %3d  jačina %3d", t, d1, d2))
        emit(["t": t, "type": "on", "note": d1, "vel": d2, "ch": ch])
    case 0x80, 0x90:
        emit(["t": t, "type": "off", "note": d1, "ch": ch])
    case 0xA0:
        emit(["t": t, "type": "pat", "note": d1, "val": d2, "ch": ch])
    case 0xB0:
        emit(["t": t, "type": "cc", "cc": d1, "val": d2, "ch": ch])
    case 0xC0:
        print(String(format: "%8.3f  promjena kita (program %d)", t, d1 + 1))
        emit(["t": t, "type": "pc", "val": d1, "ch": ch])
    default:
        break
    }
}

func handleSysex7(_ w0: UInt32, _ w1: UInt32) {
    let status = (w0 >> 20) & 0xF  // 0 cijeli, 1 početak, 2 nastavak, 3 kraj
    let count = Int((w0 >> 16) & 0xF)
    let bytes: [UInt8] = [UInt8((w0 >> 8) & 0xFF), UInt8(w0 & 0xFF),
                          UInt8(w1 >> 24), UInt8((w1 >> 16) & 0xFF), UInt8((w1 >> 8) & 0xFF), UInt8(w1 & 0xFF)]
    if status == 0 || status == 1 { sysexBuffer = [] }
    sysexBuffer += bytes.prefix(count)
    if status == 0 || status == 3 {
        let hex = sysexBuffer.map { String(format: "%02X", $0) }.joined(separator: " ")
        print("SysEx: F0 \(hex) F7")
        if sysexBuffer.count >= 13, sysexBuffer[0] == 0x7E, sysexBuffer[2] == 0x06, sysexBuffer[3] == 0x02 {
            let maker = sysexBuffer[4] == 0x41 ? "Roland" : String(format: "0x%02X", sysexBuffer[4])
            let family = sysexBuffer[5...8].map { String(format: "%02X", $0) }.joined(separator: " ")
            let rev = sysexBuffer[9...12].map { String(format: "%02X", $0) }.joined(separator: " ")
            print("Identity: proizvođač \(maker), model/familija \(family), softverska revizija \(rev)")
        }
        emit(["type": "sysex", "hex": hex])
    }
}

let umpWords = [1, 1, 1, 2, 2, 4, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4]

var client = MIDIClientRef()
MIDIClientCreateWithBlock("bubanj-test" as CFString, &client, nil)
var inPort = MIDIPortRef()
let inStatus = MIDIInputPortCreateWithProtocol(client, "in" as CFString, ._1_0, &inPort) { list, _ in
    for packet in list.unsafeSequence() {
        let ts = packet.pointee.timeStamp == 0 ? mach_absolute_time() : packet.pointee.timeStamp
        let count = Int(packet.pointee.wordCount)
        var words = packet.pointee.words
        withUnsafeBytes(of: &words) { raw in
            func word(_ i: Int) -> UInt32 { raw.load(fromByteOffset: i * 4, as: UInt32.self) }
            var i = 0
            while i < count {
                let w = word(i)
                let type = Int(w >> 28)
                if type == 0x2 { handleChannelVoice(w, ts) }
                if type == 0x3, i + 1 < count { handleSysex7(w, word(i + 1)) }
                i += umpWords[type]
            }
        }
    }
}
guard inStatus == noErr else { fputs("Ne mogu da otvorim MIDI ulaz (\(inStatus))\n", stderr); exit(1) }
for s in chosen { MIDIPortConnectSource(inPort, s, nil) }
print("Slušam: " + chosen.map(displayName).joined(separator: ", "))

// MARK: - Identity request (F0 7E 7F 06 01 F7)

if identityMode {
    var outPort = MIDIPortRef()
    MIDIOutputPortCreate(client, "out" as CFString, &outPort)
    var list = MIDIEventList()
    let packet = MIDIEventListInit(&list, ._1_0)
    let payload: [UInt8] = [0x7E, 0x7F, 0x06, 0x01]
    let w0 = UInt32(0x3) << 28 | UInt32(payload.count) << 16 | UInt32(payload[0]) << 8 | UInt32(payload[1])
    let w1 = UInt32(payload[2]) << 24 | UInt32(payload[3]) << 16
    let words: [UInt32] = [w0, w1]
    _ = MIDIEventListAdd(&list, MemoryLayout<MIDIEventList>.size, packet, 0, words.count, words)
    for d in pick(destinations) {
        print("Šaljem Identity Request na \(displayName(d))")
        MIDISendEventList(outPort, d, &list)
    }
}

// MARK: - Metronom

var engine: AVAudioEngine?
if let bpm = Double(opt("--bpm") ?? ""), !identityMode {
    let e = AVAudioEngine()
    let player = AVAudioPlayerNode()
    e.attach(player)
    let sampleRate = e.outputNode.outputFormat(forBus: 0).sampleRate
    let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!
    e.connect(player, to: e.mainMixerNode, format: format)

    func click(_ freq: Double, _ gain: Float) -> AVAudioPCMBuffer {
        let frames = AVAudioFrameCount(sampleRate * 0.03)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buffer.frameLength = frames
        let samples = buffer.floatChannelData![0]
        for i in 0..<Int(frames) {
            let x = Double(i) / sampleRate
            samples[i] = gain * Float(sin(2 * .pi * freq * x) * exp(-x * 120))
        }
        return buffer
    }
    let accent = click(1600, 0.9), normal = click(1000, 0.6)

    do { try e.start() } catch { fputs("Ne mogu da pokrenem zvuk za metronom: \(error)\n", stderr); exit(1) }
    player.play()
    let latency = e.outputNode.presentationLatency
    let interval = 60.0 / bpm
    let start = mach_absolute_time() + secToTicks(1.5)
    let beats = Int((seconds - 1.5) / interval)
    for k in 0..<max(beats, 0) {
        let hostTime = start + secToTicks(Double(k) * interval)
        player.scheduleBuffer(k % 4 == 0 ? accent : normal, at: AVAudioTime(hostTime: hostTime))
        emit(["t": rel(hostTime) + latency, "type": "beat", "n": k, "bpm": bpm])
    }
    emit(["type": "meta", "bpm": bpm, "audio_latency": latency])
    print(String(format: "Metronom %.0f BPM (kašnjenje zvuka ~%.1f ms). Prva 4 klika su odbrojavanje.", bpm, latency * 1000))
    engine = e
}

// MARK: - Kraj

func finish() -> Never {
    writeQueue.sync {}
    out?.closeFile()
    if let outPath { print("Sačuvano: \(outPath)") }
    exit(0)
}

signal(SIGINT, SIG_IGN)
let sigint = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
sigint.setEventHandler { finish() }
sigint.resume()

if !identityMode { print(String(format: "Snimam %.0f s… (Ctrl-C za kraj)", seconds)) }
DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { finish() }
dispatchMain()
