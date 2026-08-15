import {
  Add,
  ArrowLeft,
  ArrowRight,
  Calendar,
  ChartLineData,
  Checkmark,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Close,
  DataBase,
  Email,
  Home,
  Key,
  Link,
  Locked,
  Login,
  Logout,
  PlayFilled,
  Renew,
  Save,
  Search,
  Settings,
  Store,
  Subtract,
  Time,
  Undo,
  User,
  UserAdmin,
  UserFollow,
  UserMultiple,
  View,
  ViewOff,
  WarningAlt,
} from "@carbon/icons-react";
import type { ComponentProps } from "react";

const iconMap = {
  add: Add,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  calendar: Calendar,
  "chart-line": ChartLineData,
  check: Checkmark,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  close: Close,
  database: DataBase,
  email: Email,
  home: Home,
  key: Key,
  link: Link,
  locked: Locked,
  login: Login,
  logout: Logout,
  play: PlayFilled,
  refresh: Renew,
  save: Save,
  search: Search,
  settings: Settings,
  store: Store,
  subtract: Subtract,
  time: Time,
  undo: Undo,
  user: User,
  "user-admin": UserAdmin,
  "user-add": UserFollow,
  users: UserMultiple,
  view: View,
  "view-off": ViewOff,
  warning: WarningAlt,
} as const;

export type IconName = keyof typeof iconMap;

interface IconProps extends Omit<ComponentProps<typeof User>, "ref"> {
  name: IconName;
}

export default function Icon({ name, size = 18, ...props }: IconProps) {
  const CarbonIcon = iconMap[name];
  return <CarbonIcon size={size} aria-hidden="true" {...props} />;
}
