/* Small stroke icons, 24px grid, drawn in currentColor. */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  "aria-hidden": true, ...p,
});

export const IconHome = (p: P) => (
  <svg {...base(p)}><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z" /></svg>
);
export const IconTopics = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="5.5" r="2.5" /><circle cx="5.5" cy="18" r="2.5" /><circle cx="18.5" cy="18" r="2.5" /><path d="M12 8v3.5M12 11.5 6.8 15.8M12 11.5l5.2 4.3" /></svg>
);
export const IconLibrary = (p: P) => (
  <svg {...base(p)}><rect x="4" y="4" width="4" height="16" rx="1" /><rect x="10" y="4" width="4" height="16" rx="1" /><path d="m16.2 5.3 3.7-1 3 15.4-3.7 1Z" transform="translate(-2.4 0)" /></svg>
);
export const IconNotes = (p: P) => (
  <svg {...base(p)}><path d="M6 3.5h8.5L19 8v12.5H6Z" /><path d="M14 3.5V8.5h5M9 13h7M9 16.5h5" /></svg>
);
export const IconInbox = (p: P) => (
  <svg {...base({ width: 20, height: 20, ...p })}><path d="M4 13.5 6.5 5h11l2.5 8.5V19H4Z" /><path d="M4 13.5h4.5l1 2h5l1-2H20" /></svg>
);
export const IconJournal = (p: P) => (
  <svg {...base({ width: 20, height: 20, ...p })}><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M9 3.5v17M12 8h4M12 11.5h4" /></svg>
);
export const IconPath = (p: P) => (
  <svg {...base({ width: 18, height: 18, ...p })}><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h6.5a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7H16" /></svg>
);
export const IconSearch = (p: P) => (
  <svg {...base({ width: 18, height: 18, ...p })}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>
);
export const IconClose = (p: P) => (
  <svg {...base({ width: 16, height: 16, strokeWidth: 2.2, ...p })}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconBack = (p: P) => (
  <svg {...base({ width: 20, height: 20, strokeWidth: 2.2, ...p })}><path d="M15 5l-7 7 7 7" /></svg>
);
export const IconNext = (p: P) => (
  <svg {...base({ width: 20, height: 20, strokeWidth: 2.2, ...p })}><path d="M9 5l7 7-7 7" /></svg>
);
export const IconChevronDown = (p: P) => (
  <svg {...base({ width: 16, height: 16, strokeWidth: 2.2, ...p })}><path d="M6 9l6 6 6-6" /></svg>
);
export const IconPlus = (p: P) => (
  <svg {...base({ width: 18, height: 18, strokeWidth: 2.2, ...p })}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconMinus = (p: P) => (
  <svg {...base({ width: 18, height: 18, strokeWidth: 2.2, ...p })}><path d="M5 12h14" /></svg>
);
export const IconExternal = (p: P) => (
  <svg {...base({ width: 14, height: 14, strokeWidth: 2, ...p })}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
);
export const IconCheck = (p: P) => (
  <svg {...base({ width: 14, height: 14, strokeWidth: 2.6, ...p })}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const IconEdit = (p: P) => (
  <svg {...base({ width: 18, height: 18, ...p })}><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="M13.5 6.5l4 4" /></svg>
);
export const IconMore = (p: P) => (
  <svg {...base({ width: 20, height: 20, ...p })}><circle cx="5.5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="18.5" cy="12" r="1.3" fill="currentColor" /></svg>
);
export const IconQuote = (p: P) => (
  <svg {...base({ width: 18, height: 18, ...p })}><path d="M5 17c2.5 0 4-1.8 4-4.5V7H5v5.5h3M14 17c2.5 0 4-1.8 4-4.5V7h-4v5.5h3" /></svg>
);
export const IconSpark = (p: P) => (
  <svg {...base({ width: 18, height: 18, ...p })}><path d="M12 3.5 13.8 10 20.5 12l-6.7 2L12 20.5 10.2 14 3.5 12l6.7-2Z" /></svg>
);
export const IconLink = (p: P) => (
  <svg {...base({ width: 16, height: 16, strokeWidth: 2, ...p })}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
);
export const IconRead = (p: P) => (
  <svg {...base({ width: 18, height: 18, ...p })}><path d="M3.5 5.5c3-1 6-.8 8.5 1 2.5-1.8 5.5-2 8.5-1v13c-3-1-6-.8-8.5 1-2.5-1.8-5.5-2-8.5-1Z" /><path d="M12 6.5v13" /></svg>
);
