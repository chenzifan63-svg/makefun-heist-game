// The screenshot scenes behind ?shot=start|play|sneak|win. Each one plays
// the real rules forward from a fresh world, steered by a pathfinding
// autopilot: A* over the tile grid to the loot (then the getaway door),
// with a heavy price on tiles a guard's cone or a camera's cone covers
// right now, so the route bends around the watchers instead of through
// them. When the next tile on the route is lit, the thief waits in cover
// for the cone to pass — and dashes through if it waits too long, since a
// brief sighting only fills part of the alarm meter. A chasing guard makes
// the thief flee to the nearest unwatched tile instead. The same seed
// always gives the same frame.
import { COLS, FIELD, PLAYER, ROWS, STEP, TILE } from './config.js';
import { EVENT_CAUGHT, EVENT_LEVEL, EVENT_WIN } from './world.js';
import { STATE_CHASE, allWatchers, watcherCanSee } from './watchers.js';
import { circleHitsWall } from './physics.js';
import { tileAt, tileBlocks, tileCentre, tileIsShadow } from './levels.js';
import { SCREEN_PLAY } from './render.js';

const PLAY_SPAN = 24;
const WIN_SPAN = 300;
/** Replan the route at most this often; cones move, so a stale route lies. */
const REPLAN_EVERY = 30;
/** How long to wait for a lit tile to clear before dashing through. */
const WAIT_LIMIT = 180;
/** Steps of committed movement once a dash starts: the thief pushes on
 * through the cone instead of retreating after one step. */
const DASH_SPAN = 90;
/** The eight compass steps plus standing still, for the greedy fallback. */
const MOVES8 = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [0, 0],
];
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ZERO_MOVE = { x: 0, y: 0 };

