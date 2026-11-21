"""Montaż: przyspieszenie fragmentów oczekiwania, skala do 1080p, MP4 H.264 + napisy .srt."""
import json
import subprocess
import sys

d = json.load(open('cues.json', encoding='utf8'))
cues, total = d['cues'], d['total']


def find(prefix):
    return next(c for c in cues if c['text'].startswith(prefix))


# Fragmenty "czekania na wynik" – przyspieszone.
fast = [
    (find('Maigret')['start'] + 4.0, find('Potem')['start'] - 0.8, 3.0),
    (find('Analizy można')['start'] + 6.0, find('Kolejny przebieg')['start'] - 1.5, 2.5),
]
fast = [(a, b, s) for a, b, s in fast if b - a > 1]

segs, t = [], 0.0
for a, b, s in fast:
    segs.append((t, a, 1.0))
    segs.append((a, b, s))
    t = b
segs.append((t, total, 1.0))


def mapt(x):
    out = 0.0
    for a, b, s in segs:
        if x <= a:
            break
        out += (min(x, b) - a) / s
    return out


parts, labels = [], []
for i, (a, b, s) in enumerate(segs):
    parts.append(f"[0:v]trim=start={a:.3f}:end={b:.3f},setpts=(PTS-STARTPTS)/{s}[v{i}]")
    labels.append(f"[v{i}]")
fc = ";".join(parts) + ";" + "".join(labels) + f"concat=n={len(segs)}:v=1:a=0,scale=1920:1080:flags=lanczos,fps=30,format=yuv420p[out]"

cmd = ['ffmpeg', '-loglevel', 'error', '-y', '-i', 'raw.webm', '-filter_complex', fc, '-map', '[out]',
       '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', 'krypto-radar-demo.mp4']
subprocess.run(cmd, check=True)


def ts(x):
    ms = int(round(x * 1000))
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"


with open('krypto-radar-demo.srt', 'w', encoding='utf8') as f:
    for i, c in enumerate([c for c in cues if c['text']], 1):
        f.write(f"{i}\n{ts(mapt(c['start']))} --> {ts(mapt(c['end']))}\n{c['text']}\n\n")

print('segments', [(round(a, 1), round(b, 1), s) for a, b, s in segs])
print('duration', round(mapt(total), 1), 's')
sys.stdout.flush()
