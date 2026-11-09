"""Edit public/assets/terrain/manifest.json props from a small JSON patch on stdin-free CLI: python manifest_edit.py patch.json
patch = { "<slug>": { ...fields to set, or null to delete } }. Keeps key order, 2-space indent."""
import json, os, sys
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
p = os.path.join(root, 'public', 'assets', 'terrain', 'manifest.json')
m = json.load(open(p, encoding='utf8'))
patch = json.load(open(sys.argv[1], encoding='utf8'))
for slug, v in patch.items():
    if v is None:
        m['props'].pop(slug, None)
    else:
        m['props'].setdefault(slug, {}).update(v)
m['version'] = max(2, m.get('version', 1))
json.dump(m, open(p, 'w', encoding='utf8'), indent=2)
print('props:', ', '.join(m['props']))
