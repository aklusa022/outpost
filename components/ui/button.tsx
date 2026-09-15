import type { ComponentProps, ReactNode } from "react";
import { Button as KumoButton, type ButtonProps as KumoButtonProps } from "@cloudflare/kumo";

type TextSize = "default" | "xs" | "sm" | "lg";
type IconSize = "icon" | "icon-xs" | "icon-sm" | "icon-lg";
type LegacySize = TextSize | IconSize;
type LegacyVariant = "default" | "outline" | "secondary" | "ghost" | "destructive";

const SIZE_MAP: Record<LegacySize, { size: "xs" | "sm" | "base" | "lg"; shape?: "square" }> = {
  default: { size: "base" },
  xs: { size: "xs" },
  sm: { size: "sm" },
  lg: { size: "lg" },
  icon: { size: "base", shape: "square" },
  "icon-xs": { size: "xs", shape: "square" },
  "icon-sm": { size: "sm", shape: "square" },
  "icon-lg": { size: "lg", shape: "square" },
};

const VARIANT_MAP: Record<LegacyVariant, "primary" | "outline" | "secondary" | "ghost" | "destructive"> = {
  default: "primary",
  outline: "outline",
  secondary: "secondary",
  ghost: "ghost",
  destructive: "destructive",
};

type ButtonBaseOwnProps = Omit<ComponentProps<"button">, "children" | "title"> & {
  children?: ReactNode;
  icon?: ReactNode;
  loading?: boolean;
  variant?: LegacyVariant;
};

// Mirrors Kumo's own IconOnlyButtonAccessibleNameProps: an icon-only button
// must carry an aria-label, an aria-labelledby, or a title, so screen readers
// have something to announce.
type AccessibleNameProps =
  | { "aria-label": string; "aria-labelledby"?: string; title?: never }
  | { "aria-label"?: string; "aria-labelledby": string; title?: never }
  | { title: string | number; "aria-label"?: string; "aria-labelledby"?: string };

type ButtonWithTextOwnProps = ButtonBaseOwnProps & {
  size?: TextSize;
  title?: string;
};

type ButtonIconOnlyOwnProps = ButtonBaseOwnProps &
  AccessibleNameProps & {
    size: IconSize;
  };

type ButtonOwnProps = ButtonWithTextOwnProps | ButtonIconOnlyOwnProps;

// Thin compatibility layer over Kumo's Button: this app's call sites were
// written against shadcn's variant/size vocabulary (variant="default" being
// a filled primary CTA, size="icon" being a square icon-only button). Rather
// than touch every call site, translate that vocabulary onto Kumo's own
// (variant="primary", shape="square") so Kumo's real Button renders
// everywhere with the same visual behavior callers already expect.
//
// The size/aria-label union above mirrors Kumo's own ButtonProps split, so
// TypeScript enforces an accessible name on every size="icon*" call site.
// Primary/destructive buttons keep Kumo's own "emphasis" treatment (lighter
// fill, ring, gradient overlay that shifts on hover), computed by Kumo from
// `--color-kumo-brand` / `--color-kumo-danger`, which globals.css points at
// Outpost's blurple and red.
function Button(props: ButtonOwnProps) {
  const { variant = "default", size = "default", ...rest } = props;
  const { size: kumoSize, shape } = SIZE_MAP[size];
  const kumoProps = {
    ...rest,
    variant: VARIANT_MAP[variant],
    size: kumoSize,
    shape,
  } as KumoButtonProps;
  return <KumoButton {...kumoProps} />;
}

export { Button };
