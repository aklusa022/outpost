/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as attachments from "../attachments.js";
import type * as categories from "../categories.js";
import type * as channelCascade from "../channelCascade.js";
import type * as channelPermissions from "../channelPermissions.js";
import type * as channels from "../channels.js";
import type * as chatLimits from "../chatLimits.js";
import type * as crons from "../crons.js";
import type * as dms from "../dms.js";
import type * as friends from "../friends.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as messages from "../messages.js";
import type * as permissionFlags from "../permissionFlags.js";
import type * as permissions from "../permissions.js";
import type * as presence from "../presence.js";
import type * as r2 from "../r2.js";
import type * as roles from "../roles.js";
import type * as servers from "../servers.js";
import type * as users from "../users.js";
import type * as voiceChannels from "../voiceChannels.js";
import type * as webhookKeys from "../webhookKeys.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  attachments: typeof attachments;
  categories: typeof categories;
  channelCascade: typeof channelCascade;
  channelPermissions: typeof channelPermissions;
  channels: typeof channels;
  chatLimits: typeof chatLimits;
  crons: typeof crons;
  dms: typeof dms;
  friends: typeof friends;
  http: typeof http;
  invites: typeof invites;
  messages: typeof messages;
  permissionFlags: typeof permissionFlags;
  permissions: typeof permissions;
  presence: typeof presence;
  r2: typeof r2;
  roles: typeof roles;
  servers: typeof servers;
  users: typeof users;
  voiceChannels: typeof voiceChannels;
  webhookKeys: typeof webhookKeys;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
  r2: import("@convex-dev/r2/_generated/component.js").ComponentApi<"r2">;
};
