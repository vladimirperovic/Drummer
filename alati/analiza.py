#!/usr/bin/env python3
"""Analiza snimka iz midirec: dinamika po padu, dupli okidači, crosstalk, hi-hat i tajming.

    python3 analiza.py snimak.jsonl
"""
import json
import statistics as st
import sys
from collections import Counter, defaultdict

# Podrazumijevane TD-17 note (SETUP > MIDI > NOTE ASSIGN). Ako su mijenjane, imena neće odgovarati.
NAMES = {
    36: "Kick", 38: "Dobos koža", 40: "Dobos rim", 37: "Dobos cross-stick",
    48: "Tom 1", 50: "Tom 1 rim", 45: "Tom 2", 47: "Tom 2 rim", 43: "Tom 3", 58: "Tom 3 rim",
    46: "HH otvoren", 26: "HH otvoren ivica", 42: "HH zatvoren", 22: "HH zatvoren ivica", 44: "HH pedala",
    49: "Crash 1", 55: "Crash 1 ivica", 57: "Crash 2", 52: "Crash 2 ivica",
    51: "Ride", 59: "Ride ivica", 53: "Ride zvono", 27: "Aux", 28: "Aux rim",
}
PADS = {
    "Kick": [36], "Dobos": [38, 40, 37], "Tom 1": [48, 50], "Tom 2": [45, 47], "Tom 3": [43, 58],
    "Hi-hat": [46, 26, 42, 22, 44], "Crash 1": [49, 55], "Crash 2": [57, 52], "Ride": [51, 59, 53], "Aux": [27, 28],
}
PAD_OF = {n: pad for pad, notes in PADS.items() for n in notes}

DOUBLE_MS = 30      # isti pad ponovo u ovom roku, a znatno tiše -> vjerovatno dupli okidač
CROSSTALK_MS = 10   # drugi pad u ovom roku, a vrlo tiho -> vjerovatno crosstalk
SEGMENT_GAP_S = 1.5


def name(note):
    return NAMES.get(note, f"nota {note}")


def pad(note):
    return PAD_OF.get(note, name(note))


def vel_summary(vels):
    v = sorted(vels)
    p = lambda q: v[min(len(v) - 1, int(q * len(v)))]
    return f"min {v[0]:3d}  p10 {p(.1):3d}  medijana {p(.5):3d}  p90 {p(.9):3d}  max {v[-1]:3d}"