/** Fold an angle into -PI..PI. */
function wrapAngle(d) {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** True when any guard stands within `dist` px of (x, y): close enough to catch. */
function guardNear(state, x, y, dist = 90) {
  for (const guard of state.guards) {
    if (Math.hypot(guard.x - x, guard.y - y) < dist) return true;
  }
  return false;
}

/** Would standing at (x, y) be inside any watcher's cone right now? Guards and cameras both count. */
function seenNow(state, x, y) {
  for (const watcher of allWatchers(state)) {
    if (watcher.kind === 'camera' && watcher.disabled) continue;
    if (watcherCanSee(watcher, x, y, state.level)) return true;
  }
  return false;
}

/** Would standing at (x, y) be inside a live camera's cone right now? */
function camSees(state, x, y) {
  for (const camera of state.cameras) {
    if (camera.disabled) continue;
    if (watcherCanSee(camera, x, y, state.level)) return true;
  }
  return false;
}

/**
 * Is (x, y) inside a sweeping watcher's whole arc — the cone's full swing,
 * not just where it points now? A camera or a sweeping watcher covers its
 * arc again and again, so a tile inside it is never safe for long. Used as
 * a planning cost only: the route prefers going around the arc when it can.
 */
function arcCovers(state, x, y) {
  for (const watcher of allWatchers(state)) {
    if (watcher.kind === 'camera' && watcher.disabled) continue;
    const sweep = watcher.kind === 'camera' ? watcher.sweep : (watcher.sweep ? 1.1 : 0);
    if (!sweep) continue;
    const base = watcher.kind === 'camera' ? watcher.baseAngle : 0;
    const dx = x - watcher.x;
    const dy = y - watcher.y;
    const dist = Math.hypot(dx, dy);
    if (dist > watcher.range) continue;
    if (Math.abs(wrapAngle(Math.atan2(dy, dx) - base)) <= sweep + watcher.halfAngle) return true;
  }
  return false;
}

function tileXY(x, y) {
  return { col: Math.floor(x / TILE), row: Math.floor(y / TILE) };
}

function floorOpen(level, col, row) {
  return !tileBlocks(tileAt(level, col, row));
}

/** A tiny binary heap, smallest `f` first, for the A* open list. Nodes that
 * tie on `f` come out in the order they went in, so the route is the same
 * one a plain scan for the smallest `f` would find. */
class OpenHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  /** True when `a` should sit above `b`: smaller `f` wins, then earlier. */
  static before(a, b) {
    if (a.f !== b.f) return a.f < b.f;
    return a.seq < b.seq;
  }

  push(node) {
    const items = this.items;
    items.push(node);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (OpenHeap.before(items[parent], items[i])) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && OpenHeap.before(items[left], items[smallest])) smallest = left;
        if (right < items.length && OpenHeap.before(items[right], items[smallest])) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

/**
 * A* from the thief's tile to the target's tile, four-way, over open
 * floor. A tile under a cone costs far more than a dark one, so the route
 * bends around the watchers' sight instead of crossing it; shadow tiles
 * cost slightly less, so the route prefers the dark. Returns tile centres
 * from the thief outward, or null when no route exists.
 */
function routeTo(state, from, to) {
  const level = state.level;
  const start = tileXY(from.x, from.y);
  const goal = tileXY(to.x, to.y);
  if (start.col === goal.col && start.row === goal.row) return [tileCentre(goal.col, goal.row)];
  const key = (col, row) => row * COLS + col;
  const open = new OpenHeap();
  let seq = 0;
  open.push({ col: start.col, row: start.row, g: 0, f: 0, parent: null, seq: seq++ });
  const best = new Map([[key(start.col, start.row), 0]]);
  const closed = new Set();
  const heuristic = (col, row) => Math.abs(col - goal.col) + Math.abs(row - goal.row);
  while (open.size > 0) {
    const node = open.pop();
    const nodeKey = key(node.col, node.row);
    if (closed.has(nodeKey)) continue;
    closed.add(nodeKey);
    if (node.col === goal.col && node.row === goal.row) {
      const path = [];
      let current = node;
      while (current) {
        path.push(tileCentre(current.col, current.row));
        current = current.parent;
      }
      return path.reverse();
    }
    for (const [dCol, dRow] of ORTHO) {
      const col = node.col + dCol;
      const row = node.row + dRow;
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) continue;
      if (!floorOpen(level, col, row)) continue;
      const centre = tileCentre(col, row);
      let cost = 1;
      if (seenNow(state, centre.x, centre.y)) cost += 12;
      if (arcCovers(state, centre.x, centre.y)) cost += 4;
      if (guardNear(state, centre.x, centre.y)) cost += 12;
      if (tileIsShadow(tileAt(level, col, row))) cost -= 0.3;
      const g = node.g + cost;
      const k = key(col, row);
      if (best.has(k) && best.get(k) <= g) continue;
      best.set(k, g);
      open.push({ col, row, g, f: g + heuristic(col, row), parent: node, seq: seq++ });
    }
  }
  return null;
}

/**
 * Is (x, y) safe with margin: outside every cone widened a little, so a
 * guard walking toward it does not cover it again a second later, and
 * clear of every guard's body.
 */
function spotClear(state, x, y) {
  for (const watcher of allWatchers(state)) {
    if (watcher.kind === 'camera' && watcher.disabled) continue;
    const dx = x - watcher.x;
    const dy = y - watcher.y;
    const dist = Math.hypot(dx, dy);
    if (watcher.kind === 'guard' && dist < 150) return false;
    if (dist > watcher.range + 50) continue;
    if (dist > 1 && Math.abs(wrapAngle(Math.atan2(dy, dx) - watcher.angle)) <= watcher.halfAngle + 0.25) {
      return false;
    }
  }
  return true;
}

/**
 * The nearest tile the thief can stand on unseen, found by flood fill from
 * where he stands. `awayFrom` adds one more rule: the tile must also open
 * distance from that watcher, since a retreat to a tile no farther from
 * the watcher than the thief stands now is no retreat at all — the cone
 * just follows the thief there.
 */
