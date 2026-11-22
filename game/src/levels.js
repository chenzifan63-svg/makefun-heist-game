// The three night jobs of Vault Breaker. Each level is a tile map of 16
// columns by 9 rows (one tile is 80 px, so 1280x720). Tile letters:
//   #  wall — blocks movement and sight
//   C  crate — low cover, blocks movement and sight, hide behind it
//   S  shadow floor — dark patch, watchers spot you half as fast there
//   .  open floor
//   P  the thief's start     L  the loot (vault / display case)
//   B  a power box — cut it to kill the nearest live camera
//   o  a coin — worth 25 points, a bonus for a risky detour
//   E  the getaway door (opens once the loot is taken)
// Guards are not letters in the map: their patrol routes are listed per
// level as tile waypoints, so a route can cross open floor in any shape.
// Every waypoint sits on open floor and every straight leg between two
// waypoints crosses open floor only — a guard never clips through a wall
// or a crate. A guard with runner: true is a fast patrol — same eyes,
// quicker feet. A guard with sweep: true stands still and sweeps its cone.
// Cameras are fixed to a wall face: x, y are pixels just in front of the
// wall, angle is where the cone points, sweep is how far it swings either
// side of that angle (0 = fixed), and speed is the swing in radians a
// second. A camera's tile must be open floor — never inside a wall.
export const LEVELS = [
  {
    name: 'The Night Gallery',
    tip: 'One camera sweeps the hall. Cut its power box — or wait it out.',
    map: [
      '################',
      '#P....#...L....#',
      '#.....#........#',
      '#.C......C.....#',
      '#....#.........#',
      '#..S..#..S.....#',
      '#.....#.....C..#',
      '#..o..#..Bo...E#',
      '################',
    ],
    guards: [
      { waypoints: [[8, 1], [12, 1]], speed: 55 },
      { waypoints: [[11, 5], [11, 7]], speed: 60 },
    ],
    cameras: [
      { x: 680, y: 88, angle: Math.PI / 2, sweep: 0.9, speed: 0.55, range: 260 },
    ],
  },
  {
    name: 'The Vault Floor',
    tip: 'Two cameras now — one looks up from the floor below. Power boxes kill them.',
    map: [
      '################',
      '#P..C....#..L..#',
      '#......C.#.....#',
      '#..S....#..C...#',
      '#..#....#......#',
      '#..#..C....S...#',
      '#.....#....#...#',
      '#.o...#..B..o.E#',
      '################',
    ],
    guards: [
      { waypoints: [[2, 2], [6, 2]], speed: 68 },
      { waypoints: [[12, 2], [12, 5]], speed: 72 },
      { waypoints: [[2, 6], [5, 6]], speed: 62 },
    ],
    cameras: [
      { x: 920, y: 88, angle: Math.PI / 2, sweep: 0.8, speed: 0.6, range: 260 },
      { x: 600, y: 632, angle: -Math.PI / 2, sweep: 0.8, speed: 0.5, range: 260 },
    ],
  },
  {
    name: "The Director's Vault",
    tip: 'Three cameras, a watcher, a runner. Two power boxes — spend them well.',
    map: [
      '################',
      '#P...#...L....o#',
      '#...C#......C..#',
      '#.C...#...S....#',
      '#..............#',
      '#..S.#....C...o#',
      '#Co....#....o..#',
      '#.B..#...#..B.E#',
      '################',
    ],
    guards: [
      { waypoints: [[2, 1], [4, 1]], speed: 85 },
      { waypoints: [[8, 2], [11, 2]], speed: 90 },
      // A runner: same eyes, quicker feet — his gold ring gives him away.
      { waypoints: [[12, 3], [12, 5]], speed: 115, runner: true },
      { waypoints: [[3, 5], [3, 7], [4, 7]], speed: 70 },
      // The watcher: one waypoint, so he stands and sweeps his cone around.
      { waypoints: [[8, 4]], speed: 0, sweep: true },
    ],
    cameras: [
      { x: 680, y: 88, angle: Math.PI / 2, sweep: 0.9, speed: 0.55, range: 260 },
      { x: 88, y: 360, angle: 0, sweep: 0.8, speed: 0.5, range: 260 },
      { x: 1192, y: 360, angle: Math.PI, sweep: 0.8, speed: 0.5, range: 260 },
    ],
  },
];

/** Tile letter at (col, row); anything outside the map is a wall. */
export function tileAt(level, col, row) {
  if (col < 0 || col >= 16 || row < 0 || row >= 9) return '#';
  return level.map[row][col];
}

/** True when the tile blocks movement and sight. */
export function tileBlocks(tile) {
  return tile === '#' || tile === 'C';
}

/** True when the tile is a shadow patch. */
export function tileIsShadow(tile) {
  return tile === 'S';
}

/** Pixel centre of a tile. */
export function tileCentre(col, row) {
  return { x: col * 80 + 40, y: row * 80 + 40 };
}
