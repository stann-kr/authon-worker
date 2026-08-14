import type { User } from "./user-profile.ts";

export function completeAuthenticatedClientSession(params: {
  user: User;
  setUser: (user: User) => void;
  navigate: (href: string) => void;
}): void {
  params.setUser(params.user);
  params.navigate("/");
}