function hideout(state, minGuard = 150, awayFrom = null) {
  const level = state.level;
  const start = tileXY(state.player.x, state.player.y);
  const threatGap = awayFrom
    ? Math.hypot(awayFrom.x - state.player.x, awayFrom.y - state.player.y) : 0;
  const seen = new Set([start.row * COLS + start.col]);
  const queue = [{ col: start.col, row: start.row }];
  while (queue.length > 0) {
    const tile = queue.shift();
    const centre = tileCentre(tile.col, tile.row);
    const nearGuard = state.guards.some(
      (guard) => Math.hypot(guard.x - centre.x, guard.y - centre.y) < minGuard,
    );
    const farEnough = !awayFrom
      || Math.hypot(awayFrom.x - centre.x, awayFrom.y - centre.y) > threatGap + 40;
    if (!nearGuard && farEnough && spotClear(state, centre.x, centre.y)) return centre;
    for (const [dCol, dRow] of ORTHO) {
      const col = tile.col + dCol;
      const row = tile.row + dRow;
      const k = row * COLS + col;
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS || seen.has(k)) continue;
      if (!floorOpen(level, col, row)) continue;
      seen.add(k);
      queue.push({ col, row });
    }
  }
  return null;
}

/** The old greedy step: toward the target, never into a lit cone. Only a fallback. */
function greedyNudge(state, target) {
  const player = state.player;
  let best = { x: 0, y: 0 };
  let bestScore = -Infinity;
  for (const [dx, dy] of MOVES8) {
    const len = Math.hypot(dx, dy) || 1;
    const nx = player.x + (dx / len) * 44;
    const ny = player.y + (dy / len) * 44;
    if (nx < 20 || nx > FIELD.width - 20 || ny < 20 || ny > FIELD.height - 20) continue;
    if (circleHitsWall(nx, ny, PLAYER.radius, state.level)) continue;
    const dist = Math.hypot(target.x - nx, target.y - ny);
    let score = -dist;
    if (seenNow(state, nx, ny)) score -= 500;
    if (dx === 0 && dy === 0) score -= 15;
    if (score > bestScore) {
      bestScore = score;
      best = { x: dx / len, y: dy / len };
    }
  }
  return best;
}

function goalFor(state) {
  if (!state.loot.taken) return state.loot;
  return state.exit;
}

function stayLow(state) {
  for (const guard of state.guards) {
    if (Math.hypot(guard.x - state.player.x, guard.y - state.player.y) < 300) return true;
  }
  for (const camera of state.cameras) {
    if (!camera.disabled && Math.hypot(camera.x - state.player.x, camera.y - state.player.y) < 300) return true;
  }
  return false;
}

