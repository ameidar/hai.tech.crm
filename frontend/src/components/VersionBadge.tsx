import { useEffect, useState } from 'react';
import api from '../api/client';

type VersionInfo = {
  version: string;
  commit: string;
  branch: string;
  builtAt: string;
};

export default function VersionBadge() {
  const [info, setInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    api
      .get<VersionInfo>('/version')
      .then((r) => setInfo(r.data))
      .catch(() => setInfo(null));
  }, []);

  if (!info) {
    return (
      <div className="px-4 py-1 text-center">
        <span className="text-xs text-slate-500">…</span>
      </div>
    );
  }

  const builtAtShort = new Date(info.builtAt).toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const tooltip = `גרסה ${info.version}
commit: ${info.commit}
branch: ${info.branch}
built: ${info.builtAt}`;

  return (
    <div className="px-4 py-1 text-center" title={tooltip}>
      <span className="text-xs text-slate-500">
        v{info.version} · {info.commit}
      </span>
      <span className="text-xs text-slate-600 block">{builtAtShort}</span>
    </div>
  );
}
