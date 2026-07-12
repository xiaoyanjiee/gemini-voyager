import { useEffect, useMemo, useState } from 'react';

import { settingsV2Repository, workspaceV2Repository } from '@/core/v2/repositories';
import {
  type SettingsV2,
  type WorkspaceV2,
  createDefaultSettingsV2,
  createEmptyWorkspaceV2,
} from '@/core/v2/schemas';

import { getM365PopupStrings } from './strings';

type Section =
  | 'overview'
  | 'conversation'
  | 'organize'
  | 'export'
  | 'sync'
  | 'appearance'
  | 'advanced';
const sections: Section[] = [
  'overview',
  'conversation',
  'organize',
  'export',
  'sync',
  'appearance',
  'advanced',
];

export default function M365ControlCenter() {
  const strings = useMemo(() => getM365PopupStrings(), []);
  const [section, setSection] = useState<Section>('overview');
  const [settings, setSettings] = useState<SettingsV2 | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceV2 | null>(null);
  const [status, setStatus] = useState(strings.statusReady);

  useEffect(() => {
    void Promise.all([settingsV2Repository.get(), workspaceV2Repository.get()]).then(
      ([nextSettings, nextWorkspace]) => {
        setSettings(nextSettings);
        setWorkspace(nextWorkspace);
      },
    );
  }, []);

  const saveSettings = async (mutator: (next: SettingsV2) => void) => {
    if (!settings) return;
    const next = structuredClone(settings);
    mutator(next);
    await settingsV2Repository.set(next);
    setSettings(next);
    setStatus(strings.statusReady);
  };

  const content = () => {
    if (!settings || !workspace) return <p className="m365-muted">Voyager</p>;
    switch (section) {
      case 'overview':
        return (
          <div className="m365-grid">
            <Metric
              label={strings.folders}
              value={workspace.folders.filter((item) => item.deletedAt === null).length}
            />
            <Metric
              label={strings.prompts}
              value={workspace.prompts.filter((item) => item.deletedAt === null).length}
            />
            <Metric
              label={strings.starred}
              value={workspace.starred.filter((item) => item.deletedAt === null).length}
            />
            <Metric
              label={strings.activeCloud}
              value={settings.activeCloudProvider ?? strings.localOnly}
            />
          </div>
        );
      case 'conversation':
        return (
          <div className="m365-stack">
            <Toggle
              label={strings.enabled}
              checked={settings.platforms.m365.enabled}
              onChange={(checked) =>
                void saveSettings((next) => {
                  next.platforms.m365.enabled = checked;
                })
              }
            />
            <Toggle
              label={strings.timeline}
              checked={settings.platforms.m365.timeline.enabled}
              onChange={(checked) =>
                void saveSettings((next) => {
                  next.platforms.m365.timeline.enabled = checked;
                })
              }
            />
            <p className="m365-muted">{strings.openDockHint}</p>
          </div>
        );
      case 'organize':
      case 'export':
        return <p className="m365-muted">{strings.openDockHint}</p>;
      case 'sync':
        return (
          <div className="m365-stack">
            <label>
              {strings.activeCloud}
              <select
                value={settings.activeCloudProvider ?? ''}
                onChange={(event) =>
                  void saveSettings((next) => {
                    next.activeCloudProvider = event.target.value
                      ? (event.target.value as SettingsV2['activeCloudProvider'])
                      : null;
                  })
                }
              >
                <option value="">{strings.none}</option>
                <option value="google-drive">{strings.googleDrive}</option>
                <option value="onedrive" disabled={!import.meta.env.VITE_ONEDRIVE_CLIENT_ID}>
                  {strings.oneDrive} — {strings.notConfigured}
                </option>
              </select>
            </label>
          </div>
        );
      case 'appearance':
        return (
          <div className="m365-stack">
            <label>
              {strings.chatWidth}: {settings.platforms.m365.chatWidthPercent}%
              <input
                type="range"
                min="30"
                max="100"
                value={settings.platforms.m365.chatWidthPercent}
                onChange={(event) =>
                  void saveSettings((next) => {
                    next.platforms.m365.chatWidthPercent = Number(event.target.value);
                  })
                }
              />
            </label>
            <label>
              {strings.theme}
              <select
                value={settings.theme}
                onChange={(event) =>
                  void saveSettings((next) => {
                    next.theme = event.target.value as SettingsV2['theme'];
                  })
                }
              >
                <option value="system">{strings.system}</option>
                <option value="light">{strings.light}</option>
                <option value="dark">{strings.dark}</option>
              </select>
            </label>
          </div>
        );
      case 'advanced':
        return (
          <button className="m365-danger" type="button" onClick={() => void resetV2()}>
            {strings.resetV2}
          </button>
        );
    }
  };

  const resetV2 = async () => {
    if (!window.confirm(strings.resetConfirm)) return;
    const nextSettings = createDefaultSettingsV2();
    const nextWorkspace = createEmptyWorkspaceV2();
    await Promise.all([
      settingsV2Repository.set(nextSettings),
      workspaceV2Repository.set(nextWorkspace),
    ]);
    setSettings(nextSettings);
    setWorkspace(nextWorkspace);
    setStatus(strings.resetDone);
  };

  return (
    <div className="m365-popup" dir={navigator.language.startsWith('ar') ? 'rtl' : 'ltr'}>
      <header>
        <h1>{strings.title}</h1>
        <span>M365-first V2</span>
      </header>
      <div className="m365-layout">
        <nav aria-label="M365 settings sections">
          {sections.map((item) => (
            <button
              type="button"
              key={item}
              aria-current={section === item ? 'page' : undefined}
              onClick={() => setSection(item)}
            >
              {strings[item]}
            </button>
          ))}
        </nav>
        <main>
          <h2>{strings[section]}</h2>
          {content()}
        </main>
      </div>
      <footer role="status">{status}</footer>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="m365-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="m365-toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
