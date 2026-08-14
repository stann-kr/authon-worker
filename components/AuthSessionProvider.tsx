"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { cacheUser, type User } from "@/lib/auth";

interface AuthSessionContextValue {
  user: User | null;
  setUser: (user: User | null) => void;
}

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function AuthSessionProvider({
  initialUser,
  children,
}: {
  initialUser: User | null;
  children: ReactNode;
}) {
  const [user, setUserState] = useState<User | null>(initialUser);

  useEffect(() => {
    setUserState(initialUser);
    cacheUser(initialUser);
  }, [initialUser]);

  const setUser = useCallback((nextUser: User | null) => {
    setUserState(nextUser);
    cacheUser(nextUser);
  }, []);
  const value = useMemo(() => ({ user, setUser }), [setUser, user]);

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession(): AuthSessionContextValue {
  const context = useContext(AuthSessionContext);
  if (!context) {
    throw new Error("useAuthSession must be used within AuthSessionProvider");
  }
  return context;
}
