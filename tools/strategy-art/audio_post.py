"""S-art audio post.
  python tools/strategy-art/audio_post.py stats <rawdir>
  python tools/strategy-art/audio_post.py build <rawdir> <picks.json>   picks: {"strategy": 1, "incident": 2, ...}
Music: loop-crossfade (tail blended into head so the file ends where it begins), loudness-normalised, ogg vorbis.
SFX: trimmed of leading silence, short fade out, peak-normalised, ogg vorbis.
"""
import sys, os, re, json, glob, subprocess, tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'strategy', 'audio')
XF = 5.0


def run(args):
    return subprocess.run(args, capture_output=True, text=True)


def dur(f):
    return float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).stdout.strip())


def vol(f):
    r = run(['ffmpeg', '-hide_banner', '-i', f, '-af', 'volumedetect', '-f', 'null', '-']).stderr
    m = re.search(r'mean_volume: (-?[\d.]+) dB', r); x = re.search(r'max_volume: (-?[\d.]+) dB', r)
    return float(m.group(1)), float(x.group(1))


def stats(raw):
    for f in sorted(glob.glob(os.path.join(raw, '*.flac'))):
        mean, mx = vol(f)
        print('%-22s %7.2fs mean %6.1f max %5.1f crest~%4.1f' % (os.path.basename(f), dur(f), mean, mx, mx - mean))


def build(raw, picks):
    P = json.load(open(picks))
    os.makedirs(OUT, exist_ok=True)
    for name, k in P.items():
        src = os.path.join(raw, '%s_%d.flac' % (name, k))
        dst = os.path.join(OUT, name + '.ogg')
        if name == 'strategy':
            L = dur(src)
            # the generator leaves trailing near-silence; find where the music really ends (last 1 s window above -45 dB)
            for t in range(int(L) - 1, 0, -1):
                r = run(['ffmpeg', '-hide_banner', '-ss', str(t), '-t', '1', '-i', src, '-af', 'volumedetect', '-f', 'null', '-']).stderr
                if float(re.search(r'mean_volume: (-?[\d.]+)', r).group(1)) > -45:
                    L = float(t + 1); break
            print('music content ends at', L)
            tmp = tempfile.mkdtemp()
            head, mid, tail, bl = [os.path.join(tmp, n) for n in ('h.wav', 'm.wav', 't.wav', 'b.wav')]
            run(['ffmpeg', '-y', '-i', src, '-t', str(XF), head])
            run(['ffmpeg', '-y', '-i', src, '-ss', str(XF), '-t', str(L - 2 * XF), mid])
            run(['ffmpeg', '-y', '-i', src, '-ss', str(L - XF), '-t', str(XF), tail])
            # blend: tail fades out while head fades in, then continues into the mid section
            run(['ffmpeg', '-y', '-i', tail, '-i', head, '-filter_complex', 'acrossfade=d=%s:c1=tri:c2=tri' % (XF - 0.01), bl])
            run(['ffmpeg', '-y', '-i', bl, '-i', mid, '-filter_complex',
                 '[0][1]concat=n=2:v=0:a=1,loudnorm=I=-20:TP=-2:LRA=9', '-c:a', 'libvorbis', '-q:a', '4', '-ar', '44100', dst])
        else:
            tmp = os.path.join(tempfile.mkdtemp(), 't.wav')
            run(['ffmpeg', '-y', '-i', src, '-af',
                 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-55dB,areverse', tmp])
            d = dur(tmp)
            run(['ffmpeg', '-y', '-i', tmp, '-af', 'afade=t=out:st=%.3f:d=0.2,loudnorm=I=-16:TP=-1.5:LRA=11' % max(0.05, d - 0.2),
                 '-c:a', 'libvorbis', '-q:a', '4', '-ar', '44100', dst])
        print(name, os.path.getsize(dst), 'bytes', '%.2fs' % dur(dst))


if __name__ == '__main__':
    if sys.argv[1] == 'stats':
        stats(sys.argv[2])
    else:
        build(sys.argv[2], sys.argv[3])
