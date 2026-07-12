import { Suspense, lazy, useEffect, useState } from 'react';

const LegacyPopup = lazy(() => import('./Popup'));
const M365ControlCenter = lazy(() => import('./m365/M365ControlCenter'));

export function isM365Url(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.toLowerCase() === 'm365.cloud.microsoft';
  } catch {
    return false;
  }
}

export default function PopupRouter() {
  const [m365, setM365] = useState<boolean | null>(null);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      setM365(isM365Url(tabs[0]?.url));
    });
  }, []);

  if (m365 === null) return <div className="gv-popup-loading">Voyager</div>;

  return (
    <Suspense fallback={<div className="gv-popup-loading">Voyager</div>}>
      {m365 ? <M365ControlCenter /> : <LegacyPopup />}
    </Suspense>
  );
}
