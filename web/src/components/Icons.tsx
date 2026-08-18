import type { SVGProps } from 'react';

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...props,
});

export const Play = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)} fill="currentColor" stroke="none"><path d="M8 5v14l11-7z" /></svg>;
export const Pause = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)} fill="currentColor" stroke="none"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>;
export const Prev = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)} fill="currentColor" stroke="none"><path d="M6 6h2v12H6zM20 6v12L9.5 12z" /></svg>;
export const Next = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)} fill="currentColor" stroke="none"><path d="M16 6h2v12h-2zM4 6v12l10.5-6z" /></svg>;
export const Download = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3" /></svg>;
export const Trash = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>;
export const Refresh = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" /></svg>;
export const Reuse = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 12V8a2 2 0 0 1 2-2h12M4 12l3-3M4 12l3 3M20 12v4a2 2 0 0 1-2 2H6m14-6l-3-3m3 3l-3 3" /></svg>;
export const Sparkle = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></svg>;
export const Music = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm10-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" /></svg>;
export const Library = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 4h4v16H4zM10 4h4v16h-4zM16 5l4-1v16l-4 1z" /></svg>;
export const X = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const Chevron = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M9 6l6 6-6 6" /></svg>;
export const Alert = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 9v4m0 4h.01M10.3 3.9L2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>;
export const Gear = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>;
export const Lock = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
