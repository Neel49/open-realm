// =====================================================================
// Game Configuration
// =====================================================================

export const WORLD = {
    CHUNK_SIZE: 40,
    RENDER_DIST: 2,
};

export const PHYSICS = {
    GRAVITY: -20,
    THROW_FORCE: 18,
};

export const PLAYER = {
    HEIGHT: 1.7,
    RADIUS: 0.35,
    WALK_SPEED: 5,
    RUN_SPEED: 11,
    JUMP_VEL: 8,
};

export const COLORS = {
    BUILDING: [0xc4956a, 0xa8bdc4, 0xd4c5a0, 0x8b9e8b, 0xc49e9e, 0xb0a4c4, 0xd4b896, 0x9eaab0, 0xc4a882, 0xa0b4a0],
    SKY: 0x1e1040,
    ROAD: 0x2a2a30,
    SIDEWALK: 0x888888,
    GRASS: 0x2d6b30,
    WINDOW: 0x334466,
    WINDOW_LIT: 0xffeeaa,
};

export const API_BASE = '';  // Same origin
