"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export default function ServerIndexPage({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = use(params);
  const id = serverId as Id<"servers">;
  const channels = useQuery(api.channels.listChannels, { serverId: id });
  const categories = useQuery(api.categories.listCategories, { serverId: id });
  const router = useRouter();

  useEffect(() => {
    if (!channels || !categories) return;
    // Land on the first channel of the first category — the same order the
    // sidebar shows (channel positions are per category).
    const categoryRank = new Map(categories.map((c) => [c._id, c.position]));
    const first = [...channels].sort(
      (a, b) =>
        (categoryRank.get(a.categoryId) ?? Infinity) - (categoryRank.get(b.categoryId) ?? Infinity) ||
        a.position - b.position,
    )[0];
    if (first) {
      router.replace(`/app/servers/${id}/channels/${first._id}`);
    }
  }, [channels, categories, id, router]);

  return null;
}
