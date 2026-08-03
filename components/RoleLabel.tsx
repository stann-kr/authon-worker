import { getRoleColor } from "@/lib/colors";
import { useTranslations } from "next-intl";

interface RoleLabelProps {
  role?: string | null;
  className?: string;
  colored?: boolean;
}

export { getRoleColor };

export type RoleLabelTranslationKey =
  | "roleSuperAdmin"
  | "roleVenueAdmin"
  | "roleDoorStaff"
  | "roleStaff"
  | "roleDj"
  | "roleSharedAccount";

const roleLabelKeys: Record<string, RoleLabelTranslationKey> = {
  super_admin: "roleSuperAdmin",
  venue_admin: "roleVenueAdmin",
  door_staff: "roleDoorStaff",
  staff: "roleStaff",
  dj: "roleDj",
  shared: "roleSharedAccount",
};

export function getRoleLabelText(
  role: string | null | undefined,
  translate: (key: RoleLabelTranslationKey) => string,
): string {
  if (!role) return "-";
  const translationKey = roleLabelKeys[role];
  return translationKey
    ? translate(translationKey)
    : role.replace(/_/g, " ").toUpperCase();
}

export default function RoleLabel({
  role,
  className,
  colored,
}: RoleLabelProps) {
  const t = useTranslations("Common");
  const colorClass = colored ? getRoleColor(role) : "";
  return (
    <span className={[colorClass, className].filter(Boolean).join(" ")}>
      {getRoleLabelText(role, (key) => t(key))}
    </span>
  );
}