def main(path):
    events = [json.loads(line) for line in open(path) if line.strip()]
    hits = sorted((e for e in events if e.get("type") == "on"), key=lambda e: e["t"])
    beats = sorted((e for e in events if e.get("type") == "beat"), key=lambda e: e["t"])
    ccs = [e for e in events if e.get("type") == "cc"]
    if not hits:
        print("Nema udaraca u snimku.")
        return
    dur = hits[-1]["t"] - hits[0]["t"]
    print(f"Snimak: {path}\nUdaraca: {len(hits)} za {dur:.1f} s\n")

    # 1. Segmenti (pauze > 1.5 s), za test „8 tiho / 8 srednje / 8 jako"
    print("== Segmenti (odvojeni pauzom) ==")
    seg = [hits[0]]
    segments = []
    for h in hits[1:]:
        if h["t"] - seg[-1]["t"] > SEGMENT_GAP_S:
            segments.append(seg)
            seg = []
        seg.append(h)
    segments.append(seg)
    for i, s in enumerate(segments, 1):
        by_pad = Counter(pad(h["note"]) for h in s)
        main_pad = by_pad.most_common(1)[0][0]
        vels = [h["vel"] for h in s if pad(h["note"]) == main_pad]
        other = sum(by_pad.values()) - len(vels)
        extra = f"  (+{other} na drugim padovima)" if other else ""
        line = f"{i:2d}. {s[0]['t']:6.1f}s  {main_pad:8s} x{len(vels):3d}  {vel_summary(vels)}{extra}"
        if len(vels) >= 4:
            iois = [b["t"] - a["t"] for a, b in zip(s, s[1:]) if pad(a["note"]) == pad(b["note"]) == main_pad]
            if len(iois) >= 3 and st.mean(iois) > 0:
                line += f"  ujednačenost razmaka ±{100 * st.pstdev(iois) / st.mean(iois):.0f}%"
        print(line)

    # 2. Dinamika po zoni
    print("\n== Dinamika po zoni (jačina 1-127) ==")
    by_note = defaultdict(list)
    for h in hits:
        by_note[h["note"]].append(h["vel"])
    for note, vels in sorted(by_note.items(), key=lambda kv: -len(kv[1])):
        sat = sum(v >= 127 for v in vels) / len(vels)
        warn = f"  ! {sat:.0%} udaraca na 127 (preosjetljivo?)" if sat > 0.15 and len(vels) > 5 else ""
        print(f"{name(note):20s} x{len(vels):4d}  {vel_summary(vels)}{warn}")

    # 3. Dupli okidači
    print(f"\n== Mogući dupli okidači (isti pad < {DOUBLE_MS} ms, drugi udarac tiši) ==")
    last = {}
    doubles = defaultdict(list)
    double_ids = set()
    for h in hits:
        p = pad(h["note"])
        if p == "Hi-hat" and h["note"] == 44:
            continue
        prev = last.get(p)
        if prev:
            dt = (h["t"] - prev["t"]) * 1000
            if dt < DOUBLE_MS and h["vel"] < 0.6 * prev["vel"]:
                doubles[p].append((dt, prev["vel"], h["vel"]))
                double_ids.add(id(h))
        last[p] = h
    if not doubles:
        print("nema")
    for p, items in doubles.items():
        ex = ", ".join(f"{dt:.0f}ms {a}->{b}" for dt, a, b in items[:5])
        print(f"{p:8s} {len(items)}x  npr. {ex}")

    # 4. Crosstalk
    print(f"\n== Mogući crosstalk (drugi pad < {CROSSTALK_MS} ms, vrlo tiho) ==")
    cross = defaultdict(list)
    for i, h in enumerate(hits):
        if h["vel"] >= 25 or id(h) in double_ids:
            continue
        near = [hits[j] for j in range(max(0, i - 8), min(len(hits), i + 8))
                if pad(hits[j]["note"]) != pad(h["note"]) and abs(hits[j]["t"] - h["t"]) * 1000 <= CROSSTALK_MS]
        src = max(near, key=lambda e: e["vel"], default=None)
        if src and src["vel"] >= 60 and h["vel"] < 0.3 * src["vel"]:
            cross[(pad(src["note"]), pad(h["note"]))].append((src["vel"], h["vel"]))
    if not cross:
        print("nema")
    for (src, victim), items in sorted(cross.items(), key=lambda kv: -len(kv[1])):
        print(f"udarac u {src} okida {victim}: {len(items)}x (jačine {', '.join(f'{a}->{b}' for a, b in items[:5])})")

    # 5. Hi-hat pedala (CC4)
    cc4 = [e["val"] for e in ccs if e["cc"] == 4]
    if cc4:
        print("\n== Hi-hat pedala (CC4) ==")
        print(f"raspon {min(cc4)}-{max(cc4)}, {len(set(cc4))} različitih vrijednosti, {len(cc4)} poruka")
        hh = [h for h in hits if h["note"] in (46, 26, 42, 22)]
        print(f"udarci po hi-hatu: zatvoren {sum(h['note'] in (42, 22) for h in hh)}, otvoren {sum(h['note'] in (46, 26) for h in hh)}")
        chick = by_note.get(44)
        if chick:
            print(f"pedala 'chick': x{len(chick)}  {vel_summary(chick)}")

    # 6. Tajming u odnosu na metronom
    if len(beats) >= 8:
        bpm = beats[0]["bpm"]
        interval = 60 / bpm
        grid_start = beats[4]["t"]  # prva 4 su odbrojavanje
        sub = interval / 4  # šesnaestine
        print(f"\n== Tajming prema kliku {bpm:.0f} BPM (mreža šesnaestina; - = ispred klika, + = iza) ==")
        groups = defaultdict(list)
        timeline = []
        for h in hits:
            if h["t"] < grid_start - sub / 2 or h["t"] > beats[-1]["t"] + interval:
                continue
            k = round((h["t"] - grid_start) / sub)
            dev = (h["t"] - (grid_start + k * sub)) * 1000
            groups[pad(h["note"])].append(dev)
            timeline.append((h["t"], dev))
        for p, devs in sorted(groups.items(), key=lambda kv: -len(kv[1])):
            if len(devs) >= 4:
                print(f"{p:8s} x{len(devs):4d}  prosjek {st.mean(devs):+6.1f} ms  rasipanje ±{st.pstdev(devs):5.1f} ms")
        alldev = [d for _, d in timeline]
        if alldev:
            print(f"{'UKUPNO':8s} x{len(alldev):4d}  prosjek {st.mean(alldev):+6.1f} ms  rasipanje ±{st.pstdev(alldev):5.1f} ms")
            chunk = 30
            print("kroz vrijeme (po 30 s): " + "  ".join(
                f"{int(t0)}s {st.mean([d for t, d in timeline if t0 <= t < t0 + chunk]):+.1f}"
                for t0 in range(int(grid_start), int(timeline[-1][0]) + 1, chunk)
                if any(t0 <= t < t0 + chunk for t, _ in timeline)))
        print("napomena: apsolutni prosjek ima grešku od nekoliko ms (kašnjenje zvuka), rasipanje je pouzdano.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__))
