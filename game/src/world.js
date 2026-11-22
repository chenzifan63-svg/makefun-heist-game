// The game's rules and state, with no drawing and no browser in it: the
// thief, the guards, the cameras, the loot, the exit, lives, score and time.
// step() advances one fixed step and returns what happened as bit flags, so
// the caller can react without the world knowing about screens or sound.
import { FIELD, LIVES, PLAYER, POINTS } from './config.js';
import { LEVELS, tileAt, tileCentre, tileIsShadow } from './levels.js';
import { moveCircle } from './physics.js';
import { allWatchers, createCamera, createGuard, stepCamera, stepGuard, STATE_CHASE } from './watchers.js';

export const EVENT_LOOT = 1;
export const EVENT_ALARM = 2;
export const EVENT_CAUGHT = 4;
export const EVENT_LEVEL = 8;
export const EVENT_WIN = 16;
export const EVENT_SPOTTED = 32;
export const EVENT_POWER = 64;

function findTiles(level, letter) {
  const found = [];
  level.map.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === letter) found.push(tileCentre(c, r));
    });
  });
  return found;
}

export function createWorld(random) {
  const state = {
    levelIndex: 0,
    level: LEVELS[0],
    player: { x: 0, y: 0, angle: 0, crouching: false, moving: false, inShadow: false },
    guards: [],
    cameras: [],
    loot: { x: 0, y: 0, taken: false },
    powerboxes: [],
    coins: [],
    exit: { x: 0, y: 0, open: false },
    score: 0,
    lives: LIVES,
    time: 0,
    lootTaken: false,
    boxesTaken: 0,
    coinsTaken: 0,
    detection: 0,
    alarm: false,
    ghost: true,
    caughtFlash: 0,
  };

  function loadLevel(index) {
    const level = LEVELS[index];
    state.levelIndex = index;
    state.level = level;
    const start = findTiles(level, 'P')[0];
    state.player.x = start.x;
    state.player.y = start.y;
    state.player.angle = 0;
    state.player.crouching = false;
    state.guards = level.guards.map((def) => createGuard(def));
    state.cameras = level.cameras.map((def) => createCamera(def));
    const lootPos = findTiles(level, 'L')[0];
    state.loot = { x: lootPos.x, y: lootPos.y, taken: false };
    state.powerboxes = findTiles(level, 'B').map((p) => ({ x: p.x, y: p.y, taken: false }));
    state.coins = findTiles(level, 'o').map((p) => ({ x: p.x, y: p.y, taken: false }));
    const exit = findTiles(level, 'E')[0];
    state.exit = { x: exit.x, y: exit.y, open: false };
    state.lootTaken = false;
    state.boxesTaken = 0;
    state.coinsTaken = 0;
    state.detection = 0;
    state.alarm = false;
    state.time = 0;
    state.caughtFlash = 0;
  }

  function reset() {
    state.score = 0;
    state.lives = LIVES;
    state.ghost = true;
    loadLevel(0);
  }

  function restartLevel() {
    const keepScore = state.score;
    const keepLives = state.lives;
    loadLevel(state.levelIndex);
    state.score = keepScore;
    state.lives = keepLives;
  }

  /**
   * One fixed step. `move` is a -1..1 x/y direction (keyboard or a
   * click-to-move target); `crouch` holds Shift. With `harmless` set (the
   * title screen's backdrop) the watchers patrol but nobody is caught.
   */
  function step(dt, move, crouch, harmless) {
    let events = 0;
    state.time += dt;
    if (state.caughtFlash > 0) state.caughtFlash = Math.max(0, state.caughtFlash - dt);

    const player = state.player;
    const speed = crouch ? PLAYER.crouchSpeed : PLAYER.walkSpeed;
    const len = Math.hypot(move.x, move.y);
    player.crouching = crouch;
    player.moving = len > 0.01;
    if (player.moving) {
      const nx = (move.x / (len || 1)) * speed * dt;
      const ny = (move.y / (len || 1)) * speed * dt;
      const next = moveCircle(player, nx, ny, PLAYER.radius, state.level);
      player.x = next.x;
      player.y = next.y;
      player.angle = Math.atan2(move.y, move.x);
    }
    player.x = Math.min(FIELD.width - PLAYER.radius, Math.max(PLAYER.radius, player.x));
    player.y = Math.min(FIELD.height - PLAYER.radius, Math.max(PLAYER.radius, player.y));
    const tile = tileAt(state.level, Math.floor(player.x / 80), Math.floor(player.y / 80));
    player.inShadow = tileIsShadow(tile);

    let spotted = false;
    for (const guard of state.guards) {
      if (stepGuard(guard, player, state.level, state.time)) {
        events |= EVENT_ALARM;
        state.alarm = true;
        state.ghost = false;
      }
      if (guard.detection > 0.35) spotted = true;
      if (guard.state === STATE_CHASE) state.alarm = true;
    }
    for (const camera of state.cameras) {
      if (stepCamera(camera, player, state.level, state.time)) {
        events |= EVENT_ALARM;
        state.alarm = true;
        state.ghost = false;
        // A camera that fills sends every guard to the thief's position.
        for (const guard of state.guards) {
          guard.state = STATE_CHASE;
          guard.lastKnown = { x: player.x, y: player.y };
          guard.lastSeen = state.time;
        }
      }
      if (camera.detection > 0.35) spotted = true;
    }
    if (spotted) events |= EVENT_SPOTTED;
    state.detection = allWatchers(state).reduce((m, w) => Math.max(m, w.detection), 0);
    if (state.guards.every((g) => g.state !== STATE_CHASE)) state.alarm = false;

    if (!harmless) {
      if (!state.loot.taken && Math.hypot(state.loot.x - player.x, state.loot.y - player.y) < 34) {
        state.loot.taken = true;
        state.lootTaken = true;
        state.score += POINTS.loot;
        events |= EVENT_LOOT;
        // Grabbing the loot is loud: every live watcher notices a little.
        for (const watcher of allWatchers(state)) {
          watcher.detection = Math.min(1, watcher.detection + 0.25);
        }
        state.detection = allWatchers(state).reduce((m, w) => Math.max(m, w.detection), 0);
      }
      for (const box of state.powerboxes) {
        if (!box.taken && Math.hypot(box.x - player.x, box.y - player.y) < 32) {
          box.taken = true;
          state.boxesTaken += 1;
          state.score += POINTS.powerbox;
          events |= EVENT_POWER;
          // Cut the nearest live camera: it goes dark for good.
          let nearest = null;
          let nearestDist = Infinity;
          for (const camera of state.cameras) {
            if (camera.disabled) continue;
            const d = Math.hypot(camera.x - player.x, camera.y - player.y);
            if (d < nearestDist) { nearestDist = d; nearest = camera; }
          }
          if (nearest) {
            nearest.disabled = true;
            nearest.detection = 0;
          }
        }
      }
      for (const coin of state.coins) {
        if (!coin.taken && Math.hypot(coin.x - player.x, coin.y - player.y) < 28) {
          coin.taken = true;
          state.coinsTaken += 1;
          state.score += POINTS.coin;
          events |= EVENT_LOOT;
        }
      }
      // The getaway door opens once the loot is taken.
      state.exit.open = state.lootTaken;
      if (state.exit.open && Math.hypot(state.exit.x - player.x, state.exit.y - player.y) < 36) {
        state.score += POINTS.level + Math.max(0, 120 - Math.floor(state.time));
        if (state.ghost) state.score += POINTS.ghost;
        if (state.levelIndex + 1 >= LEVELS.length) {
          events |= EVENT_WIN;
        } else {
          events |= EVENT_LEVEL;
        }
        return events;
      }
      for (const guard of state.guards) {
        if (Math.hypot(guard.x - player.x, guard.y - player.y) < PLAYER.catchRadius + 12) {
          state.lives -= 1;
          state.caughtFlash = 1;
          events |= EVENT_CAUGHT;
          return events;
        }
      }
    }
    return events;
  }

  reset();
  return {
    state,
    reset,
    loadLevel,
    restartLevel,
    step,
    levelCount: LEVELS.length,
  };
}
