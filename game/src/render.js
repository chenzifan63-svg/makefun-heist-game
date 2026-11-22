// Drawing only: the world's state and the current screen in, pixels out.
// The 1280x720 playfield is scaled to fit the window and centred, the
// margin filled with the backdrop colour. A watcher's vision cone is drawn
// as a fan of short rays, so walls and crates cut it off exactly where they
// block the watcher's sight — cover you can read at a glance. Guard cones
// are yellow, camera cones are red-orange: the two dangers read apart.
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

const PANEL = { width: 640, top: 150, line: 32, bottom: 76 };

function cachedLabel(prefix) {
  let value = -1;
  let text = '';
  return function label(next) {
    if (next !== value) {
      value = next;
      text = prefix + next;
    }
    return text;
  };
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const scoreLabel = cachedLabel('Score ');
  const levelLabel = cachedLabel('Level ');
  const lootLabel = cachedLabel('');
  const timeLabel = cachedLabel('');
  const finalLabel = cachedLabel('Score ');
  const bestLabel = cachedLabel('Best ');

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  /** Client pixels (a mouse click) back into playfield pixels. */
  function toField(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    return {
      x: ((clientX - rect.left) * ratio - view.x) / view.scale,
      y: ((clientY - rect.top) * ratio - view.y) / view.scale,
    };
  }

  const fonts = new Map();
  function text(value, x, y, size, color, align) {
    if (!fonts.has(size)) fonts.set(size, `${size}px ${FONT}`);
    context.font = fonts.get(size);
    context.fillStyle = color;
    context.textAlign = align;
    context.fillText(value, x, y);
  }

  function drawFloor(level) {
    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 16; col += 1) {
        const tile = tileAt(level, col, row);
        const x = col * TILE;
        const y = row * TILE;
        if (tile === '#') {
          context.fillStyle = PALETTE.wall;
          context.fillRect(x, y, TILE, TILE);
          context.fillStyle = PALETTE.wallTop;
          context.fillRect(x, y, TILE, 6);
          continue;
        }
        context.fillStyle = (col + row) % 2 === 0 ? PALETTE.floor : PALETTE.floorAlt;
        context.fillRect(x, y, TILE, TILE);
        context.strokeStyle = PALETTE.floorEdge;
        context.lineWidth = 1;
        context.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        if (tileIsShadow(tile)) {
          context.fillStyle = PALETTE.shadowFloor;
          context.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
          context.strokeStyle = 'rgba(126, 240, 193, 0.25)';
          context.setLineDash([6, 6]);
          context.strokeRect(x + 6.5, y + 6.5, TILE - 13, TILE - 13);
          context.setLineDash([]);
        }
        if (tile === 'C') {
          context.fillStyle = PALETTE.crate;
          context.fillRect(x + 8, y + 8, TILE - 16, TILE - 16);
          context.fillStyle = PALETTE.crateTop;
          context.fillRect(x + 8, y + 8, TILE - 16, 10);
          context.strokeStyle = PALETTE.crateEdge;
          context.lineWidth = 2;
          context.strokeRect(x + 8, y + 8, TILE - 16, TILE - 16);
          context.beginPath();
          context.moveTo(x + 8, y + 8);
          context.lineTo(x + TILE - 8, y + TILE - 8);
          context.moveTo(x + TILE - 8, y + 8);
          context.lineTo(x + 8, y + TILE - 8);
          context.stroke();
        }
      }
    }
  }

  function drawConeFan(x, y, angle, halfAngle, range, level, fill, edge) {
    const steps = 16;
    context.beginPath();
    context.moveTo(x, y);
    for (let i = 0; i <= steps; i += 1) {
      const a = angle - halfAngle + (2 * halfAngle * i) / steps;
      const dist = rayDistance(x, y, a, range, level);
      context.lineTo(x + Math.cos(a) * dist, y + Math.sin(a) * dist);
    }
    context.closePath();
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = edge;
    context.lineWidth = 1.5;
    context.stroke();
  }

  function drawGuards(state) {
    for (const guard of state.guards) {
      const alerted = guard.state === STATE_CHASE || guard.detection >= 1;
      drawConeFan(guard.x, guard.y, guard.angle, GUARD.coneHalfAngle, GUARD.coneRange,
        state.level, alerted ? PALETTE.coneAlert : PALETTE.cone, PALETTE.coneEdge);
    }
    for (const guard of state.guards) {
      const alerted = guard.state === STATE_CHASE;
      context.beginPath();
      context.arc(guard.x, guard.y, 15, 0, Math.PI * 2);
      context.fillStyle = alerted ? PALETTE.guardChase : PALETTE.guard;
      context.fill();
      context.lineWidth = 3;
      context.strokeStyle = '#2b0d0b';
      context.stroke();
      // Facing tick, so the guard's direction reads even without the cone.
      context.beginPath();
      context.moveTo(guard.x + Math.cos(guard.angle) * 15, guard.y + Math.sin(guard.angle) * 15);
      context.lineTo(guard.x + Math.cos(guard.angle) * 26, guard.y + Math.sin(guard.angle) * 26);
      context.lineWidth = 4;
      context.strokeStyle = '#ffd6d3';
      context.stroke();
      // Detection ring: fills as this guard spots the thief.
      if (guard.detection > 0.02) {
        context.beginPath();
        context.arc(guard.x, guard.y, 21, -Math.PI / 2, -Math.PI / 2 + guard.detection * Math.PI * 2);
        context.lineWidth = 4;
        context.strokeStyle = guard.detection > 0.7 ? PALETTE.danger : PALETTE.gold;
        context.stroke();
      }
      // A runner wears a gold ring: same eyes, quicker feet.
      if (guard.runner) {
        context.beginPath();
        context.arc(guard.x, guard.y, 20, 0, Math.PI * 2);
        context.lineWidth = 2;
        context.strokeStyle = PALETTE.gold;
        context.stroke();
      }
    }
  }

  function drawCameras(state) {
    for (const camera of state.cameras) {
      if (camera.disabled) continue;
      const alerted = camera.detection >= 1;
      drawConeFan(camera.x, camera.y, camera.angle, CAMERA.coneHalfAngle, camera.range,
        state.level, alerted ? PALETTE.coneAlert : PALETTE.cameraCone, PALETTE.cameraConeEdge);
    }
    for (const camera of state.cameras) {
      // The camera body: a small dome on its wall, with a lens that points
      // where the cone points. A dead camera is grey and lens-less.
      context.beginPath();
      context.arc(camera.x, camera.y, 11, 0, Math.PI * 2);
      context.fillStyle = camera.disabled ? PALETTE.cameraOff : PALETTE.camera;
      context.fill();
      context.lineWidth = 3;
      context.strokeStyle = '#2b0d0b';
      context.stroke();
      if (!camera.disabled) {
        context.beginPath();
        context.moveTo(camera.x + Math.cos(camera.angle) * 11, camera.y + Math.sin(camera.angle) * 11);
        context.lineTo(camera.x + Math.cos(camera.angle) * 20, camera.y + Math.sin(camera.angle) * 20);
        context.lineWidth = 4;
        context.strokeStyle = '#ffd9cd';
        context.stroke();
        // A red blink while the camera is filling its detection.
        if (camera.detection > 0.02) {
          context.beginPath();
          context.arc(camera.x, camera.y, 16, -Math.PI / 2, -Math.PI / 2 + camera.detection * Math.PI * 2);
          context.lineWidth = 3;
          context.strokeStyle = camera.detection > 0.7 ? PALETTE.danger : PALETTE.camera;
          context.stroke();
        }
      } else {
        // Dead camera: a grey cross where the lens was.
        context.beginPath();
        context.moveTo(camera.x - 6, camera.y - 6);
        context.lineTo(camera.x + 6, camera.y + 6);
        context.moveTo(camera.x + 6, camera.y - 6);
        context.lineTo(camera.x - 6, camera.y + 6);
        context.lineWidth = 3;
        context.strokeStyle = '#2b0d0b';
        context.stroke();
      }
    }
  }

  /** The loot: a gold vault door with a dial, glowing until it is taken. */
  function drawLoot(state) {
    const loot = state.loot;
    if (loot.taken) return;
    const pulse = 0.7 + 0.3 * Math.sin(state.time * 4 + loot.x);
    context.save();
    context.globalAlpha = pulse;
    context.fillStyle = PALETTE.lootGlow;
    context.beginPath();
    context.arc(loot.x, loot.y, 40, 0, Math.PI * 2);
    context.fill();
    context.restore();
    context.fillStyle = PALETTE.loot;
    context.fillRect(loot.x - 20, loot.y - 20, 40, 40);
    context.strokeStyle = '#6b5312';
    context.lineWidth = 3;
    context.strokeRect(loot.x - 20, loot.y - 20, 40, 40);
    context.beginPath();
    context.arc(loot.x, loot.y, 9, 0, Math.PI * 2);
    context.fillStyle = '#6b5312';
    context.fill();
    context.beginPath();
    context.arc(loot.x, loot.y, 4, 0, Math.PI * 2);
    context.fillStyle = PALETTE.loot;
    context.fill();
    context.fillStyle = '#0b0e14';
    context.font = `bold 15px ${FONT}`;
    context.textAlign = 'center';
    context.fillText('LOOT', loot.x, loot.y + 38);
  }

  /** Power boxes: green panels — walk over one to kill the nearest camera. */
  function drawPowerboxes(state) {
    for (const box of state.powerboxes) {
      if (box.taken) continue;
      const pulse = 0.7 + 0.3 * Math.sin(state.time * 4 + box.x);
      context.save();
      context.globalAlpha = pulse;
      context.fillStyle = PALETTE.powerbox;
      context.fillRect(box.x - 12, box.y - 12, 24, 24);
      context.restore();
      context.strokeStyle = '#0e3d29';
      context.lineWidth = 2;
      context.strokeRect(box.x - 12, box.y - 12, 24, 24);
      // A lightning bolt on the panel.
      context.beginPath();
      context.moveTo(box.x + 2, box.y - 8);
      context.lineTo(box.x - 5, box.y + 1);
      context.lineTo(box.x, box.y + 1);
      context.lineTo(box.x - 2, box.y + 8);
      context.lineTo(box.x + 5, box.y - 1);
      context.lineTo(box.x, box.y - 1);
      context.closePath();
      context.fillStyle = '#0e3d29';
      context.fill();
    }
  }

  /** Coins: small gold dots, a bonus for a risky detour off the route. */
  function drawCoins(state) {
    for (const coin of state.coins) {
      if (coin.taken) continue;
      const pulse = 0.75 + 0.25 * Math.sin(state.time * 5 + coin.y);
      context.save();
      context.globalAlpha = pulse;
      context.fillStyle = PALETTE.coin;
      context.beginPath();
      context.arc(coin.x, coin.y, 8, 0, Math.PI * 2);
      context.fill();
      context.restore();
      context.lineWidth = 2;
      context.strokeStyle = '#6b5312';
      context.beginPath();
      context.arc(coin.x, coin.y, 8, 0, Math.PI * 2);
      context.stroke();
    }
  }

  function drawExit(state) {
    const exit = state.exit;
    const pulse = exit.open ? 0.75 + 0.25 * Math.sin(state.time * 5) : 0.4;
    context.save();
    context.globalAlpha = pulse;
    context.fillStyle = PALETTE.exitGlow;
    context.beginPath();
    context.arc(exit.x, exit.y, exit.open ? 52 : 34, 0, Math.PI * 2);
    context.fill();
    context.restore();
    if (exit.open) {
      // The open getaway door calls to the thief: a wide pulsing ring.
      context.save();
      context.globalAlpha = 0.5 + 0.3 * Math.sin(state.time * 5);
      context.strokeStyle = PALETTE.exit;
      context.lineWidth = 3;
      context.setLineDash([12, 10]);
      context.lineDashOffset = -state.time * 24;
      context.beginPath();
      context.arc(exit.x, exit.y, 46, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
    context.fillStyle = exit.open ? PALETTE.exit : '#7d8aa0';
    context.fillRect(exit.x - 18, exit.y - 22, 36, 44);
    context.fillStyle = '#0b0e14';
    context.font = `bold 22px ${FONT}`;
    context.textAlign = 'center';
    // The label names a locked door. An open door needs none: its green
    // glow and pulsing ring say "go here", and the thief standing on it
    // would cover the word anyway. The getaway door sits on the bottom
    // row, so a locked label goes above it — below it would collide with
    // the CAM readout in the HUD corner.
    if (!exit.open) {
      context.fillText('EXIT', exit.x, exit.y > 560 ? exit.y - 52 : exit.y + 58);
    }
    if (!exit.open) {
      context.fillStyle = PALETTE.muted;
      context.font = `16px ${FONT}`;
      context.fillText('LOCKED', exit.x, exit.y - 28);
    }
  }

  function drawPlayer(state) {
    const player = state.player;
    const blink = state.caughtFlash > 0 && Math.floor(state.caughtFlash * 10) % 2 === 0;
    if (blink) return;
    context.beginPath();
    context.arc(player.x, player.y, player.crouching ? 11 : 14, 0, Math.PI * 2);
    context.fillStyle = player.crouching ? PALETTE.playerCrouch : PALETTE.player;
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = '#3a2a05';
    context.stroke();
    // Facing wedge.
    context.beginPath();
    context.moveTo(player.x + Math.cos(player.angle) * 10, player.y + Math.sin(player.angle) * 10);
    context.lineTo(player.x + Math.cos(player.angle) * 22, player.y + Math.sin(player.angle) * 22);
    context.lineWidth = 4;
    context.strokeStyle = '#fff3d6';
    context.stroke();
    if (player.crouching) {
      context.beginPath();
      context.arc(player.x, player.y, 19, 0, Math.PI * 2);
      context.setLineDash([4, 4]);
      context.lineWidth = 2;
      context.strokeStyle = PALETTE.playerCrouch;
      context.stroke();
      context.setLineDash([]);
    }
  }

  function drawHud(state) {
    context.textBaseline = 'top';
    text(scoreLabel(state.score), 24, 18, 26, PALETTE.text, 'left');
    text(levelLabel(state.levelIndex + 1), FIELD.width / 2 - 130, 18, 26, PALETTE.text, 'center');
    text(lootLabel(state.lootTaken ? 'LOOT ✓' : 'LOOT …'), FIELD.width / 2 + 60, 18, 26,
      state.lootTaken ? PALETTE.loot : PALETTE.muted, 'center');
    const mins = Math.floor(state.time / 60);
    const secs = Math.floor(state.time % 60);
    text(timeLabel(`${mins}:${String(secs).padStart(2, '0')}`), FIELD.width - 24, 18, 26, PALETTE.text, 'right');
    // Lives, bottom left.
    for (let life = 0; life < LIVES; life += 1) {
      context.beginPath();
      context.arc(30 + life * 30, FIELD.height - 28, 9, 0, Math.PI * 2);
      context.fillStyle = life < state.lives ? PALETTE.player : '#3a4152';
      context.fill();
    }
    // The ALARM meter, bottom centre: the eye that watches you. It fills
    // from every guard and every camera that spots the thief.
    const w = 300;
    const x = (FIELD.width - w) / 2;
    const y = FIELD.height - 44;
    text('ALARM', FIELD.width / 2, y - 26, 18,
      state.alarm ? PALETTE.danger : state.detection > 0.35 ? PALETTE.gold : PALETTE.muted, 'center');
    context.fillStyle = '#11141d';
    context.fillRect(x, y, w, 18);
    context.fillStyle = state.detection > 0.7 ? PALETTE.danger : state.detection > 0.35 ? PALETTE.gold : PALETTE.safe;
    context.fillRect(x, y, w * state.detection, 18);
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    context.strokeRect(x, y, w, 18);
    text(state.alarm ? 'SPOTTED — RUN!' : state.detection > 0.35 ? 'SEEN — HIDE!' : 'UNSEEN',
      FIELD.width / 2, y + 24, 16, state.alarm ? PALETTE.danger : PALETTE.muted, 'center');
    text(LEVELS[state.levelIndex].name, 24, FIELD.height - 56, 18, PALETTE.muted, 'left');
    // Cameras left alive, bottom right — and coins pocketed.
    const liveCams = state.cameras.filter((c) => !c.disabled).length;
    text(`CAM ${liveCams}/${state.cameras.length}`, FIELD.width - 24, FIELD.height - 56, 18,
      liveCams === 0 ? PALETTE.safe : PALETTE.camera, 'right');
    if (state.coins.length > 0) {
      text(`◆ ${state.coinsTaken}`, FIELD.width - 24, FIELD.height - 28, 18, PALETTE.gold, 'right');
    }
  }

  function drawPanel(title, lines, prompt) {
    const height = PANEL.top + lines.length * PANEL.line + PANEL.bottom;
    const x = (FIELD.width - PANEL.width) / 2;
    const y = (FIELD.height - height) / 2;
    context.fillStyle = PALETTE.panel;
    context.fillRect(x, y, PANEL.width, height);
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    context.strokeRect(x, y, PANEL.width, height);
    context.textBaseline = 'alphabetic';
    text(title, FIELD.width / 2, y + 74, 46, PALETTE.text, 'center');
    for (let index = 0; index < lines.length; index += 1) {
      text(lines[index], FIELD.width / 2, y + PANEL.top + index * PANEL.line, 21, PALETTE.muted, 'center');
    }
    text(prompt, FIELD.width / 2, y + height - 38, 23, PALETTE.gold, 'center');
  }

  const TITLE_LINES = [
    'Slip through the museum at night. Crack the vault, grab the loot.',
    'Reach the green EXIT — the yellow cones are guards, the red ones cameras.',
    'Cut a power box to kill the nearest camera. Loot is loud: it wakes the room.',
    'Move: WASD / arrows, or click where to walk.',
    'Crouch: hold Shift (slower, harder to spot).  Pause: P.',
    '',
  ];
  const PAUSED_LINES = ['The guards will wait for you.'];
  const OVER_LINES = ['', ''];
  const LEVEL_LINES = ['', '', ''];

  /** Paint one frame: the floor, the exit, the loot, the watchers, the thief, then HUD or a panel. */
  function draw(state, screen, best) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    drawFloor(state.level);
    drawExit(state);
    drawLoot(state);
    drawCoins(state);
    drawPowerboxes(state);
    drawCameras(state);
    drawGuards(state);
    drawPlayer(state);
    if (screen === SCREEN_TITLE) {
      TITLE_LINES[5] = bestLabel(best);
      drawPanel('VAULT BREAKER', TITLE_LINES, 'Press Space or click to start');
      return;
    }
    drawHud(state);
    if (screen === SCREEN_PAUSED) drawPanel('Paused', PAUSED_LINES, 'Press P to resume');
    else if (screen === SCREEN_LEVEL) {
      LEVEL_LINES[0] = `${state.level.name} cleared — ghost bonus ${state.ghost ? 'kept' : 'lost'}.`;
      LEVEL_LINES[1] = finalLabel(state.score);
      LEVEL_LINES[2] = bestLabel(best);
      drawPanel('Vault cracked!', LEVEL_LINES, 'Press Space for the next job');
    } else if (screen === SCREEN_OVER) {
      OVER_LINES[0] = finalLabel(state.score);
      OVER_LINES[1] = bestLabel(best);
      drawPanel('Caught!', OVER_LINES, 'Press Space to try again');
    } else if (screen === SCREEN_WIN) {
      LEVEL_LINES[0] = 'Every vault cracked. Every job done unseen.';
      LEVEL_LINES[1] = finalLabel(state.score);
      LEVEL_LINES[2] = bestLabel(best);
      drawPanel('Clean getaway!', LEVEL_LINES, 'Press Space to play again');
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, toField };
}
