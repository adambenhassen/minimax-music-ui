/** Deterministic gradient from an id, so each track has a stable "cover". */
export function coverStyle(id: string): React.CSSProperties {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const a = h % 360;
  const b = (a + 40 + (h >> 8) % 80) % 360;
  const c = (a + 200 + (h >> 16) % 60) % 360;
  return {
    backgroundImage: `radial-gradient(circle at 20% 20%, hsl(${a} 80% 60%) 0%, transparent 55%), radial-gradient(circle at 80% 30%, hsl(${b} 75% 55%) 0%, transparent 55%), linear-gradient(135deg, hsl(${c} 60% 25%), hsl(${a} 50% 15%))`,
  };
}
