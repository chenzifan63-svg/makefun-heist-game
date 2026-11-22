// Validate every level: each row is 16 tiles, the loot, power boxes, coins
// and the exit are all reachable from the start by flood fill over open
// floor, every guard waypoint sits on open floor, every straight leg
// between two guard waypoints crosses open floor only, and every camera
// hangs on open floor just in front of its wall. Run: node validate-levels.mjs
import { LEVELS, tileAt, tileBlocks, tileCentre } from './game/src/levels.js';
import { TILE } from './game/src/config.js';

let failures = 0;

function reachable(level, fromCol, fromRow) {
  const seen = new Set([`${fromCol},${fromRow}`]);
  const queue = [[fromCol, fromRow]];
  while (queue.length > 0) {
    const [col, row] = queue.shift();
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || c >= 16 || r < 0 || r >= 9 || seen.has(`${c},${r}`)) continue;
      if (tileBlocks(tileAt(level, c, r))) continue;
      seen.add(`${c},${r}`);
      queue.push([c, r]);
    }
  }
  return seen;
}

function legIsOpen(level, a, b) {
  const pa = tileCentre(a[0], a[1]);
  const pb = tileCentre(b[0], b[1]);
  const dist = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  const steps = Math.max(1, Math.ceil(dist / 8));
  for (let i = 0; i <= steps; i += 1) {
    const x = pa.x + ((pb.x - pa.x) * i) / steps;
    const y = pa.y + ((pb.y - pa.y) * i) / steps;
    if (tileBlocks(tileAt(level, Math.floor(x / TILE), Math.floor(y / TILE)))) return false;
  }
  return true;
}

LEVELS.forEach((level, index) => {
  if (level.map.length !== 9) {
    console.log(`level ${index + 1}: ${level.map.length} rows, expected 9`);
    failures += 1;
  }
  level.map.forEach((row, r) => {
    if (row.length !== 16) {
      console.log(`level ${index + 1} row ${r}: ${row.length} tiles, expected 16: "${row}"`);
      failures += 1;
    }
  });
  let start = null;
  const loot = [];
  const boxes = [];
  const coins = [];
  let exit = null;
  level.map.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === 'P') start = [c, r];
      if (ch === 'L') loot.push([c, r]);
      if (ch === 'B') boxes.push([c, r]);
      if (ch === 'o') coins.push([c, r]);
      if (ch === 'E') exit = [c, r];
    });
  });
  if (loot.length !== 1) {
    console.log(`level ${index + 1}: ${loot.length} loot tiles, expected 1`);
    failures += 1;
  }
  const seen = reachable(level, start[0], start[1]);
  for (const [c, r] of loot) {
    if (!seen.has(`${c},${r}`)) {
      console.log(`level ${index + 1}: loot at (${c},${r}) UNREACHABLE`);
      failures += 1;
    }
  }
  for (const [c, r] of boxes) {
    if (!seen.has(`${c},${r}`)) {
      console.log(`level ${index + 1}: power box at (${c},${r}) UNREACHABLE`);
      failures += 1;
    }
  }
  for (const [c, r] of coins) {
    if (!seen.has(`${c},${r}`)) {
      console.log(`level ${index + 1}: coin at (${c},${r}) UNREACHABLE`);
      failures += 1;
    }
  }
  if (!seen.has(`${exit[0]},${exit[1]}`)) {
    console.log(`level ${index + 1}: exit at (${exit[0]},${exit[1]}) UNREACHABLE`);
    failures += 1;
  }
  level.guards.forEach((guard, gi) => {
    guard.waypoints.forEach((wp, wi) => {
      if (tileBlocks(tileAt(level, wp[0], wp[1]))) {
        console.log(`level ${index + 1} guard ${gi}: waypoint ${wi} (${wp}) on a blocking tile`);
        failures += 1;
      }
    });
    for (let wi = 0; wi < guard.waypoints.length; wi += 1) {
      const a = guard.waypoints[wi];
      const b = guard.waypoints[(wi + 1) % guard.waypoints.length];
      if (!legIsOpen(level, a, b)) {
        console.log(`level ${index + 1} guard ${gi}: leg ${JSON.stringify(a)} -> ${JSON.stringify(b)} crosses a wall/crate`);
        failures += 1;
      }
    }
  });
  level.cameras.forEach((camera, ci) => {
    const col = Math.floor(camera.x / TILE);
    const row = Math.floor(camera.y / TILE);
    if (tileBlocks(tileAt(level, col, row))) {
      console.log(`level ${index + 1} camera ${ci}: at (${camera.x},${camera.y}) inside a blocking tile (${col},${row})`);
      failures += 1;
    }
  });
  console.log(`level ${index + 1} (${level.name}): ${loot.length} loot, ${boxes.length} power boxes, ${coins.length} coins, ${level.guards.length} guards, ${level.cameras.length} cameras, reachable=${seen.size} tiles`);
});

if (failures > 0) {
  console.log(`VALIDATION FAILED: ${failures} problem(s)`);
  process.exit(1);
}
console.log('LEVELS VALID: all loot + power boxes + coins + exit reachable, all patrol legs on open floor, all cameras on open floor');
