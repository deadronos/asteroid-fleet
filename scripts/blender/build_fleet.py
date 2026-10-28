"""Build the Foundry fleet and export one .glb per ship class into public/models.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \\
        -P scripts/blender/build_fleet.py -- public/models

Each ship is built and exported on its own, so material names stay the plain slot names
(`hull`, `hull2`, `dark`, `glow`, `metalRed`) that `src/render/models.ts` expects.
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import foundry  # noqa: E402
import shiplib  # noqa: E402

out = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'public/models'
os.makedirs(out, exist_ok=True)
scene = bpy.context.scene
for ob in list(scene.objects):
    bpy.data.objects.remove(ob)

for name, build in foundry.SHIPS.items():
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat)
    s = shiplib.Ship(name)
    build(s)
    ob = s.finish(foundry.PIRATE if name == 'pirate' else foundry.PAL, scene.collection)
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    path = os.path.join(out, f'foundry_{name}.glb')
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB',
                              export_texcoords=False, export_materials='EXPORT')
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    print(f'{path}: {tris} tris, {os.path.getsize(path)} bytes')
    bpy.data.objects.remove(ob)
