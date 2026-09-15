"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "@/lib/toast";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Dialog, Input } from "@cloudflare/kumo";
import { Button } from "@/components/ui/button";
import { FolderPlusIcon } from "@phosphor-icons/react";

export function CreateCategoryDialog({ serverId }: { serverId: Id<"servers"> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const createCategory = useMutation(api.categories.createCategory);

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await createCategory({ serverId, name: trimmed });
      setName("");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create category");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger render={<Button size="sm" variant="secondary" className="gap-1.5" />}>
        <FolderPlusIcon className="h-4 w-4" />
        New Category
      </Dialog.Trigger>
      <Dialog size="sm" className="p-6">
        <Dialog.Title className="mb-4 text-lg font-semibold">Create category</Dialog.Title>
        <Input
          label="Category name"
          id="category-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="NEW CATEGORY"
        />
        <div className="mt-6 flex justify-end">
          <Button disabled={!name.trim() || submitting} onClick={handleSubmit}>
            Create
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}
