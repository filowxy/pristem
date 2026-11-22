import type { ComponentType } from 'react';
import { Files, GitBranch, Search, Settings } from 'lucide-react';
import { t } from '../i18n';

export type ActiveView = 'files' | 'search' | 'git';

const VIEWS: { id: ActiveView; labelKey: string; icon: ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { id: 'files', labelKey: 'activity.files', icon: Files },
  { id: 'search', labelKey: 'activity.search', icon: Search },
  { id: 'git', labelKey: 'activity.git', icon: GitBranch },
];

/** Horizontal view switcher for the project column. */
export function ActivityRail({
  active,
  onChange,
  onOpenSettings,
}: {
  active: ActiveView;
  onChange: (v: ActiveView) => void;
  onOpenSettings: () => void;
}) {
  return (
    <nav className="left-rail-head" aria-label={t('activity.rail')}>
      <div className="view-seg">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`view-seg-item ${v.id === active ? 'is-active' : ''}`}
            aria-current={v.id === active ? 'page' : undefined}
            title={t(v.labelKey)}
            onClick={() => onChange(v.id)}
          >
            <v.icon size={15} strokeWidth={1.75} />
            <span>{t(v.labelKey)}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="rail-settings"
        aria-label={t('activity.settings')}
        title={t('activity.settings')}
        onClick={onOpenSettings}
      >
        <Settings size={14} strokeWidth={1.75} />
      </button>
    </nav>
  );
}
