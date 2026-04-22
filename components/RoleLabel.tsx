import { getRoleColor } from "@/lib/colors";

interface RoleLabelProps {
  role?: string | null;
  className?: string;
  colored?: boolean;
}

function formatRole(role?: string | null) {
  if (!role) return "-";
  return role.replace(/_/g, " ").toUpperCase();
}

export { getRoleColor };

export default function RoleLabel({
  role,
  className,
  colored,
}: RoleLabelProps) {
  const colorClass = colored ? getRoleColor(role) : "";
  return (
    <span className={[colorClass, className].filter(Boolean).join(" ")}>
      {formatRole(role)}
    </span>
  );
}
