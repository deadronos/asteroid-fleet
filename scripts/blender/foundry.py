"""The "Foundry" fleet: industrial slabs, exposed trusses, tanks, ochre over gunmetal.

Each function builds one class with nose on +Y and roughly 10 units long; the game rescales
to `SHIP_LENGTH` (the carrier to 20). `accent` is recoloured per class in-game.
"""
import random

PAL = {'id': 'B', 'hull': (184, 156, 108), 'hull2': (82, 86, 92), 'dark': (34, 33, 32),
       'glow': (255, 160, 70), 'accent': (240, 200, 120), 'rough': .7, 'metal': .35}
PIRATE = {'id': 'Bp', 'hull': (96, 88, 80), 'hull2': (60, 50, 46), 'dark': (22, 18, 18),
          'glow': (255, 70, 50), 'accent': (255, 59, 59), 'rough': .8, 'metal': .3}


def truss(s, y0, y1, x, z, r=.07, bays=4):
    """Four-rod truss with diagonal braces, along Y."""
    pts = [(x - .4, z - .4), (x + .4, z - .4), (x + .4, z + .4), (x - .4, z + .4)]
    for px, pz in pts:
        s.cyl((px, y0, pz), (px, y1, pz), r, 4, 'hull2')
    step = (y1 - y0) / bays
    for i in range(bays):
        ya, yb = y0 + i * step, y0 + (i + 1) * step
        for (ax, az), (bx, bz) in zip(pts, pts[1:] + pts[:1]):
            s.cyl((ax, ya, az), (bx, yb, bz), r * .7, 4, 'hull2')


def drone(s):
    s.loft([(-3, 1.1, .95), (1.8, 1.15, 1.0), (2.8, .85, .75)], 'cham')
    s.box((0, -.4, 1.0), (.75, 1.6, .1), 'accent')
    s.cyl((0, 2.8, 0), (0, 5.4, 0), .7, 6, 'hull2', r1=.05)
    s.engine((0, -3.6, 0), .7, 1.2)
    for _ in s.sym():
        s.cyl((1.35, -2.4, -.3), (1.35, 1.6, -.3), .38, 6, 'hull', r1=.38)
        s.box((1.35, -.4, -.3), (.42, .14, .42), 'hull2')


def scout(s):
    s.box((0, 1.5, 0), (.6, 1.2, .55), 'hull', taper=(.6, .6))
    s.box((0, 2.95, .1), (.35, .25, .25), 'glow')
    s.cyl((0, 3, 0), (0, 5.5, 0), .55, 8, 'hull2', r1=.1)
    s.cyl((0, -5, 0), (0, .5, 0), .14, 6, 'hull2')
    s.cyl((0, -1.5, .4), (0, -1.5, 2.4), .05, 4, 'hull2')
    s.box((0, -1.5, 2.4), (.6, .05, .25), 'accent')
    s.engine((0, -5.4, 0), .45, 1)
    for _ in s.sym():
        s.cyl((.95, -4, 0), (.95, -.5, 0), .3, 6, 'hull')
        s.box((.5, -2.2, 0), (.5, .1, .08), 'hull2')
        s.box((.95, -2.2, .3), (.06, 1.0, .06), 'accent')


def fighter(s):
    s.loft([(-3.5, 1.3, .8), (1.2, 1.2, .7), (3, .7, .45)], 'cham')
    s.box((0, 1.5, .75), (.45, .9, .2), 'dark', taper=(.6, .5))
    for _ in s.sym():
        s.plate([(0, 1.2), (2.8, -.4), (2.8, -2.4), (0, -2.6)], .1, 'hull', z=-.1)
        s.box((2.8, -1.4, -.1), (.12, 1.1, .5), 'accent')
        s.cyl((.7, 2.5, -.4), (.7, 5.2, -.4), .1, 6, 'hull2')
        s.engine((.75, -4.1, 0), .5, 1.4)


def hauler(s):
    s.box((0, 4.3, 0), (1.1, .9, .9), 'hull', taper=(.7, .7))
    s.box((0, 5.25, .2), (.6, .05, .25), 'glow')
    truss(s, -4.5, 3.4, 0, 0, bays=5)
    for y in (-3.2, -.7, 1.8):
        for z in (-1, 1):
            s.box((0, y, z * 1.05), (1.0, 1.05, .55), 'accent' if (y, z) == (-.7, 1) else 'hull')
            s.box((0, y, z * 1.05), (1.03, .1, .58), 'hull2')
    s.box((0, -5.1, 0), (1.2, .6, 1.0), 'hull2')
    for _ in s.sym():
        s.engine((.65, -6.1, 0), .5, 1.4)


def barge(s):
    s.box((0, 6.0, 1.2), (1.8, 1.4, 1.0), 'hull', taper=(.8, .7))
    s.box((0, 7.42, 1.4), (1.2, .05, .2), 'glow')
    s.box((0, 0, -.4), (2.6, 7.4, .4), 'hull2')
    for y in (-5.4, -3, -.6, 1.8):
        for x in (-1.3, 1.3):
            for z in (.6, 1.8):
                acc = (x > 0 and z > 1)
                s.box((x, y, z), (1.15, 1.1, .55), 'accent' if acc else 'hull')
    # gantry crane
    for _ in s.sym():
        s.box((2.7, 3.6, 1.6), (.12, .12, 2.0), 'hull2')
    s.box((0, 3.6, 3.6), (2.8, .14, .14), 'hull2')
    s.box((0, -7.8, .3), (2.4, .7, 1.2))
    for x in (-1.6, -.55, .55, 1.6):
        s.engine((x, -9.0, .3), .45, 1.6)


