import type { CSSProperties } from "react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Notifications in the app's own look. Sonner paints its toasts from its own CSS variables (a plain black or white box), which
 * beats any Tailwind class we put on them, so the fix is to point those variables at the app's tokens: the popover surface and
 * border, the body font and corner radius, and a tinted background plus border per kind (green success, gold warning, red error).
 * The tokens switch with the light and dark theme on their own, and `ThemedToaster` still tells Sonner which theme is active.
 */
const tint = (token: string, amount: number) => `color-mix(in oklab, var(${token}) ${amount}%, var(--popover))`;
const edge = (token: string) => `color-mix(in oklab, var(${token}) 55%, var(--border))`;

const themeVars = {
  "--normal-bg": "var(--popover)",
  "--normal-text": "var(--popover-foreground)",
  "--normal-border": "var(--border)",
  "--success-bg": tint("--success", 14),
  "--success-text": "var(--popover-foreground)",
  "--success-border": edge("--success"),
  "--warning-bg": tint("--gold", 16),
  "--warning-text": "var(--popover-foreground)",
  "--warning-border": edge("--gold"),
  "--error-bg": tint("--destructive", 14),
  "--error-text": "var(--popover-foreground)",
  "--error-border": edge("--destructive"),
  "--info-bg": tint("--gold", 10),
  "--info-text": "var(--popover-foreground)",
  "--info-border": edge("--gold"),
  "--border-radius": "var(--radius)",
  fontFamily: "var(--font-sans)",
} as CSSProperties;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      richColors
      style={themeVars}
      toastOptions={{
        classNames: {
          toast: "group toast shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
