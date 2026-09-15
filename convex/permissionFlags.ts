// Pure permission constants and helpers, safe to import from browser code.
// Anything that needs `./_generated/server` lives in `./permissions.ts`;
// importing that module client-side drags Convex's server runtime into the
// browser bundle ("Convex functions should not be imported in the browser").

// Permission bitmask flags.
export const PERMISSIONS = {
  VIEW_CHANNELS: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  MANAGE_MESSAGES: 1 << 2,
  CREATE_INVITE: 1 << 3,
  MANAGE_CHANNELS: 1 << 4,
  MANAGE_ROLES: 1 << 5,
  MANAGE_SERVER: 1 << 6,
  KICK_MEMBERS: 1 << 7,
  BAN_MEMBERS: 1 << 8,
  ADMINISTRATOR: 1 << 9,
  CONNECT: 1 << 10,
  ATTACH_FILES: 1 << 11,
} as const;

export type PermissionFlag = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS).reduce(
  (acc, bit) => acc | bit,
  0,
);

export const DEFAULT_ROLE_PERMISSIONS =
  PERMISSIONS.VIEW_CHANNELS |
  PERMISSIONS.SEND_MESSAGES |
  PERMISSIONS.CREATE_INVITE |
  PERMISSIONS.CONNECT |
  PERMISSIONS.ATTACH_FILES;

export function hasPermission(bitmask: number, flag: PermissionFlag): boolean {
  return (bitmask & PERMISSIONS.ADMINISTRATOR) !== 0 || (bitmask & flag) !== 0;
}
