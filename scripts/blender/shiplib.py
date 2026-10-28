"""Procedural low-poly ship builder for Blender. Author with nose on +Y, Z up.

Every part is a closed solid added to one bmesh with a material slot name.
`finish()` turns the nose to Blender -Y (glTF +Z, which is what three's lookAt uses).
Used by `build_fleet.py`; see there for how to run it.
"""
import bpy, bmesh, math
from mathutils import Matrix, Vector

PROFILES = {
    'rect': [(1, 1), (-1, 1), (-1, -1), (1, -1)],
    'hex': [(1, 0), (0.55, 1), (-0.55, 1), (-1, 0), (-0.55, -1), (0.55, -1)],
    'diamond': [(1, 0), (0, 1), (-1, 0), (0, -1)],
    'cham': [(1, .55), (.55, 1), (-.55, 1), (-1, .55), (-1, -.55), (-.55, -1), (.55, -1), (1, -.55)],
    # flat belly, peaked spine: reads as a "hull" from above
    'keel': [(1, -.3), (.45, .7), (0, 1), (-.45, .7), (-1, -.3), (-.6, -1), (.6, -1)],
    'blade': [(1, 0), (.2, 1), (-.2, 1), (-1, 0), (-.2, -1), (.2, -1)],
}


def circle(n):
    return [(math.cos(2 * math.pi * i / n), math.sin(2 * math.pi * i / n)) for i in range(n)]


