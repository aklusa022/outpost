"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { hasPermission, PermissionFlag } from "@/convex/permissionFlags";

export function useServerPermissions(serverId: Id<"servers">) {
  const data = useQuery(api.servers.getMyPermissions, { serverId });
  return {
    isLoading: data === undefined,
    isOwner: data?.isOwner ?? false,
    can: (flag: PermissionFlag) =>
      data !== undefined && data !== null && hasPermission(data.bitmask, flag),
  };
}
