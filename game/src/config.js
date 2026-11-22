// Vault Breaker — every tuning number and colour in one place.
// The playfield is a fixed 1280x720 logical area; the renderer scales it
// to fit the window, so no rule below depends on the screen size.
export const FIELD = { width: 1280, height: 720 };
export const TILE = 80;
export const COLS = 16;
export const ROWS = 9;

/** The simulation's fixed step, in seconds: 60 updates a second. */
export const STEP = 1 / 60;

export const PLAYER = {
  radius: 14,
  walkSpeed: 170,
  crouchSpeed: 90,
  /** How close a guard must be to grab the thief. */
  catchRadius: 28,
};

export const GUARD = {
  /** Half-angle of a vision cone, in radians. */
  coneHalfAngle: 0.62,
  coneRange: 250,
  /** Detection fills 0..1; these are the fill rates per second. */
  detectClose: 1.7,
  detectFar: 0.8,
  detectDecay: 0.55,
  crouchFactor: 0.45,
  shadowFactor: 0.5,
  chaseSpeedFactor: 1.55,
  /** Seconds a guard keeps chasing after losing sight. */
  chaseMemory: 2.5,
};

export const CAMERA = {
  /** Half-angle of a camera's vision cone, in radians. */
  coneHalfAngle: 0.5,
  coneRange: 260,
  /** Detection fills 0..1; a camera spots a little slower than a guard. */
  detectClose: 1.4,
  detectFar: 0.65,
  detectDecay: 0.5,
  crouchFactor: 0.5,
  shadowFactor: 0.5,
};

export const LIVES = 3;
export const POINTS = { loot: 150, level: 250, ghost: 150, coin: 25, powerbox: 25 };

export const PALETTE = {
  backdrop: '#0d0f1a',
  floor: '#262c40',
  floorAlt: '#222838',
  floorEdge: '#353d57',
  shadowFloor: '#1a2033',
  wall: '#454f6e',
  wallTop: '#565f7d',
  crate: '#6e5732',
  crateTop: '#8a6f42',
  crateEdge: '#3e3018',
  player: '#ffc857',
  playerCrouch: '#e8a93d',
  guard: '#e5534b',
  guardChase: '#ff2e2e',
  cone: 'rgba(255, 214, 90, 0.34)',
  coneAlert: 'rgba(255, 60, 50, 0.42)',
  coneEdge: 'rgba(255, 214, 90, 0.7)',
  camera: '#ff7a59',
  cameraCone: 'rgba(255, 122, 89, 0.30)',
  cameraConeEdge: 'rgba(255, 122, 89, 0.7)',
  cameraOff: '#5a6274',
  loot: '#ffd94d',
  lootGlow: 'rgba(255, 217, 77, 0.22)',
  coin: '#f2c94c',
  powerbox: '#7ef0c1',
  exit: '#58d68d',
  exitGlow: 'rgba(88, 214, 141, 0.25)',
  text: '#eef1f5',
  muted: '#9aa3b5',
  gold: '#f2c94c',
  panel: '#141826',
  panelEdge: '#2c3446',
  danger: '#ff5a4e',
  safe: '#58d68d',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'vault-breaker.best';
