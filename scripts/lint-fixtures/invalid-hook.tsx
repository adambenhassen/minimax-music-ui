import { useState } from 'react';

export function InvalidHook({ enabled }: { enabled: boolean }) {
  if (enabled) {
    const [count] = useState(0);
    return <span>{count}</span>;
  }

  return null;
}
