// The watchers: patrolling guards and fixed security cameras. A guard walks
// its waypoints, looks where it walks, and fills its own detection from 0 to
// 1 while the thief stands in its cone in plain sight. A camera never moves:
// it hangs on a wall and sweeps its cone back and forth, filling its own
// detection the same way. Full detection on any watcher raises the alarm:
// the guards run at the thief's last known position. Lose them for a while
// and they give up and go back. A camera cut at its power box goes dark for
// good — its cone dies and it never spots anyone again.
import { CAMERA, GUARD, STEP } from './config.js';
import { hasLineOfSight } from './physics.js';
import { tileCentre } from './levels.js';

export const STATE_PATROL = 'patrol';
export const STATE_CHASE = 'chase';
export const STATE_RETURN = 'return';

function angleDifference(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Can this watcher see the point (x, y) right now? Range, cone angle and a
 * clear line of sight all have to hold. `crouching` and `inShadow` only
 * change how fast detection fills, never whether the watcher sees you.
 */
export function watcherCanSee(watcher, x, y, level) {
  const dx = x - watcher.x;
  const dy = y - watcher.y;
  const dist = Math.hypot(dx, dy);
  if (dist > watcher.range) return false;
  if (dist > 1 && Math.abs(angleDifference(Math.atan2(dy, dx), watcher.angle)) > watcher.halfAngle) return false;
  return hasLineOfSight(watcher.x, watcher.y, x, y, level);
}

export function guardCanSee(guard, x, y, level) {
  return watcherCanSee(guard, x, y, level);
}

export function cameraCanSee(camera, x, y, level) {
  if (camera.disabled) return false;
  return watcherCanSee(camera, x, y, level);
}

export function createGuard(def) {
  const points = def.waypoints.map(([col, row]) => tileCentre(col, row));
  const start = points[0];
  return {
    kind: 'guard',
    x: start.x,
    y: start.y,
    angle: points.length > 1 ? Math.atan2(points[1].y - start.y, points[1].x - start.x) : 0,
    halfAngle: GUARD.coneHalfAngle,
    range: GUARD.coneRange,
    speed: def.speed,
    sweep: Boolean(def.sweep),
    // A runner patrols at speed, no different eyes — the gold ring in the
    // renderer is what tells him apart from the walkers.
    runner: Boolean(def.runner),
    sweepPhase: 0,
    waypoints: points,
    wpIndex: points.length > 1 ? 1 : 0,
    wpDir: 1,
    state: STATE_PATROL,
    detection: 0,
    lastSeen: -99,
    lastKnown: { x: start.x, y: start.y },
    moving: false,
  };
}

export function createCamera(def) {
  return {
    kind: 'camera',
    x: def.x,
    y: def.y,
    baseAngle: def.angle,
    angle: def.angle,
    halfAngle: CAMERA.coneHalfAngle,
    range: def.range || CAMERA.coneRange,
    sweep: def.sweep || 0,
    sweepSpeed: def.speed || 0,
    sweepPhase: 0,
    detection: 0,
    disabled: false,
  };
}

/**
 * One fixed step for one guard. `player` carries x, y, crouching and
 * inShadow; `now` is the world's clock. Returns true on the exact step the
 * guard's detection fills and the alarm goes up.
 */
export function stepGuard(guard, player, level, now) {
  let alarm = false;
  const sees = guardCanSee(guard, player.x, player.y, level);
  if (sees) {
    const dist = Math.hypot(player.x - guard.x, player.y - guard.y);
    const close = 1 - dist / GUARD.coneRange;
    let rate = GUARD.detectFar + (GUARD.detectClose - GUARD.detectFar) * close;
    if (player.crouching) rate *= GUARD.crouchFactor;
    if (player.inShadow) rate *= GUARD.shadowFactor;
    if (guard.detection < 1) {
      guard.detection = Math.min(1, guard.detection + rate * STEP);
      if (guard.detection >= 1) alarm = true;
    }
    guard.lastSeen = now;
    guard.lastKnown = { x: player.x, y: player.y };
  } else {
    guard.detection = Math.max(0, guard.detection - GUARD.detectDecay * STEP);
  }
  if (alarm) guard.state = STATE_CHASE;

  guard.moving = false;
  if (guard.sweep) {
    // The watcher stands still and sweeps his cone in a slow arc.
    guard.sweepPhase += STEP * 0.7;
    guard.angle = Math.sin(guard.sweepPhase) * 1.1;
    if (guard.state === STATE_CHASE) {
      guard.state = STATE_PATROL;
      guard.detection = 0;
    }
    return alarm;
  }

  let target = null;
  let speed = guard.speed;
  if (guard.state === STATE_CHASE) {
    target = guard.lastKnown;
    speed = guard.speed * GUARD.chaseSpeedFactor;
    if (now - guard.lastSeen > GUARD.chaseMemory) {
      guard.state = STATE_RETURN;
      guard.detection = 0;
    }
  } else if (guard.state === STATE_RETURN) {
    // Walk back to the nearest waypoint, then resume the patrol.
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < guard.waypoints.length; i += 1) {
      const d = Math.hypot(guard.waypoints[i].x - guard.x, guard.waypoints[i].y - guard.y);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    guard.wpIndex = best;
    target = guard.waypoints[best];
    if (bestDist < 6) guard.state = STATE_PATROL;
  } else {
    target = guard.waypoints[guard.wpIndex];
  }

  if (target) {
    const dx = target.x - guard.x;
    const dy = target.y - guard.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 6) {
      // Reached the waypoint: advance, ping-ponging on a two-point route.
      if (guard.waypoints.length === 2) {
        guard.wpIndex = 1 - guard.wpIndex;
      } else {
        guard.wpIndex = (guard.wpIndex + guard.wpDir) % guard.waypoints.length;
        if (guard.wpIndex === 0) guard.wpDir = 1;
      }
    } else {
      const step = Math.min(dist, speed * STEP);
      guard.x += (dx / dist) * step;
      guard.y += (dy / dist) * step;
      guard.angle = Math.atan2(dy, dx);
      guard.moving = true;
    }
  }
  return alarm;
}

/**
 * One fixed step for one camera: swing the cone, then fill or drain its
 * detection. Returns true on the exact step its detection fills.
 */
export function stepCamera(camera, player, level, now) {
  if (camera.disabled) {
    camera.detection = 0;
    return false;
  }
  camera.sweepPhase += STEP * camera.sweepSpeed;
  camera.angle = camera.baseAngle + Math.sin(camera.sweepPhase) * camera.sweep;
  const sees = cameraCanSee(camera, player.x, player.y, level);
  if (sees) {
    const dist = Math.hypot(player.x - camera.x, player.y - camera.y);
    const close = 1 - dist / camera.range;
    let rate = CAMERA.detectFar + (CAMERA.detectClose - CAMERA.detectFar) * close;
    if (player.crouching) rate *= CAMERA.crouchFactor;
    if (player.inShadow) rate *= CAMERA.shadowFactor;
    if (camera.detection < 1) {
      camera.detection = Math.min(1, camera.detection + rate * STEP);
      if (camera.detection >= 1) return true;
    }
  } else {
    camera.detection = Math.max(0, camera.detection - CAMERA.detectDecay * STEP);
  }
  return false;
}

/** All watchers on the floor — guards first, then cameras. */
export function allWatchers(state) {
  return [...state.guards, ...state.cameras];
}
