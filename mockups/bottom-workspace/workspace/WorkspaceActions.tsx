import { useMock } from "../data/MockData";
import { Icon, type IconName } from "../shared/Icon";

export type WorkspaceAction = {
  label: string;
  icon: IconName;
  color: "green" | "blue" | "gray";
  action: () => void;
  disabled?: boolean;
};

export function WorkspaceActions({ actions, disabled }: {
  actions: WorkspaceAction[];
  disabled: boolean;
}) {
  const { t } = useMock();
  return (
    <div className="dock-tools" data-action-count={actions.length} aria-label={t("현재 화면 작업")}>
      {actions.map((tool) => (
        <button className="action-pill" key={tool.label} disabled={tool.disabled || disabled} onClick={tool.action}>
          <span className={`circle-icon ${tool.color}`}><Icon name={tool.icon} size={14} /></span>
          <span>{t(tool.label)}</span>
        </button>
      ))}
    </div>
  );
}