def harvester(s):
    s.cyl((0, -3.5, 0), (0, 2.0, 0), 1.8, 10, 'hull')
    s.cyl((0, 2.0, 0), (0, 3.4, 0), 2.1, 10, 'hull2', r1=1.6)
    s.cyl((0, 3.4, 0), (0, 3.6, 0), 1.3, 10, 'glow')
    s.arc((0, -.8, 0), 1.86, 0, 360, 10, .14, .2, 'accent', plane='XZ')
    for a in range(0, 360, 60):
        s.at((0, 3.0, 0), (0, a, 0))
        s.box((1.9, 1.2, 0), (.12, 1.4, .25), 'hull2', taper=(.3, .3))
        s.pop()
    s.box((0, -4.3, 0), (1.5, .8, 1.5), 'hull2')
    for _ in s.sym():
        s.engine((.85, -5.4, 0), .55, 1.3)


def repair(s):
    s.box((0, 0, 0), (1.2, 2.4, 1.0), 'hull')
    s.box((0, 0, 1.05), (.8, 1.8, .08), 'accent')
    s.box((0, 2.5, .2), (.8, .2, .5), 'glow')
    s.engine((0, -3, 0), .6, 1.2)
    # crane arm with a clamp
    s.cyl((.6, 1.0, 1.0), (1.2, 2.2, 2.6), .14, 6, 'hull2')
    s.cyl((1.2, 2.2, 2.6), (1.0, 4.6, 1.6), .12, 6, 'hull2')
    s.box((1.0, 4.8, 1.4), (.35, .25, .35), 'accent')
    for _ in s.sym():
        s.cyl((1.35, -2, -.4), (1.35, 1.6, -.4), .35, 6, 'hull2')
    s.cyl((-.5, -1.2, 1), (-.5, -1.2, 2.2), .05, 4, 'hull2')
    s.box((-.5, -1.2, 2.25), (.12, .12, .12), 'glow')


def pirate(s):
    s.loft([(-3.5, 1.2, .8), (1.0, 1.3, .8), (3.2, .6, .5)], 'cham')
    s.box((1.6, -1.2, .4), (.9, 1.8, .45), 'hull2')
    s.box((-1.7, .6, -.2), (.7, 1.5, .4), 'hull')
    s.plate([(0, 0), (3.6, -1.2), (3.2, -2.0), (0, -1.8)], .08, 'accent', z=.0)
    s.plate([(0, 0), (-2.6, -.4), (-2.8, -1.4), (0, -1.6)], .08, 'hull2', z=.1)
    for x in (-.5, .5):
        s.cyl((x, 3.2, -.2), (x, 5.8, -.2), .09, 5, 'hull2', r1=.03)
    s.engine((-.6, -4.2, .1), .55, 1.4)
    s.engine((.9, -4.0, -.2), .4, 1.2)


def carrier(s):
    rng = random.Random(11)
    # forward command block, open truss midsection, aft hangar/engine block
    s.loft([(5, 3.6, 2.4), (11, 3.2, 2.1), (14.5, 2.0, 1.3), (16, 1.2, .8)], 'cham')
    s.box((0, 13.6, 1.4), (1.6, .9, .7), 'hull2', taper=(.8, .6))
    s.box((0, 14.45, 1.5), (1.2, .06, .18), 'glow')
    for x in (-1.6, 1.6):
        truss(s, -5.5, 5.2, x, 0, r=.16, bays=4)
    for y in (-3, 0.5):
        for x in (-2.6, 2.6):
            s.cyl((x, y - 1.3, -.2), (x, y + 1.3, -.2), 1.0, 8, 'hull')
            s.arc((x, y, -.2), 1.03, 0, 360, 8, .1, .14, 'accent', plane='XZ')
    s.loft([(-16, 4.2, 2.8), (-6, 4.4, 3.0), (-5, 3.6, 2.6)], 'cham')
    # hangar mouths on both flanks of the aft block
    for _ in s.sym():
        s.box((4.42, -11, -.3), (.08, 3.0, 1.2), 'dark')
        s.box((4.47, -11, -1.6), (.05, 3.0, .06), 'glow')
        s.box((4.47, -11, 1.0), (.05, 3.0, .06), 'glow')
        s.box((4.6, -11, 1.9), (.4, 3.3, .2), 'accent')
    # bridge tower on the aft block
    s.box((0, -9, 4.2), (1.4, 1.6, 1.4), 'hull2', taper=(.8, .8))
    s.box((0, -7.35, 4.8), (1.1, .05, .2), 'glow')
    s.cyl((.8, -10, 5.5), (.8, -10, 7.4), .06, 4, 'hull2')
    for x in (-3, -1, 1, 3):
        for z in (-1.2, 1.0):
            s.engine((x, -17.0, z), .75, 2.0)
    s.greeble(rng, (-3.6, 3.6, -15, -6, 2.8), 26, .5)
    s.greeble(rng, (-2.6, 2.6, 6, 11, 2.1), 12, .4)


SHIPS = {'drone': drone, 'scout': scout, 'fighter': fighter, 'hauler': hauler, 'barge': barge,
         'harvester': harvester, 'repair': repair, 'pirate': pirate, 'carrier': carrier}
