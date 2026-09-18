import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "dark" | "light";

function apply(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = localStorage.getItem("ds-theme") as Theme | null;
    const initial: Theme = stored ?? "dark";
    setTheme(initial);
    apply(initial);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    apply(next);
    localStorage.setItem("ds-theme", next);
  };

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="relative flex h-9 w-[4.75rem] items-center rounded-full border border-border bg-muted px-1 transition-colors"
    >
      <span
        className="absolute h-7 w-7 rounded-full bg-primary transition-transform duration-300"
        style={{ transform: theme === "dark" ? "translateX(0)" : "translateX(2.5rem)" }}
      />
      <span className="relative z-10 flex w-full items-center justify-between px-1">
        <Moon
          className="size-4 transition-colors"
          style={{ color: theme === "dark" ? "var(--primary-foreground)" : "var(--subtle)" }}
        />
        <Sun
          className="size-4 transition-colors"
          style={{ color: theme === "light" ? "var(--primary-foreground)" : "var(--subtle)" }}
        />
      </span>
    </button>
  );
}