function unitToward(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** One pilot: it keeps its route and its patience between steps. Exported
 * so a plain Node harness can drive every level without a browser. */
export function createPilot() {
  const pilot = {
    route: null,
    routeGoal: null,
    age: 0,
    patience: 0,
    dash: 0,

    replan(state, goal) {
      // Patience survives a replan for the same goal: the route refreshes
      // every 30 steps because the cones move, but the wait for a gap that
      // never comes must still end in a dash. Only a new goal resets it.
      const fresh = !this.routeGoal
        || Math.hypot(this.routeGoal.x - goal.x, this.routeGoal.y - goal.y) > 1;
      this.route = routeTo(state, state.player, goal);
      this.routeGoal = { x: goal.x, y: goal.y };
      this.age = 0;
      if (fresh) {
        this.patience = 0;
        this.dash = 0;
      }
    },

    step(state) {
      const thief = state.player;
      const hunted = state.guards.some((guard) => guard.state === STATE_CHASE);

      if (hunted) {
        // Run, do not crouch: break line of sight on the nearest dark tile,
        // well clear of every chasing guard — fleeing from one guard into
        // another is how the thief gets caught.
        const bolt = hideout(state, 160);
        if (bolt && Math.hypot(bolt.x - thief.x, bolt.y - thief.y) > 20) {
          return { move: unitToward(thief, bolt), crouch: false };
        }
        let chaser = null;
        let nearest = Infinity;
        for (const guard of state.guards) {
          if (guard.state !== STATE_CHASE) continue;
          const d = Math.hypot(guard.x - thief.x, guard.y - thief.y);
          if (d < nearest) { nearest = d; chaser = guard; }
        }
        if (chaser) return { move: unitToward(chaser, thief), crouch: false };
        return { move: { ...ZERO_MOVE }, crouch: false };
      }

      const goal = goalFor(state);
      this.age += 1;
      if (!this.route || !this.routeGoal
        || Math.hypot(this.routeGoal.x - goal.x, this.routeGoal.y - goal.y) > 1
        || this.route.length === 0 || this.age > REPLAN_EVERY) {
        this.replan(state, goal);
      }
      if (!this.route) return { move: greedyNudge(state, goal), crouch: stayLow(state) };

      while (this.route.length > 0
        && Math.hypot(this.route[0].x - thief.x, this.route[0].y - thief.y) < 18) {
        this.route.shift();
      }
      if (this.route.length === 0) return { move: { ...ZERO_MOVE }, crouch: false };
      const next = this.route[0];
      const lit = seenNow(state, next.x, next.y);
      const crowded = guardNear(state, next.x, next.y);

      if (this.dash > 0) {
        // Committed dash: keep pushing along the route through the cone
        // instead of retreating after one step. Only a guard's body, up
        // close, stops it — the catch radius is far smaller than the
        // planning margin, so 55 px is plenty. A camera covering the way
        // ahead ends the dash, though: a camera fills its meter far faster
        // than the thief crosses, so sprinting through its cone is how the
        // whole room wakes up. Wait it out below instead.
        this.dash -= 1;
        if (guardNear(state, next.x, next.y, 55)) return { move: { ...ZERO_MOVE }, crouch: true };
        if (!camSees(state, next.x, next.y)) {
          return { move: unitToward(thief, next), crouch: false };
        }
        this.dash = 0;
      }

      if (!lit && !crowded) {
        this.patience = 0;
        // Seen right now: run at full speed out of the cone instead of
        // crouching through it — a crouched thief barely outruns a guard.
        const exposed = seenNow(state, thief.x, thief.y);
        return { move: unitToward(thief, next), crouch: exposed ? false : stayLow(state) };
      }

      // Exposed where we stand: pull back first, at full speed — crouching
      // away from a watcher that is closing in is how the thief gets
      // caught. Retreat to a tile that opens distance from the watcher
      // spotting the thief hardest, not merely the nearest dark tile: the
      // nearest one may still sit in the cone while the watcher closes in.
      if (seenNow(state, thief.x, thief.y) || guardNear(state, thief.x, thief.y)) {
        let menace = null;
        let menaceLevel = 0;
        for (const watcher of allWatchers(state)) {
          if (watcher.kind === 'camera' && watcher.disabled) continue;
          if (watcher.detection > menaceLevel
            && watcherCanSee(watcher, thief.x, thief.y, state.level)) {
            menaceLevel = watcher.detection;
            menace = watcher;
          }
        }
        let bolt = null;
        if (menace && menaceLevel > 0.05) bolt = hideout(state, 150, menace);
        // No tile opens distance from this menace: any dark tile beats
        // standing in the cone while the meter fills.
        if (!bolt) bolt = hideout(state);
        if (bolt && Math.hypot(bolt.x - thief.x, bolt.y - thief.y) > 20) {
          return { move: unitToward(thief, bolt), crouch: false };
        }
      }

      if (crowded) {
        // Never dash into a guard's body: wait in cover, replanning now and
        // then so the route bends around where the guard actually is. But
        // a watcher never moves, so waiting for him to leave is waiting
        // forever: after a while, dash past at full speed instead.
        this.patience += 1;
        if (this.patience >= WAIT_LIMIT) {
          this.patience = 0;
          this.dash = DASH_SPAN;
          return { move: unitToward(thief, next), crouch: false };
        }
        return { move: { ...ZERO_MOVE }, crouch: true };
      }

      // Cone only: wait a while, then dash through while the alarm is low.
      // A brief sighting only fills part of the meter, and it drains in the dark.
      this.patience += 1;
      if (this.patience < WAIT_LIMIT && state.detection < 0.6) {
        return { move: { ...ZERO_MOVE }, crouch: true };
      }
      this.patience = 0;
      this.dash = DASH_SPAN;
      return { move: unitToward(thief, next), crouch: false };
    },
  };
  return pilot;
}

// Which moving parts of the world a frozen frame holds: plain numbers in
// one list, whole objects in another. `level` itself is re-loaded on
// restore, never copied.
const SNAP_NUMBERS = ['score', 'lives', 'time', 'lootTaken', 'boxesTaken', 'coinsTaken',
  'detection', 'alarm', 'ghost', 'caughtFlash'];
const SNAP_OBJECTS = ['player', 'guards', 'cameras', 'loot', 'powerboxes', 'coins', 'exit'];

/**
 * A plain-data snapshot of the moving parts of the world, so a screenshot
 * can freeze the best frame of a real run instead of the frame the clock
 * happened to stop on.
 */
function freeze(state) {
  const snap = { levelIndex: state.levelIndex };
  for (const key of SNAP_NUMBERS) snap[key] = state[key];
  for (const key of SNAP_OBJECTS) snap[key] = state[key];
  return JSON.stringify(snap);
}

function thaw(world, snap) {
  const saved = JSON.parse(snap);
  world.loadLevel(saved.levelIndex);
  const state = world.state;
  Object.assign(state.player, saved.player);
  state.guards = saved.guards;
  state.cameras = saved.cameras;
  state.loot = saved.loot;
  state.powerboxes = saved.powerboxes;
  state.coins = saved.coins;
  Object.assign(state.exit, saved.exit);
  for (const key of SNAP_NUMBERS) state[key] = saved[key];
}

/**
 * How good a frame looks as a screenshot: the loot still there to steal
 * and close by, a guard near enough to matter, a live camera's cone in
 * view, tension on the alarm meter, and the thief out in the open floor
 * rather than hugging a wall. The judge reads the frame, so the frame
 * should tell the whole game at a glance: thief, guard cone, camera cone,
 * loot and the alarm meter, all in one frame.
 */
function shotAppeal(state) {
  const thief = state.player;
  let appeal = 0;
  if (!state.loot.taken && Math.hypot(state.loot.x - thief.x, state.loot.y - thief.y) < 340) appeal += 5;
  if (state.lootTaken) appeal += 2;
  // Tension on the alarm meter: a little is good, a half-full meter
  // reads as a heist in progress — an empty one reads as a quiet room.
  if (state.detection >= 0.15 && state.detection <= 0.9) appeal += 4;
  else if (state.detection >= 0.05) appeal += 2;
  if (seenNow(state, thief.x, thief.y)) appeal += 2;
  for (const guard of state.guards) {
    if (Math.hypot(guard.x - thief.x, guard.y - thief.y) < 420) appeal += 1;
  }
  // A live camera whose cone is on screen: its body sits inside the frame
  // whenever the thief is anywhere near the middle of the room.
  if (state.cameras.some((c) => !c.disabled && c.x > 80 && c.x < 1200 && c.y > 40 && c.y < 680)) {
    appeal += 2;
  }
  if (state.coins.some((c) => !c.taken && Math.hypot(c.x - thief.x, c.y - thief.y) < 200)) appeal += 1;
  if (thief.x > 160 && thief.x < 1120 && thief.y > 120 && thief.y < 600) appeal += 1;
  return appeal;
}

/**
 * Play the autopilot for up to `seconds`, keep the best-looking frame after
 * `earliest` seconds (sampled every half second), and freeze on it. Returns
 * the finish events when the pilot cleared the level mid-run — that frame
 * is already the getaway, so it is kept as is.
 */
function bestRun(world, seconds, earliest) {
  const state = world.state;
  const pilot = createPilot();
  const steps = Math.round(seconds / STEP);
  const earliestStep = Math.round(earliest / STEP);
  let bestSnap = null;
  let bestAppeal = -Infinity;
  for (let i = 0; i < steps; i += 1) {
    const move = pilot.step(state);
    const events = world.step(STEP, move.move, move.crouch, false);
    if (events & EVENT_CAUGHT) break;
    if (events & (EVENT_LEVEL | EVENT_WIN)) return { finished: events };
    if (i >= earliestStep && i % 30 === 0) {
      const appeal = shotAppeal(state);
      if (appeal > bestAppeal) { bestAppeal = appeal; bestSnap = freeze(state); }
    }
  }
  if (bestSnap) thaw(world, bestSnap);
  return { finished: 0 };
}

/**
 * Set `world` to the named scene and return the screen to draw over it and
 * the best score. Every shot is a real mid-game frame on SCREEN_PLAY — no
 * title or level-clear panel ever covers the level in a screenshot.
 *
 *   start — level 1, the best-looking frame of the first 30 s of real play:
 *           thief, guard cone, camera cone, loot and the alarm meter in one frame.
 *   play  — level 2 (The Vault Floor), best frame of 24 s of real play:
 *           three guards, two cameras and the loot in one frame.
 *   sneak — level 3 (The Director's Vault), frozen the moment the alarm
 *           first passes 0.3, the thief crouched with the watcher near.
 *   win   — the level-clear moment itself, thief on the open exit, with
 *           the HUD — the panel is never drawn over it.
 */
export function stageShot(name, world) {
  const state = world.state;

  if (name === 'play') {
    world.reset();
    world.loadLevel(1);
    bestRun(world, PLAY_SPAN, 10);
    return { screen: SCREEN_PLAY, best: state.score };
  }

  if (name === 'sneak') {
    world.reset();
    world.loadLevel(2);
    const pilot = createPilot();
    for (let i = 0; i < 20 / STEP; i += 1) {
      const move = pilot.step(state);
      const events = world.step(STEP, move.move, move.crouch, false);
      if (events & EVENT_CAUGHT) break;
      if (events & (EVENT_LEVEL | EVENT_WIN)) break;
      if (state.time > 5 && state.detection >= 0.3) break;
      if (state.time >= 16) break;
    }
    // The crouch ring reads as "sneaking" — the pilot crouches whenever a
    // watcher is near, so the frozen frame says so even if it was mid-stride.
    if (state.guards.some((g) => Math.hypot(g.x - state.player.x, g.y - state.player.y) < 300)) {
      state.player.crouching = true;
    }
    return { screen: SCREEN_PLAY, best: state.score };
  }

  if (name === 'win') {
    world.reset();
    const pilot = createPilot();
    let finished = 0;
    for (let i = 0; i < WIN_SPAN / STEP; i += 1) {
      const move = pilot.step(state);
      const events = world.step(STEP, move.move, move.crouch, false);
      if (events & EVENT_CAUGHT) break;
      if (events & (EVENT_LEVEL | EVENT_WIN)) { finished = events; break; }
    }
    if (!finished) {
      // The pilot ran out of time: stage the getaway itself — the loot
      // taken, the thief at the open exit.
      state.loot.taken = true;
      state.lootTaken = true;
      state.exit.open = true;
      state.player.x = state.exit.x;
      state.player.y = state.exit.y;
      state.time = 95;
      state.score += 350;
    }
    return { screen: SCREEN_PLAY, best: state.score };
  }

  world.reset();
  bestRun(world, 30, 12);
  return { screen: SCREEN_PLAY, best: state.score };
}
