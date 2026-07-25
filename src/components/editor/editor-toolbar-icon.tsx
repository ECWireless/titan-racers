import type { EditorTransformTool } from "@/game/editor/editor-viewport";

export type EditorToolbarIconName =
  | EditorTransformTool
  | "attach"
  | "collision"
  | "delete"
  | "detach"
  | "frame"
  | "help"
  | "mirror"
  | "multiSelect"
  | "publish"
  | "save"
  | "snap";

export function EditorToolbarIcon({ name }: { name: EditorToolbarIconName }) {
  const common = {
    "aria-hidden": true,
    className: "h-5 w-5",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.7,
    viewBox: "0 0 24 24",
  };

  if (name === "translate") {
    return (
      <svg {...common}>
        <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
      </svg>
    );
  }
  if (name === "rotate") {
    return (
      <svg {...common}>
        <path d="M20 7v5h-5M4 17v-5h5M18.5 10A7 7 0 0 0 6.2 6.2L4 9M5.5 14A7 7 0 0 0 17.8 17.8L20 15" />
      </svg>
    );
  }
  if (name === "scale") {
    return (
      <svg {...common}>
        <path d="M8 4H4v4M16 20h4v-4M4 4l6 6M20 20l-6-6M14 4h6v6M20 4l-6 6M10 14l-6 6" />
      </svg>
    );
  }
  if (name === "snap") {
    return (
      <svg {...common}>
        <path d="M8 3v18M16 3v18M3 8h18M3 16h18" opacity="0.58" />
        <circle cx="16" cy="8" fill="currentColor" r="2.4" stroke="none" />
      </svg>
    );
  }
  if (name === "multiSelect") {
    return (
      <svg {...common}>
        <rect height="8" width="8" x="3" y="3" />
        <rect height="8" width="8" x="13" y="13" />
        <path d="M17 3v6M14 6h6" />
      </svg>
    );
  }
  if (name === "save") {
    return (
      <svg {...common}>
        <path d="M5 4h12l2 2v14H5V4Z" />
        <path d="M8 4v6h8V4M8 20v-6h8v6" />
      </svg>
    );
  }
  if (name === "publish") {
    return (
      <svg {...common}>
        <path d="M12 16V3M7 8l5-5 5 5M5 13v7h14v-7" />
      </svg>
    );
  }
  if (name === "attach") {
    return (
      <svg {...common}>
        <path d="M9.5 14.5 14.5 9.5M7.2 16.8l-1.4 1.4a3 3 0 0 1-4.2-4.2l3-3a3 3 0 0 1 4.2 0M16.8 7.2l1.4-1.4a3 3 0 0 1 4.2 4.2l-3 3a3 3 0 0 1-4.2 0" />
      </svg>
    );
  }
  if (name === "detach") {
    return (
      <svg {...common}>
        <path d="m9.5 14.5 5-5M7.2 16.8l-1.4 1.4a3 3 0 0 1-4.2-4.2l3-3a3 3 0 0 1 4.2 0M16.8 7.2l1.4-1.4a3 3 0 0 1 4.2 4.2l-3 3a3 3 0 0 1-4.2 0M5 5l14 14" />
      </svg>
    );
  }
  if (name === "mirror") {
    return (
      <svg {...common}>
        <path d="M12 3v18" strokeDasharray="2.5 2.5" />
        <path d="M4 7h5v10H4zM20 7h-5v10h5zM7 4l3 3-3 3M17 14l-3 3 3 3" />
      </svg>
    );
  }
  if (name === "delete") {
    return (
      <svg {...common}>
        <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
      </svg>
    );
  }
  if (name === "collision") {
    return (
      <svg {...common}>
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3ZM4 7.5l8 4.5 8-4.5M12 12v9" />
      </svg>
    );
  }
  if (name === "frame") {
    return (
      <svg {...common}>
        <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.8 9a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1.2.9-1.2 1.8M12 17h.01" />
    </svg>
  );
}
