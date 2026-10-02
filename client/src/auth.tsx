import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, type User } from "./api";

type AuthState = {
  user: User | null;
  loading: boolean;
  inviteRequired: boolean;
  scriberr: boolean;
  lmStudio: boolean;
  refresh: () => Promise<void>;
  setUser: (u: User | null) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteRequired, setInviteRequired] = useState(false);
  const [scriberr, setScriberr] = useState(false);
  const [lmStudio, setLmStudio] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const health = await api.health();
      setInviteRequired(health.inviteRequired);
      setScriberr(health.scriberr);
      setLmStudio(health.lmStudio);
    } catch {
      /* ignore */
    }
    try {
      const { user: me } = await api.me();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        inviteRequired,
        scriberr,
        lmStudio,
        refresh,
        setUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}
