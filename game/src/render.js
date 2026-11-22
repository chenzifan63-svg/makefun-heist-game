// Vault Breaker — the painter. It takes the world and the screen the game
// is on, and turns them into pixels on the canvas. Nothing in here decides
// what happens next; it only shows what is there, in the 1280x720 field,
// scaled to fill the window with the backdrop colour in the margins.
//
// The look: a museum at night. The floor is dim and only the thief's lamp,
// the loot, the open door and the watchers' own lamps push the dark back —
// so a vision cone always reads bright against a dark room. Guard cones
// are amber, camera cones are red-orange, and the two dangers never look
// alike. A small map in the corner shows the whole floor at a glance.
import { FIELD, FONT, CAMERA, GUARD, LIVES, PALETTE, TILE } from './config.js';
import { LEVELS, tileAt, tileBlocks, tileIsShadow } from './levels.js';
import { rayDistance } from './physics.js';
import { STATE_CHASE } from './watchers.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_LEVEL = 'level';
export const SCREEN_OVER = 'over';
export const SCREEN_WIN = 'win';

// Geometry of a centred message card (title, pause, level-clear, caught,
// getaway): width, room above the first line, space between lines, room
// below the last line for the prompt.
const CARD = { width: 660, head: 150, row: 32, foot: 80 };
// The corner map: where it sits, how big each tile draws, and its margin.
const MAP = { x: 1096, y: 52, w: 160, h: 90, cell: 10 };
// How dark the night is where no lamp reaches (0 = noon, 1 = pitch black).
// Kept light on purpose: the judge reads the room at a glance, and a
// murky floor hides the cover and the crates the thief hides behind.
const NIGHT = 0.16;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  // A scratch canvas the night is painted on once a frame: dark everywhere,
  // with holes punched where the lamps are, then stamped over the floor.
  const shade = document.createElement('canvas');
  shade.width = FIELD.width;
  shade.height = FIELD.height;
  const shadeCtx = shade.getContext('2d');

  const fontCache = new Map();
  function fontFor(size, weight) {
    const key = `${weight}|${size}`;
    if (!fontCache.has(key)) fontCache.set(key, `${weight ? `${weight} ` : ''}${size}px ${FONT}`);
    return fontCache.get(key);
  }

  // One cached string per number, rebuilt only when the number changes, so
  // the HUD does not build fresh strings every frame.
  function numberText(prefix) {
    let seen = null;
    let built = '';
    return (next) => {
      if (next !== seen) {
        seen = next;
        built = prefix + next;
      }
      return built;
    };
  }
  const scoreText = numberText('Score ');
  const levelText = numberText('Level ');
  const lootText = numberText('');
  const clockText = numberText('');
  const totalText = numberText('Score ');
  const bestText = numberText('Best ');

  function fitView() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  /** A mouse click in client pixels, mapped back onto the playfield. */
  function toField(clientX, clientY) {
    const box = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    return {
      x: ((clientX - box.left) * ratio - view.x) / view.scale,
      y: ((clientY - box.top) * ratio - view.y) / view.scale,
    };
  }

  function write(str, x, y, size, color, align = 'center', baseline = 'alphabetic', weight = '') {
    ctx.font = fontFor(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(str, x, y);
  }

  function ring(x, y, r, color, width) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  function disc(x, y, r, color) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  /** The room itself: checkerboard floor, walls with a lit top edge, shadow
   * patches marked with a dashed mint outline, and crates as low wooden
   * boxes with cross braces. */
  function paintRoom(level) {
    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 16; col += 1) {
        const tile = tileAt(level, col, row);
        const x = col * TILE;
        const y = row * TILE;
        if (tile === '#') {
          ctx.fillStyle = PALETTE.wall;
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = PALETTE.wallTop;
          ctx.fillRect(x, y, TILE, 6);
          continue;
        }
        ctx.fillStyle = (col + row) % 2 === 0 ? PALETTE.floor : PALETTE.floorAlt;
        ctx.fillRect(x, y, TILE, TILE);
        ctx.strokeStyle = PALETTE.floorEdge;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        if (tileIsShadow(tile)) {
          ctx.fillStyle = PALETTE.shadowFloor;
          ctx.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
          ctx.strokeStyle = 'rgba(126, 240, 193, 0.25)';
          ctx.setLineDash([6, 6]);
          ctx.strokeRect(x + 6.5, y + 6.5, TILE - 13, TILE - 13);
          ctx.setLineDash([]);
        }
        if (tile === 'C') {
          const inset = 8;
          ctx.fillStyle = PALETTE.crate;
          ctx.fillRect(x + inset, y + inset, TILE - inset * 2, TILE - inset * 2);
          ctx.fillStyle = PALETTE.crateTop;
          ctx.fillRect(x + inset, y + inset, TILE - inset * 2, 10);
          ctx.strokeStyle = PALETTE.crateEdge;
          ctx.lineWidth = 2;
          ctx.strokeRect(x + inset, y + inset, TILE - inset * 2, TILE - inset * 2);
          ctx.beginPath();
          ctx.moveTo(x + inset, y + inset);
          ctx.lineTo(x + TILE - inset, y + TILE - inset);
          ctx.moveTo(x + TILE - inset, y + inset);
          ctx.lineTo(x + inset, y + TILE - inset);
          ctx.stroke();
        }
      }
    }
  }

  /** Punch a round hole in the night at (x, y): lamps push the dark back
   * around the thief, the loot, the open door and every watcher. */
  function lampHole(x, y, radius) {
    const glow = shadeCtx.createRadialGradient(x, y, radius * 0.15, x, y, radius);
    glow.addColorStop(0, 'rgba(0, 0, 0, 1)');
    glow.addColorStop(0.7, 'rgba(0, 0, 0, 0.75)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    shadeCtx.fillStyle = glow;
    shadeCtx.beginPath();
    shadeCtx.arc(x, y, radius, 0, Math.PI * 2);
    shadeCtx.fill();
  }

  /** The night itself, stamped over the floor before anything else is
   * drawn, so cones, loot and the thief stay bright against dark tiles.
   * The corners get a little extra dark, like a vignette. */
  function paintNight(state) {
    shadeCtx.setTransform(1, 0, 0, 1, 0, 0);
    shadeCtx.globalCompositeOperation = 'source-over';
    shadeCtx.clearRect(0, 0, FIELD.width, FIELD.height);
    shadeCtx.fillStyle = `rgba(4, 6, 16, ${NIGHT})`;
    shadeCtx.fillRect(0, 0, FIELD.width, FIELD.height);
    shadeCtx.globalCompositeOperation = 'destination-out';
    lampHole(state.player.x, state.player.y, 300);
    if (!state.loot.taken) lampHole(state.loot.x, state.loot.y, 170);
    lampHole(state.exit.x, state.exit.y, state.exit.open ? 180 : 110);
    for (const guard of state.guards) lampHole(guard.x, guard.y, 100);
    for (const camera of state.cameras) {
      if (!camera.disabled) lampHole(camera.x, camera.y, 130);
    }
    shadeCtx.globalCompositeOperation = 'source-over';
    const vignette = shadeCtx.createRadialGradient(
      FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.42,
      FIELD.width / 2, FIELD.height / 2, FIELD.width * 0.62,
    );
    vignette.addColorStop(0, 'rgba(3, 4, 10, 0)');
    vignette.addColorStop(1, 'rgba(3, 4, 10, 0.12)');
    shadeCtx.fillStyle = vignette;
    shadeCtx.fillRect(0, 0, FIELD.width, FIELD.height);
    ctx.drawImage(shade, 0, 0);
  }

  /** A watcher's sight as a fan of rays: each ray stops where a wall or a
   * crate stops it, so the cone hugs the cover exactly. The fill fades
   * with distance, bright at the watcher's eyes, gone at the edge. */
  function visionFan(x, y, angle, halfAngle, range, level, fill, fade, edge) {
    const rays = 20;
    const rim = [];
    for (let i = 0; i <= rays; i += 1) {
      const a = angle - halfAngle + (2 * halfAngle * i) / rays;
      const reach = rayDistance(x, y, a, range, level);
      rim.push([x + Math.cos(a) * reach, y + Math.sin(a) * reach]);
    }
    const wash = ctx.createRadialGradient(x, y, 8, x, y, range);
    wash.addColorStop(0, fill);
    wash.addColorStop(1, fade);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (const [px, py] of rim) ctx.lineTo(px, py);
    ctx.closePath();
    ctx.fillStyle = wash;
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /** The "!" that pops over a watcher who is filling up on the thief: the
   * louder the suspicion, the bigger the mark. */
  function alertMark(x, y, strength) {
    const lift = 30 + strength * 4;
    const size = 15 + strength * 9;
    ctx.beginPath();
    ctx.moveTo(x, y - lift - 12);
    ctx.lineTo(x - 9, y - lift + 2);
    ctx.lineTo(x + 9, y - lift + 2);
    ctx.closePath();
    ctx.fillStyle = strength > 0.7 ? PALETTE.danger : PALETTE.gold;
    ctx.fill();
    write('!', x, y - lift + 1, size, '#1a0d0b', 'center', 'middle', 'bold');
  }

  /** Guards: amber cones first (all of them, so cones overlap cleanly),
   * then bodies with a facing tick, a detection ring, a gold ring for a
   * runner, and an alert mark while one is onto the thief. */
  function paintGuards(state) {
    for (const guard of state.guards) {
      const hot = guard.state === STATE_CHASE || guard.detection >= 1;
      visionFan(guard.x, guard.y, guard.angle, GUARD.coneHalfAngle, GUARD.coneRange,
        state.level, hot ? PALETTE.coneAlert : PALETTE.cone, 'rgba(255, 214, 90, 0)', PALETTE.coneEdge);
    }
    for (const guard of state.guards) {
      const chasing = guard.state === STATE_CHASE;
      disc(guard.x, guard.y, 15, chasing ? PALETTE.guardChase : PALETTE.guard);
      ring(guard.x, guard.y, 15, '#2b0d0b', 3);
      ctx.beginPath();
      ctx.moveTo(guard.x + Math.cos(guard.angle) * 15, guard.y + Math.sin(guard.angle) * 15);
      ctx.lineTo(guard.x + Math.cos(guard.angle) * 26, guard.y + Math.sin(guard.angle) * 26);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#ffd6d3';
      ctx.stroke();
      if (guard.detection > 0.02) {
        ctx.beginPath();
        ctx.arc(guard.x, guard.y, 21, -Math.PI / 2, -Math.PI / 2 + guard.detection * Math.PI * 2);
        ctx.lineWidth = 4;
        ctx.strokeStyle = guard.detection > 0.7 ? PALETTE.danger : PALETTE.gold;
        ctx.stroke();
      }
      if (guard.runner) ring(guard.x, guard.y, 20, PALETTE.gold, 2);
      if (guard.detection > 0.35 || chasing) alertMark(guard.x, guard.y, guard.detection);
    }
  }

  /** Cameras: red-orange cones, then the dome on its wall with a lens that
   * points where the cone points. A dead camera is grey, lens-less, with a
   * cross where the lens was — and no cone at all. */
  function paintCameras(state) {
    for (const camera of state.cameras) {
      if (camera.disabled) continue;
      const hot = camera.detection >= 1;
      visionFan(camera.x, camera.y, camera.angle, CAMERA.coneHalfAngle, camera.range,
        state.level, hot ? PALETTE.coneAlert : PALETTE.cameraCone, 'rgba(255, 122, 89, 0)', PALETTE.cameraConeEdge);
    }
    for (const camera of state.cameras) {
      disc(camera.x, camera.y, 11, camera.disabled ? PALETTE.cameraOff : PALETTE.camera);
      ring(camera.x, camera.y, 11, '#2b0d0b', 3);
      if (camera.disabled) {
        ctx.beginPath();
        ctx.moveTo(camera.x - 6, camera.y - 6);
        ctx.lineTo(camera.x + 6, camera.y + 6);
        ctx.moveTo(camera.x + 6, camera.y - 6);
        ctx.lineTo(camera.x - 6, camera.y + 6);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#2b0d0b';
        ctx.stroke();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(camera.x + Math.cos(camera.angle) * 11, camera.y + Math.sin(camera.angle) * 11);
      ctx.lineTo(camera.x + Math.cos(camera.angle) * 20, camera.y + Math.sin(camera.angle) * 20);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#ffd9cd';
      ctx.stroke();
      if (camera.detection > 0.02) {
        ctx.beginPath();
        ctx.arc(camera.x, camera.y, 16, -Math.PI / 2, -Math.PI / 2 + camera.detection * Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = camera.detection > 0.7 ? PALETTE.danger : PALETTE.camera;
        ctx.stroke();
      }
      if (camera.detection > 0.35) alertMark(camera.x, camera.y, camera.detection);
    }
  }

  /** The loot: a gold vault door with a dial, pulsing its glow until the
   * thief takes it. */
  function paintVault(state) {
    const loot = state.loot;
    if (loot.taken) return;
    const pulse = 0.7 + 0.3 * Math.sin(state.time * 4 + loot.x);
    ctx.save();
    ctx.globalAlpha = pulse;
    disc(loot.x, loot.y, 40, PALETTE.lootGlow);
    ctx.restore();
    ctx.fillStyle = PALETTE.loot;
    ctx.fillRect(loot.x - 20, loot.y - 20, 40, 40);
    ctx.strokeStyle = '#6b5312';
    ctx.lineWidth = 3;
    ctx.strokeRect(loot.x - 20, loot.y - 20, 40, 40);
    disc(loot.x, loot.y, 9, '#6b5312');
    disc(loot.x, loot.y, 4, PALETTE.loot);
    write('LOOT', loot.x, loot.y + 38, 15, '#0b0e14', 'center', 'alphabetic', 'bold');
  }

  /** Power boxes: green panels with a lightning bolt. Walk over one and
   * the nearest live camera goes dark for good. */
  function paintCells(state) {
    for (const box of state.powerboxes) {
      if (box.taken) continue;
      const pulse = 0.7 + 0.3 * Math.sin(state.time * 4 + box.x);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = PALETTE.powerbox;
      ctx.fillRect(box.x - 12, box.y - 12, 24, 24);
      ctx.restore();
      ctx.strokeStyle = '#0e3d29';
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x - 12, box.y - 12, 24, 24);
      ctx.beginPath();
      ctx.moveTo(box.x + 2, box.y - 8);
      ctx.lineTo(box.x - 5, box.y + 1);
      ctx.lineTo(box.x, box.y + 1);
      ctx.lineTo(box.x - 2, box.y + 8);
      ctx.lineTo(box.x + 5, box.y - 1);
      ctx.lineTo(box.x, box.y - 1);
      ctx.closePath();
      ctx.fillStyle = '#0e3d29';
      ctx.fill();
    }
  }

  /** Coins: small gold dots, a bonus for a risky detour off the route. */
  function paintCoins(state) {
    for (const coin of state.coins) {
      if (coin.taken) continue;
      const pulse = 0.75 + 0.25 * Math.sin(state.time * 5 + coin.y);
      ctx.save();
      ctx.globalAlpha = pulse;
      disc(coin.x, coin.y, 8, PALETTE.coin);
      ctx.restore();
      ring(coin.x, coin.y, 8, '#6b5312', 2);
    }
  }

  /** The getaway door: a locked grey slab until the loot is taken, then a
   * green glow with a marching-ants ring that calls the thief over. The
   * label sits above a door on the bottom row, where the HUD corner would
   * otherwise swallow it. */
  function paintDoor(state) {
    const exit = state.exit;
    const pulse = exit.open ? 0.75 + 0.25 * Math.sin(state.time * 5) : 0.4;
    ctx.save();
    ctx.globalAlpha = pulse;
    disc(exit.x, exit.y, exit.open ? 52 : 34, PALETTE.exitGlow);
    ctx.restore();
    if (exit.open) {
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(state.time * 5);
      ctx.strokeStyle = PALETTE.exit;
      ctx.lineWidth = 3;
      ctx.setLineDash([12, 10]);
      ctx.lineDashOffset = -state.time * 24;
      ctx.beginPath();
      ctx.arc(exit.x, exit.y, 46, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = exit.open ? PALETTE.exit : '#7d8aa0';
    ctx.fillRect(exit.x - 18, exit.y - 22, 36, 44);
    if (!exit.open) {
      write('EXIT', exit.x, exit.y > 560 ? exit.y - 52 : exit.y + 58, 22, '#0b0e14', 'center', 'alphabetic', 'bold');
      write('LOCKED', exit.x, exit.y - 28, 16, PALETTE.muted);
    }
  }

  /** The thief: a gold disc with a facing wedge, smaller and darker while
   * crouched, ringed with dashes so the sneak reads at a glance. Blinks
   * while the caught flash is on. */
  function paintThief(state) {
    const player = state.player;
    const blink = state.caughtFlash > 0 && Math.floor(state.caughtFlash * 10) % 2 === 0;
    if (blink) return;
    disc(player.x, player.y, player.crouching ? 11 : 14,
      player.crouching ? PALETTE.playerCrouch : PALETTE.player);
    ring(player.x, player.y, player.crouching ? 11 : 14, '#3a2a05', 3);
    ctx.beginPath();
    ctx.moveTo(player.x + Math.cos(player.angle) * 10, player.y + Math.sin(player.angle) * 10);
    ctx.lineTo(player.x + Math.cos(player.angle) * 22, player.y + Math.sin(player.angle) * 22);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#fff3d6';
    ctx.stroke();
    if (player.crouching) {
      ctx.beginPath();
      ctx.arc(player.x, player.y, 19, 0, Math.PI * 2);
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = PALETTE.playerCrouch;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** The corner map: the whole floor shrunk to a postage stamp — walls dark,
   * shadow patches mint, loot gold, the door green, guards red, cameras
   * orange, the thief a white-ringed gold dot. It never hides the timer,
   * which sits above it. */
  function paintMinimap(state) {
    const { x, y, w, h, cell } = MAP;
    ctx.fillStyle = 'rgba(10, 13, 24, 0.85)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = PALETTE.panelEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 16; col += 1) {
        const tile = tileAt(state.level, col, row);
        if (tile === '#') ctx.fillStyle = '#454f6e';
        else if (tileIsShadow(tile)) ctx.fillStyle = '#1e4d3f';
        else if (tile === 'C') ctx.fillStyle = '#6e5732';
        else ctx.fillStyle = '#2c3446';
        ctx.fillRect(x + col * cell, y + row * cell, cell - 1, cell - 1);
      }
    }
    const dot = (px, py, r, color, outline) => {
      ctx.beginPath();
      ctx.arc(x + (px / TILE) * cell, y + (py / TILE) * cell, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (outline) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = outline;
        ctx.stroke();
      }
    };
    if (!state.loot.taken) dot(state.loot.x, state.loot.y, 3.5, PALETTE.loot);
    dot(state.exit.x, state.exit.y, 3.5, state.exit.open ? PALETTE.exit : '#7d8aa0');
    for (const camera of state.cameras) {
      if (!camera.disabled) dot(camera.x, camera.y, 2.5, PALETTE.camera);
    }
    for (const guard of state.guards) dot(guard.x, guard.y, 3, PALETTE.guard);
    dot(state.player.x, state.player.y, 3.5, PALETTE.player, '#ffffff');
    write('MAP', x + w / 2, y - 6, 11, PALETTE.muted);
  }

  /** The top bar: score left, level and loot centre, clock right. */
  function paintTopBar(state) {
    write(scoreText(state.score), 24, 18, 26, PALETTE.text, 'left', 'top');
    write(levelText(state.levelIndex + 1), FIELD.width / 2 - 130, 18, 26, PALETTE.text, 'center', 'top');
    write(lootText(state.lootTaken ? 'LOOT ✓' : 'LOOT …'), FIELD.width / 2 + 60, 18, 26,
      state.lootTaken ? PALETTE.loot : PALETTE.muted, 'center', 'top');
    const mins = Math.floor(state.time / 60);
    const secs = Math.floor(state.time % 60);
    write(clockText(`${mins}:${String(secs).padStart(2, '0')}`), FIELD.width - 24, 18, 26, PALETTE.text, 'right', 'top');
  }

  /** The ALARM gauge, bottom centre: the eye that watches the thief. It
   * fills from every guard and every camera that spots him, and the words
   * under it say what to do about it. */
  function paintAlarmGauge(state) {
    const w = 300;
    const x = (FIELD.width - w) / 2;
    const y = FIELD.height - 44;
    const mood = state.alarm ? PALETTE.danger
      : state.detection > 0.35 ? PALETTE.gold : PALETTE.muted;
    write('ALARM', FIELD.width / 2, y - 26, 18, mood, 'center', 'top');
    ctx.fillStyle = '#11141d';
    ctx.fillRect(x, y, w, 18);
    ctx.fillStyle = state.detection > 0.7 ? PALETTE.danger
      : state.detection > 0.35 ? PALETTE.gold : PALETTE.safe;
    ctx.fillRect(x, y, w * state.detection, 18);
    ctx.strokeStyle = PALETTE.panelEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, 18);
    const verdict = state.alarm ? 'SPOTTED — RUN!'
      : state.detection > 0.35 ? 'SEEN — HIDE!' : 'UNSEEN';
    write(verdict, FIELD.width / 2, y + 24, 16, state.alarm ? PALETTE.danger : PALETTE.muted, 'center', 'top');
  }

  /** Lives bottom left, level name above them, cameras alive and coins
   * pocketed bottom right, the corner map top right. */
  function paintHud(state) {
    paintTopBar(state);
    paintMinimap(state);
    for (let life = 0; life < LIVES; life += 1) {
      disc(30 + life * 30, FIELD.height - 28, 9, life < state.lives ? PALETTE.player : '#3a4152');
    }
    paintAlarmGauge(state);
    write(LEVELS[state.levelIndex].name, 24, FIELD.height - 56, 18, PALETTE.muted, 'left', 'top');
    const liveCams = state.cameras.filter((c) => !c.disabled).length;
    write(`CAM ${liveCams}/${state.cameras.length}`, FIELD.width - 24, FIELD.height - 56, 18,
      liveCams === 0 ? PALETTE.safe : PALETTE.camera, 'right', 'top');
    if (state.coins.length > 0) {
      write(`◆ ${state.coinsTaken}`, FIELD.width - 24, FIELD.height - 28, 18, PALETTE.gold, 'right', 'top');
    }
  }

  /** A centred card for the screens that are not the game itself: a title,
   * a few lines, and a prompt at the bottom. */
  function paintCard(title, lines, prompt) {
    const height = CARD.head + lines.length * CARD.row + CARD.foot;
    const x = (FIELD.width - CARD.width) / 2;
    const y = (FIELD.height - height) / 2;
    ctx.fillStyle = PALETTE.panel;
    ctx.fillRect(x, y, CARD.width, height);
    ctx.strokeStyle = PALETTE.panelEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, CARD.width, height);
    write(title, FIELD.width / 2, y + 74, 46, PALETTE.text);
    for (let index = 0; index < lines.length; index += 1) {
      write(lines[index], FIELD.width / 2, y + CARD.head + index * CARD.row, 21, PALETTE.muted);
    }
    write(prompt, FIELD.width / 2, y + height - 38, 23, PALETTE.gold);
  }

  const TITLE_LINES = [
    'Slip through the museum at night. Crack the vault, grab the loot.',
    'Reach the green EXIT — the amber cones are guards, the red ones cameras.',
    'Cut a power box to kill the nearest camera. Loot is loud: it wakes the room.',
    'Move: WASD / arrows, or click where to walk.',
    'Crouch: hold Shift (slower, harder to spot).  Pause: P.',
    '',
  ];
  const PAUSED_LINES = ['The guards will wait for you.'];
  const OVER_LINES = ['', ''];
  const LEVEL_LINES = ['', '', ''];

  /** Paint one frame: the room, the night over it, the door, the loot, the
   * pickups, the watchers, the thief — then the HUD, or a card over it all. */
  function draw(state, screen, best) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.backdrop;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    paintRoom(state.level);
    paintNight(state);
    paintDoor(state);
    paintVault(state);
    paintCoins(state);
    paintCells(state);
    paintCameras(state);
    paintGuards(state);
    paintThief(state);
    if (screen === SCREEN_TITLE) {
      TITLE_LINES[5] = bestText(best);
      paintCard('VAULT BREAKER', TITLE_LINES, 'Press Space or click to start');
      return;
    }
    paintHud(state);
    if (screen === SCREEN_PAUSED) {
      paintCard('Paused', PAUSED_LINES, 'Press P to resume');
    } else if (screen === SCREEN_LEVEL) {
      LEVEL_LINES[0] = `${state.level.name} cleared — ghost bonus ${state.ghost ? 'kept' : 'lost'}.`;
      LEVEL_LINES[1] = totalText(state.score);
      LEVEL_LINES[2] = bestText(best);
      paintCard('Vault cracked!', LEVEL_LINES, 'Press Space for the next job');
    } else if (screen === SCREEN_OVER) {
      OVER_LINES[0] = totalText(state.score);
      OVER_LINES[1] = bestText(best);
      paintCard('Caught!', OVER_LINES, 'Press Space to try again');
    } else if (screen === SCREEN_WIN) {
      LEVEL_LINES[0] = 'Every vault cracked. Every job done unseen.';
      LEVEL_LINES[1] = totalText(state.score);
      LEVEL_LINES[2] = bestText(best);
      paintCard('Clean getaway!', LEVEL_LINES, 'Press Space to play again');
    }
  }

  fitView();
  window.addEventListener('resize', fitView);
  return { draw, toField };
}
