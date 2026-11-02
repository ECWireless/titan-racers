import type { ReactNode } from "react";

/** Line icons for the home menu, drawn in the current text colour. */
function MenuIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className="size-[1.125rem] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="square"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}

export function LeaderboardIcon() {
  return (
    <MenuIcon>
      <path d="M3.5 20.5v-7h5.5v7M9 20.5V6.5h6v14M15 20.5v-4.5h5.5v4.5M2.5 20.5h19" />
    </MenuIcon>
  );
}

export function ProfileIcon() {
  return (
    <MenuIcon>
      <circle cx="12" cy="8" r="3.75" />
      <path d="M4.5 20.5c1.2-3.8 3.9-5.75 7.5-5.75s6.3 1.95 7.5 5.75" />
    </MenuIcon>
  );
}

export function KartBuilderIcon() {
  return (
    <MenuIcon>
      <path d="M14.8 4.2a4.5 4.5 0 0 0-5.6 5.6L3.5 15.5l5 5 5.7-5.7a4.5 4.5 0 0 0 5.6-5.6l-2.9 2.9-3.2-.8-.8-3.2 2.9-2.9Z" />
    </MenuIcon>
  );
}

export function CourseEditorIcon() {
  return (
    <MenuIcon>
      <path d="M5.5 21V3.5M5.5 4.5h12l-2.5 4 2.5 4h-12" />
    </MenuIcon>
  );
}

export function SignInIcon() {
  return (
    <MenuIcon>
      <path d="M14 3.5h5.5v17H14M9.5 7.5 14 12l-4.5 4.5M14 12H4" />
    </MenuIcon>
  );
}

export function SignOutIcon() {
  return (
    <MenuIcon>
      <path d="M10 3.5H4.5v17H10M14.5 7.5 19 12l-4.5 4.5M19 12H9" />
    </MenuIcon>
  );
}

export function SoundIcon() {
  return (
    <MenuIcon>
      <path d="M3.5 9.5v5h4l5 4v-13l-5 4h-4Z" />
      <path d="M16 9a4.2 4.2 0 0 1 0 6M18.8 6.2a8.2 8.2 0 0 1 0 11.6" />
    </MenuIcon>
  );
}
