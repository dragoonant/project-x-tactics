import bpy, json, os, sys
p = os.path.abspath(sys.argv[1]); o_ = os.path.abspath(sys.argv[2])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=p)
m = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
vs = [v.co for v in m.data.vertices]
lo = [min(v[i] for v in vs) for i in range(3)]; hi = [max(v[i] for v in vs) for i in range(3)]
# barrel end (thin, high): average z of the 3% vertices at each x end
xs = sorted(vs, key=lambda v: v[0]); n = max(10, len(xs) // 30)
zl = sum(v[2] for v in xs[:n]) / n; zr = sum(v[2] for v in xs[-n:]) / n
json.dump({'length': hi[0] - lo[0], 'height': hi[2] - lo[2], 'lo': lo, 'hi': hi, 'z_at_minx': zl, 'z_at_maxx': zr}, open(o_, 'w'), indent=1)
print('DIMS', hi[0] - lo[0], hi[2] - lo[2], lo, hi, zl, zr)
