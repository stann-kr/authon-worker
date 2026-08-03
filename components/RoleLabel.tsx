import { getRoleColor } from "@/lib/colors";
import { useTranslations } from "next-intl";

interface RoleLabelProps {
  role?: string | null;
  className?: string;
  colored?: boolean;
}

export { getRoleColor };

export default function RoleLabel({
  role,
  className,
  colored,
}: RoleLabelProps) {
  const t = useTranslations("Common");
  const colorClass = colored ? getRoleColor(role) : "";
  const roleLabels: Record<string, string> = {
    super_admin: t("roleSuperAdmin"),
    venue_admin: t("roleVenueAdmin"),
    door_staff: t("roleDoorStaff"),
    staff: t("roleStaff"),
    dj: t("roleDj"),
    shared: t("roleSharedAccount"),
  };
  return (
    <span className={[colorClass, className].filter(Boolean).join(" ")}>
      {role ? roleLabels[role] ?? role.replace(/_/g, " ").toUpperCase() : "-"}
    </span>
  );
}
