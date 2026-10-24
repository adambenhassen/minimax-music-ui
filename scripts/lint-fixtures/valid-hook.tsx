import { useState } from 'react';

export function ValidHook({ enabled }: { enabled: boolean }) {
  const [count] = useState(0);

  return enabled ? <span>{count}</span> : null;
}