class Ship:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        self.stack = [Matrix.Identity(4)]

    # -- transforms -------------------------------------------------------
    @property
    def M(self):
        return self.stack[-1]

    def push(self, m):
        self.stack.append(self.M @ m)
        return self

    def pop(self):
        self.stack.pop()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.pop()

    def at(self, loc=(0, 0, 0), rot=(0, 0, 0), scale=1):
        r = Matrix.Rotation(math.radians(rot[0]), 4, 'X') @ Matrix.Rotation(math.radians(rot[1]), 4, 'Y') \
            @ Matrix.Rotation(math.radians(rot[2]), 4, 'Z')
        s = Matrix.Diagonal((*((scale,) * 3 if isinstance(scale, (int, float)) else scale), 1))
        return self.push(Matrix.Translation(loc) @ r @ s)

    def sym(self, mirror=True):
        """Yield once normally and once mirrored across X."""
        yield
        if mirror:
            self.push(Matrix.Diagonal((-1, 1, 1, 1)))
            yield
            self.pop()

    # -- primitives -------------------------------------------------------
    def _mat(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def _v(self, p):
        return self.bm.verts.new(self.M @ Vector(p))

    def _f(self, vs, m):
        try:
            f = self.bm.faces.new(vs)
            f.material_index = self._mat(m)
        except ValueError:
            pass

    def loft(self, sections, prof='hex', m='hull', cap=True):
        """sections: (y, half_w, half_h[, dx, dz]). A zero-size section becomes a tip."""
        pts = PROFILES[prof] if isinstance(prof, str) else prof
        rings = []
        for s in sections:
            y, w, h = s[:3]
            dx, dz = (s[3], s[4]) if len(s) > 3 else (0, 0)
            if w < 1e-5 and h < 1e-5:
                rings.append(self._v((dx, y, dz)))
            else:
                rings.append([self._v((dx + px * w, y, dz + pz * h)) for px, pz in pts])
        n = len(pts)
        for a, b in zip(rings, rings[1:]):
            for i in range(n):
                j = (i + 1) % n
                if isinstance(a, list) and isinstance(b, list):
                    self._f([a[i], a[j], b[j], b[i]], m)
                elif isinstance(a, list):
                    self._f([a[i], a[j], b], m)
                elif isinstance(b, list):
                    self._f([a, b[j], b[i]], m)
        if cap:
            for r in (rings[0], rings[-1]):
                if isinstance(r, list):
                    self._f(r, m)

    def sweep(self, path, w, h, m='hull', prof='rect', up=(0, 0, 1)):
        """Loft a profile along a polyline of points; w/h may be per-point lists."""
        pts = PROFILES[prof] if isinstance(prof, str) else prof
        path = [Vector(p) for p in path]
        ws = w if isinstance(w, list) else [w] * len(path)
        hs = h if isinstance(h, list) else [h] * len(path)
        rings = []
        for i, p in enumerate(path):
            t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
            side = t.cross(Vector(up))
            if side.length < 1e-4:
                side = t.cross(Vector((1, 0, 0)))
            side.normalize()
            nz = side.cross(t)
            rings.append([self._v(p + side * px * ws[i] + nz * pz * hs[i]) for px, pz in pts])
        n = len(pts)
        for a, b in zip(rings, rings[1:]):
            for i in range(n):
                j = (i + 1) % n
                self._f([a[i], a[j], b[j], b[i]], m)
        self._f(rings[0], m)
        self._f(rings[-1], m)

    def arc(self, c, r, a0, a1, segs, w, h, m='hull', plane='XY', prof='rect'):
        """Sweep along a circular arc (degrees) around centre c in the given plane."""
        pts = []
        for i in range(segs + 1):
            a = math.radians(a0 + (a1 - a0) * i / segs)
            u, v = math.cos(a) * r, math.sin(a) * r
            off = {'XY': (u, v, 0), 'XZ': (u, 0, v), 'YZ': (0, u, v)}[plane]
            pts.append(Vector(c) + Vector(off))
        up = {'XY': (0, 0, 1), 'XZ': (0, 1, 0), 'YZ': (1, 0, 0)}[plane]
        self.sweep(pts, w, h, m, prof, up)

    def box(self, c, half, m='hull', taper=(1, 1)):
        """Axis box centred at c; `taper` scales the +Y end (w, h)."""
        x, y, z = c
        w, l, h = half
        self.loft([(y - l, w, h, x, z), (y + l, w * taper[0], h * taper[1], x, z)], 'rect', m)

    def cyl(self, p0, p1, r, n=8, m='hull', r1=None, prof=None):
        d = Vector(p1) - Vector(p0)
        q = d.to_track_quat('Y', 'Z').to_matrix().to_4x4()
        self.push(Matrix.Translation(p0) @ q)
        self.loft([(0, r, r), (d.length, r if r1 is None else r1, r if r1 is None else r1)], prof or circle(n), m)
        self.pop()

    def plate(self, poly, t, m='hull', z=0.0):
        """Extrude an (x, y) polygon by thickness t around height z. Fins and wings."""
        bot = [self._v((x, y, z - t)) for x, y in poly]
        top = [self._v((x, y, z + t)) for x, y in poly]
        self._f(bot, m)
        self._f(top[::-1], m)
        n = len(poly)
        for i in range(n):
            j = (i + 1) % n
            self._f([bot[i], bot[j], top[j], top[i]], m)

    def fin(self, root, span, sweep, chord_root, chord_tip, t, m='hull', dihedral=0.0):
        """Wing from root (x, y, z) out along +X, nose at +Y."""
        x, y, z = root
        tipy = y - sweep
        poly = [(0, chord_root / 2), (span, chord_tip / 2 - sweep), (span, -chord_tip / 2 - sweep), (0, -chord_root / 2)]
        self.at((x, y, z), (0, -dihedral, 0))
        self.plate(poly, t, m)
        self.pop()

    def engine(self, p, r, l, m='hull2', glow='glow', n=8):
        """Nacelle at p with its exhaust facing -Y."""
        x, y, z = p
        self.cyl((x, y - l / 2, z), (x, y + l / 2, z), r, n, m, r1=r * 0.75)
        self.cyl((x, y - l / 2 - 0.02 * l, z), (x, y - l / 2, z), r * 0.8, n, glow)

    def greeble(self, rng, area, count, size, m='hull2'):
        """Scatter small boxes on a top surface. area: (x0, x1, y0, y1, z)."""
        x0, x1, y0, y1, z = area
        for _ in range(count):
            w, l, h = (size * rng.uniform(.4, 1), size * rng.uniform(.5, 1.6), size * rng.uniform(.2, .6))
            self.box((rng.uniform(x0, x1), rng.uniform(y0, y1), z + h), (w, l, h), m)

    # -- output -----------------------------------------------------------
    def finish(self, palette, collection, loc=(0, 0, 0)):
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi, 3, 'Z'))
        bmesh.ops.triangulate(bm, faces=bm.faces)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for name in self.mats:
            me.materials.append(material(name, palette))
        ob = bpy.data.objects.new(self.name, me)
        ob.location = loc
        collection.objects.link(ob)
        return ob


def material(name, palette):
    """One material per slot, named as the game reads it: `accent` exports as `metalRed`,
    the slot `bakeModel` recolours per class. `glow` also gets emission."""
    key = 'metalRed' if name == 'accent' else name
    mat = bpy.data.materials.get(key)
    if mat:
        return mat
    mat = bpy.data.materials.new(key)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    rgba = (*[((c / 255 + .055) / 1.055) ** 2.4 for c in palette[name]], 1)  # sRGB -> linear
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Roughness'].default_value = palette.get('rough', .55)
    bsdf.inputs['Metallic'].default_value = palette.get('metal', .25)
    if name == 'glow':
        bsdf.inputs['Emission Color'].default_value = rgba
        bsdf.inputs['Emission Strength'].default_value = 3
    return mat


def hexcol(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
