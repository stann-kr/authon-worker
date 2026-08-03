"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslations } from "next-intl";
import Alert from "@/components/Alert";
import AppHeader from "@/components/AppHeader";
import Button from "@/components/Button";
import DatePicker from "@/components/DatePicker";
import EmptyState from "@/components/EmptyState";
import Footer from "@/components/Footer";
import GuestListCard from "@/components/GuestListCard";
import GuestSearchInput from "@/components/GuestSearchInput";
import Icon, { type IconName } from "@/components/Icon";
import OperationsLayout from "@/components/OperationsLayout";
import PanelHeader from "@/components/PanelHeader";
import RoleLabel from "@/components/RoleLabel";
import Spinner from "@/components/Spinner";
import StatGrid from "@/components/StatGrid";
import StatusLabel from "@/components/StatusLabel";
import TransitionLink from "@/components/TransitionLink";
import WorkspaceMenu, { type WorkspaceMenuItem } from "@/components/WorkspaceMenu";
import { getDemoAccess, type DemoSession } from "@/lib/demo/auth";
import {
  clearDemoSession,
  readDemoSession,
  readDemoState,
  writeDemoState,
} from "@/lib/demo/browser-storage";
import {
  addDemoGuest,
  createDemoLink,
  createDemoState,
  decideDemoRequest,
  deleteDemoGuest,
  setDemoGuestCheckIn,
  type DemoExternalLink,
  type DemoGuest,
  type DemoGuestLimitRequest,
  type DemoState,
} from "@/lib/demo/state";

const DEMO_BUSINESS_DATE = "2026-08-03";
const DEMO_VENUE_NAME = "Faust Seoul";

type WorkspaceView = "home" | "guest" | "door" | "admin";
type AdminTab = "guests" | "links" | "users";
type AdminGuestTab = "list" | "requests";

interface DemoUserFixture {
  id: string;
  name: string;
  email: string;
  role: "venue_admin" | "door_staff" | "staff" | "dj";
  guestLimit: number | null;
  active: boolean;
}

const DEMO_USERS: DemoUserFixture[] = [
  {
    id: "demo-venue-admin",
    name: "Casey Morgan",
    email: "venue.admin@demo.authon.app",
    role: "venue_admin",
    guestLimit: null,
    active: true,
  },
  {
    id: "demo-door-staff",
    name: "Noah Park",
    email: "door.staff@demo.authon.app",
    role: "door_staff",
    guestLimit: 20,
    active: true,
  },
  {
    id: "demo-resident-dj",
    name: "Joon Kim",
    email: "resident.dj@demo.authon.app",
    role: "dj",
    guestLimit: 10,
    active: true,
  },
  {
    id: "demo-floor-staff",
    name: "Sora Lee",
    email: "floor.staff@demo.authon.app",
    role: "staff",
    guestLimit: 8,
    active: true,
  },
];

export default function DemoWorkspacePage() {
  const t = useTranslations("Demo");
  const [state, setState] = useState<DemoState>(() => createDemoState());
  const [session, setSession] = useState<DemoSession | null>(null);
  const [activeView, setActiveView] = useState<WorkspaceView>("home");
  const [adminTab, setAdminTab] = useState<AdminTab>("guests");
  const [adminGuestTab, setAdminGuestTab] = useState<AdminGuestTab>("list");
  const [notice, setNotice] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const storedSession = readDemoSession(window.sessionStorage);
    const requested = readWorkspaceLocation(new URL(window.location.href));
    setState(readDemoState(window.localStorage));
    setSession(storedSession);
    if (storedSession && canOpenView(storedSession, requested.view)) {
      setActiveView(requested.view);
      setAdminTab(requested.adminTab);
      setAdminGuestTab(requested.adminGuestTab);
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (isHydrated) writeDemoState(window.localStorage, state);
  }, [isHydrated, state]);

  const navigate = (
    view: WorkspaceView,
    nextAdminTab: AdminTab = adminTab,
    nextAdminGuestTab: AdminGuestTab = adminGuestTab,
  ) => {
    if (!session || !canOpenView(session, view)) return;
    setActiveView(view);
    setAdminTab(nextAdminTab);
    setAdminGuestTab(nextAdminGuestTab);
    setNotice("");
    const url = new URL(window.location.href);
    if (view === "home") {
      url.search = "";
    } else {
      url.searchParams.set("view", view);
      if (view === "admin") {
        url.searchParams.set("tab", nextAdminTab);
        if (nextAdminTab === "guests") {
          url.searchParams.set("section", nextAdminGuestTab);
        } else {
          url.searchParams.delete("section");
        }
      } else {
        url.searchParams.delete("tab");
        url.searchParams.delete("section");
      }
    }
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  };

  if (!isHydrated) {
    return <Spinner mode="fullscreen" text={t("loadingWorkspace")} />;
  }

  if (!session) {
    return <WorkspaceSessionRequired />;
  }

  const signOut = () => {
    clearDemoSession(window.sessionStorage);
    setSession(null);
  };
  const resetDemo = () => {
    if (!window.confirm(t("resetConfirm"))) return;
    setState(createDemoState());
    setNotice(t("resetComplete"));
  };

  return (
    <DemoAppShell
      activeView={activeView}
      onSignOut={signOut}
      onReset={resetDemo}
    >
      {activeView === "home" && (
        <DemoHome
          session={session}
          state={state}
          onNavigate={(view) => navigate(view)}
          onOpenRequests={() => navigate("admin", "guests", "requests")}
        />
      )}
      {activeView === "guest" && (
        <DemoGuestOperations
          session={session}
          state={state}
          notice={notice}
          onStateChange={setState}
          onNotice={setNotice}
        />
      )}
      {activeView === "door" && (
        <DemoDoorOperations
          state={state}
          notice={notice}
          onStateChange={setState}
          onNotice={setNotice}
        />
      )}
      {activeView === "admin" && (
        <DemoAdminOperations
          state={state}
          activeTab={adminTab}
          activeGuestTab={adminGuestTab}
          notice={notice}
          onStateChange={setState}
          onNotice={setNotice}
          onTabChange={(tab) => navigate("admin", tab, adminGuestTab)}
          onGuestTabChange={(tab) => navigate("admin", "guests", tab)}
        />
      )}
    </DemoAppShell>
  );
}

function canOpenView(session: DemoSession, view: WorkspaceView): boolean {
  if (view === "home") return true;
  const access = getDemoAccess(session.role);
  if (view === "guest") return access.includes("guests");
  if (view === "door") return access.includes("door");
  return session.role === "venue_admin";
}

function readWorkspaceLocation(url: URL): {
  view: WorkspaceView;
  adminTab: AdminTab;
  adminGuestTab: AdminGuestTab;
} {
  const rawView = url.searchParams.get("view");
  const rawTab = url.searchParams.get("tab");
  const rawSection = url.searchParams.get("section");
  if (rawView === "guest" || rawView === "guests") {
    return { view: "guest", adminTab: "guests", adminGuestTab: "list" };
  }
  if (rawView === "door") {
    return { view: "door", adminTab: "guests", adminGuestTab: "list" };
  }
  if (rawView === "requests") {
    return { view: "admin", adminTab: "guests", adminGuestTab: "requests" };
  }
  if (rawView === "links") {
    return { view: "admin", adminTab: "links", adminGuestTab: "list" };
  }
  if (rawView === "admin") {
    return {
      view: "admin",
      adminTab: rawTab === "links" || rawTab === "users" ? rawTab : "guests",
      adminGuestTab: rawSection === "requests" ? "requests" : "list",
    };
  }
  return { view: "home", adminTab: "guests", adminGuestTab: "list" };
}

function DemoAppShell({
  activeView,
  onSignOut,
  onReset,
  children,
}: {
  activeView: WorkspaceView;
  onSignOut: () => void;
  onReset: () => void;
  children: React.ReactNode;
}) {
  const commonT = useTranslations("Common");
  const demoT = useTranslations("Demo");
  const contextLabel =
    activeView === "guest"
      ? commonT("guest")
      : activeView === "door"
        ? commonT("door")
        : activeView === "admin"
          ? commonT("admin")
          : undefined;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-canvas">
      <AppHeader
        brandName={DEMO_VENUE_NAME}
        homeHref="/demo/workspace"
        homeLabel={commonT("brandHome", { brand: DEMO_VENUE_NAME })}
        contextLabel={contextLabel}
        actions={
          <>
            <TransitionLink
              href="/demo"
              className="pressable flex h-10 w-10 items-center justify-center rounded-control border border-border-default bg-surface text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text-heading"
              aria-label={demoT("guidedMode")}
              title={demoT("guidedMode")}
            >
              <Icon name="user-admin" size={18} />
            </TransitionLink>
            <button
              type="button"
              onClick={onReset}
              className="pressable flex h-10 w-10 items-center justify-center rounded-control border border-border-default bg-surface text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text-heading"
              aria-label={demoT("resetDemo")}
              title={demoT("resetDemo")}
            >
              <Icon name="refresh" size={18} />
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="pressable flex h-10 w-10 items-center justify-center rounded-control border border-border-default bg-surface text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text-heading"
              aria-label={demoT("switchAccount")}
              title={demoT("switchAccount")}
            >
              <Icon name="logout" size={18} />
            </button>
          </>
        }
      />
      {children}
    </div>
  );
}

function WorkspaceSessionRequired() {
  const t = useTranslations("Demo");
  return (
    <div className="page-shell">
      <main className="mx-auto grid w-full max-w-[1040px] flex-1 place-items-center px-4 py-12 sm:px-6">
        <section className="w-full max-w-xl border border-border-subtle bg-surface p-6 sm:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-status-waiting">
            {t("workspaceMode")}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-text-heading">
            {t("sessionRequiredTitle")}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-text-muted">
            {t("sessionRequiredDescription")}
          </p>
          <TransitionLink
            href="/demo"
            className="pressable mt-6 inline-flex min-h-11 items-center gap-2 border border-action-primary bg-action-primary px-5 text-sm font-semibold text-action-text hover:bg-action-hover"
          >
            {t("chooseDemoAccount")}
            <Icon name="arrow-right" size={16} />
          </TransitionLink>
        </section>
      </main>
    </div>
  );
}

function DemoHome({
  session,
  state,
  onNavigate,
  onOpenRequests,
}: {
  session: DemoSession;
  state: DemoState;
  onNavigate: (view: WorkspaceView) => void;
  onOpenRequests: () => void;
}) {
  const t = useTranslations("Home");
  const pendingCount = state.requests.filter((request) => request.status === "pending").length;
  const items = useMemo<WorkspaceMenuItem[]>(() => {
    const access = getDemoAccess(session.role);
    return [
      ...(access.includes("guests")
        ? [{ id: "guest", title: t("guestTitle"), description: t("guestDescription"), icon: "user-add" as IconName, href: "/demo/workspace?view=guest" }]
        : []),
      ...(access.includes("door")
        ? [{ id: "door", title: t("doorTitle"), description: t("doorDescription"), icon: "login" as IconName, href: "/demo/workspace?view=door" }]
        : []),
      ...(session.role === "venue_admin"
        ? [{ id: "admin", title: t("adminTitle"), description: t("adminDescription"), icon: "settings" as IconName, href: "/demo/workspace?view=admin" }]
        : []),
    ];
  }, [session.role, t]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      const index = Number.parseInt(event.key, 10) - 1;
      const item = items[index];
      if (item) onNavigate(item.id as WorkspaceView);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [items, onNavigate]);

  return (
    <>
      <main className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col justify-center px-4 pb-8 pt-20 sm:px-6 sm:pt-24 lg:px-10">
        {session.role === "venue_admin" && pendingCount > 0 && (
          <button
            type="button"
            onClick={onOpenRequests}
            className="group mb-4 grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border border-status-waiting/70 bg-status-waiting/10 px-4 py-4 text-left text-status-waiting hover:border-status-waiting focus-visible:outline-none sm:px-5"
          >
            <Icon name="warning" size={22} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-heading">
                {t("pendingGuestRequests", { count: pendingCount })}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {t("pendingGuestRequestsDescription")}
              </p>
            </div>
            <span className="flex items-center gap-3">
              <span className="font-mono text-xs tabular-nums text-status-waiting">
                {t("pendingGuestRequestCount", { count: pendingCount })}
              </span>
              <Icon name="arrow-right" size={18} />
            </span>
          </button>
        )}
        <WorkspaceMenu
          label={t("availableWorkspaces")}
          items={items}
          onSelect={(item) => onNavigate(item.id as WorkspaceView)}
        />
      </main>
      <Footer text={DEMO_VENUE_NAME} />
    </>
  );
}

function DemoGuestOperations({
  session,
  state,
  notice,
  onStateChange,
  onNotice,
}: {
  session: DemoSession;
  state: DemoState;
  notice: string;
  onStateChange: React.Dispatch<React.SetStateAction<DemoState>>;
  onNotice: (message: string) => void;
}) {
  const t = useTranslations("GuestOperations");
  const demoT = useTranslations("Demo");
  const [selectedDate, setSelectedDate] = useState(DEMO_BUSINESS_DATE);
  const [guestName, setGuestName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<"default" | "alpha">("default");
  const scopedGuests = state.guests.filter((guest) => (guest.date ?? DEMO_BUSINESS_DATE) === selectedDate);
  const sortedGuests = sortGuests(scopedGuests, sortMode);
  const displayGuests = filterGuests(sortedGuests, searchQuery);
  const checked = scopedGuests.filter((guest) => guest.status === "checked_in").length;
  const limit = session.role === "venue_admin" ? null : session.role === "dj" ? 10 : 20;
  const remaining = limit === null ? null : Math.max(0, limit - scopedGuests.length);
  const pendingRequest = session.role === "dj"
    ? state.requests.find((request) => request.requester === session.name && request.status === "pending")
    : undefined;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!guestName.trim() || remaining === 0) return;
    const name = guestName.trim().toUpperCase();
    onStateChange((current) => addDemoGuest(current, { name, host: session.name, partySize: 1, date: selectedDate }));
    setGuestName("");
    onNotice(demoT("guestAddedNotice", { name }));
  };

  return (
    <WorkspacePage>
      {notice && <Alert type="success" message={notice} className="mb-4" />}
      <OperationsLayout
        title={t("title")}
        dashboard={
          <>
            <div className="context-bar">
              <DatePicker value={selectedDate} onChange={setSelectedDate} businessDate={DEMO_BUSINESS_DATE} />
            </div>
            <section className="app-panel" aria-labelledby="demo-add-guest-title">
              <div className="px-4 py-4 sm:px-5">
                <div className="mb-3 flex items-end justify-between gap-4">
                  <div>
                    <h2 id="demo-add-guest-title" className="type-panel-title">{t("addGuest")}</h2>
                    <p className="mt-1 text-sm text-text-muted">{t("addOneAtATime")}</p>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-lg tabular-nums text-text-heading">{remaining ?? "∞"}</div>
                    <div className="text-xs text-text-muted">{t("remaining")}</div>
                  </div>
                </div>
                {remaining !== 0 ? (
                  <form className="flex flex-col gap-2" onSubmit={submit}>
                    <div className="min-w-0 flex-1">
                      <label htmlFor="demo-workspace-guest-name" className="app-label">{t("guestName")}</label>
                      <input
                        id="demo-workspace-guest-name"
                        value={guestName}
                        onChange={(event) => setGuestName(event.target.value)}
                        placeholder={t("enterFullName")}
                        autoComplete="off"
                        className="app-field min-h-11"
                      />
                    </div>
                    <Button type="submit" disabled={!guestName.trim()} size="lg" fullWidth>{t("addGuest")}</Button>
                  </form>
                ) : (
                  <div className="border-l-2 border-status-danger bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
                    {t("limitReached", { used: scopedGuests.length, max: limit ?? 0 })}
                  </div>
                )}
                {pendingRequest && (
                  <div className="mt-3 border border-status-waiting/60 bg-status-waiting/10 p-3 text-xs text-status-waiting">
                    {t("requestPending", { count: pendingRequest.requestedCount })}
                  </div>
                )}
              </div>
            </section>
            <section className="app-panel" aria-labelledby="demo-guest-tools-title">
              <PanelHeader
                title={t("tools")}
                headingLevel={2}
                headingId="demo-guest-tools-title"
                sortMode={sortMode}
                onSortToggle={() => setSortMode((current) => current === "default" ? "alpha" : "default")}
                onRefresh={() => onStateChange((current) => ({ ...current }))}
              />
              <GuestSearchInput value={searchQuery} onChange={setSearchQuery} />
              <StatGrid items={[
                { label: t("waiting"), value: scopedGuests.length - checked, color: "waiting" },
                { label: t("checkedIn"), value: checked, color: "checked" },
                { label: t("total"), value: scopedGuests.length },
              ]} />
            </section>
          </>
        }
      >
        <section className="main-content-panel" aria-labelledby="demo-guest-list-title">
          <PanelHeader title={t("todaysGuests")} headingLevel={2} headingId="demo-guest-list-title" count={displayGuests.length} />
          {displayGuests.length === 0 ? (
            <EmptyState icon="user-add" message={searchQuery ? t("noSearchResults") : t("noGuestsForDate")} />
          ) : (
            <div className="divide-y divide-border-subtle">
              {displayGuests.map((guest, index) => (
                <GuestListCard
                  key={guest.id}
                  guest={toGuestCard(guest)}
                  index={index}
                  mode="registration"
                  djName={guest.host}
                  onDelete={() => onStateChange((current) => deleteDemoGuest(current, guest.id))}
                />
              ))}
            </div>
          )}
        </section>
      </OperationsLayout>
    </WorkspacePage>
  );
}

function DemoDoorOperations({
  state,
  notice,
  onStateChange,
  onNotice,
}: {
  state: DemoState;
  notice: string;
  onStateChange: React.Dispatch<React.SetStateAction<DemoState>>;
  onNotice: (message: string) => void;
}) {
  const t = useTranslations("Door");
  const demoT = useTranslations("Demo");
  const [selectedDate, setSelectedDate] = useState(DEMO_BUSINESS_DATE);
  const [selectedOwner, setSelectedOwner] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<"default" | "alpha">("default");
  const scopedGuests = state.guests.filter((guest) => (guest.date ?? DEMO_BUSINESS_DATE) === selectedDate);
  const owners = Array.from(new Set(scopedGuests.map((guest) => guest.host))).sort();
  const ownerGuests = selectedOwner === "all" ? scopedGuests : scopedGuests.filter((guest) => guest.host === selectedOwner);
  const displayGuests = filterGuests(sortGuests(ownerGuests, sortMode), searchQuery);
  const checked = displayGuests.filter((guest) => guest.status === "checked_in").length;

  const toggleCheckIn = (guest: DemoGuest) => {
    const shouldCheckIn = guest.status !== "checked_in";
    onStateChange((current) => setDemoGuestCheckIn(current, guest.id, shouldCheckIn));
    onNotice(shouldCheckIn
      ? demoT("checkedInNotice", { name: guest.name })
      : demoT("checkInUndoneNotice", { name: guest.name }));
  };

  return (
    <WorkspacePage>
      {notice && <Alert type="success" message={notice} className="mb-4" />}
      <OperationsLayout
        title={t("title")}
        dashboard={
          <>
            <div className="context-bar">
              <DatePicker value={selectedDate} onChange={setSelectedDate} businessDate={DEMO_BUSINESS_DATE} />
              <div className="context-filter-grid">
                <div className="min-w-0">
                  <label htmlFor="demo-door-owner" className="type-context-title">{t("guestOwner")}</label>
                  <div className="relative">
                    <select id="demo-door-owner" value={selectedOwner} onChange={(event) => setSelectedOwner(event.target.value)} className="app-field appearance-none pr-10">
                      <option value="all">{t("allOwners")}</option>
                      {owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
                    </select>
                    <Icon name="chevron-down" size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  </div>
                </div>
              </div>
            </div>
            <section className="app-panel" aria-labelledby="demo-door-dashboard-title">
              <PanelHeader
                title={t("title")}
                headingLevel={2}
                headingId="demo-door-dashboard-title"
                count={displayGuests.length}
                sortMode={sortMode}
                onSortToggle={() => setSortMode((current) => current === "default" ? "alpha" : "default")}
                onRefresh={() => onStateChange((current) => ({ ...current }))}
              />
              <GuestSearchInput value={searchQuery} onChange={setSearchQuery} />
              <StatGrid items={[
                { label: t("waiting"), value: displayGuests.length - checked, color: "waiting" },
                { label: t("checkedIn"), value: checked, color: "checked" },
                { label: t("total"), value: displayGuests.length },
              ]} />
            </section>
          </>
        }
      >
        <section className="main-content-panel" aria-labelledby="demo-door-list-title">
          <PanelHeader title={t("guestList")} headingLevel={2} headingId="demo-door-list-title" count={displayGuests.length} />
          {displayGuests.length === 0 ? (
            <EmptyState icon="user" message={searchQuery ? t("noSearchResults") : t("noGuestsForDate")} />
          ) : (
            <div className="divide-y divide-border-subtle">
              {displayGuests.map((guest, index) => (
                <GuestListCard
                  key={guest.id}
                  guest={toGuestCard(guest)}
                  index={index}
                  mode="operations"
                  djName={guest.host}
                  onCheck={guest.status === "waiting" ? () => toggleCheckIn(guest) : undefined}
                  onUndo={guest.status === "checked_in" ? () => toggleCheckIn(guest) : undefined}
                />
              ))}
            </div>
          )}
        </section>
      </OperationsLayout>
    </WorkspacePage>
  );
}

function DemoAdminOperations({
  state,
  activeTab,
  activeGuestTab,
  notice,
  onStateChange,
  onNotice,
  onTabChange,
  onGuestTabChange,
}: {
  state: DemoState;
  activeTab: AdminTab;
  activeGuestTab: AdminGuestTab;
  notice: string;
  onStateChange: React.Dispatch<React.SetStateAction<DemoState>>;
  onNotice: (message: string) => void;
  onTabChange: (tab: AdminTab) => void;
  onGuestTabChange: (tab: AdminGuestTab) => void;
}) {
  const t = useTranslations("AdminNav");
  const tabs: Array<{ id: AdminTab; label: string; icon: IconName; shortcut: string }> = [
    { id: "guests", label: t("guests"), icon: "users", shortcut: "1" },
    { id: "links", label: t("links"), icon: "link", shortcut: "2" },
    { id: "users", label: t("users"), icon: "user-admin", shortcut: "3" },
  ];

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const tab = tabs[nextIndex];
    onTabChange(tab.id);
    document.getElementById(`demo-admin-tab-${tab.id}`)?.focus();
  };

  return (
    <WorkspacePage>
      {notice && <Alert type="success" message={notice} className="mb-4" />}
      <div className="mb-4 flex-shrink-0 lg:mb-6">
        <div role="tablist" aria-label={t("sections")} className="grid grid-cols-3 divide-x divide-border-subtle border border-border-subtle bg-surface">
          {tabs.map((tab, index) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`demo-admin-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => onTabChange(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={`relative z-10 min-h-14 p-3 text-sm font-medium after:absolute after:inset-x-0 after:-bottom-px after:h-px focus-visible:outline-none sm:p-4 ${selected ? "bg-surface-raised font-semibold text-text-heading after:bg-action-primary" : "bg-surface text-text-muted after:bg-transparent hover:bg-surface-raised hover:text-text-heading"}`}
              >
                <span className="flex items-center justify-center gap-2">
                  <Icon name={tab.icon} size={18} />
                  <span className="text-xs sm:text-sm">{tab.label}</span>
                  <span className="ml-1 hidden border border-border-default px-1 py-0.5 font-mono text-xs text-text-dim lg:inline-block">[{tab.shortcut}]</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div role="tabpanel" aria-labelledby={`demo-admin-tab-${activeTab}`} className="flex min-h-0 flex-col">
        {activeTab === "guests" && (
          <>
            <div role="tablist" aria-label={t("guestSections")} className="mb-4 grid grid-cols-2 divide-x divide-border-subtle border border-border-subtle bg-surface">
              {(["list", "requests"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={activeGuestTab === tab}
                  onClick={() => onGuestTabChange(tab)}
                  className={`min-h-11 px-4 py-2 text-sm font-medium focus-visible:outline-none ${activeGuestTab === tab ? "bg-surface-raised text-text-heading" : "text-text-muted hover:bg-surface-raised hover:text-text-heading"}`}
                >
                  {tab === "list" ? t("guestList") : t("requests")}
                </button>
              ))}
            </div>
            {activeGuestTab === "list" ? (
              <DemoAdminGuestList state={state} onStateChange={onStateChange} />
            ) : (
              <DemoRequestManagement requests={state.requests} onStateChange={onStateChange} onNotice={onNotice} />
            )}
          </>
        )}
        {activeTab === "links" && <DemoLinkManagement links={state.links} onStateChange={onStateChange} onNotice={onNotice} />}
        {activeTab === "users" && <DemoUserManagement />}
      </div>
    </WorkspacePage>
  );
}

function DemoAdminGuestList({ state, onStateChange }: { state: DemoState; onStateChange: React.Dispatch<React.SetStateAction<DemoState>> }) {
  const t = useTranslations("AdminGuest");
  const [selectedDate, setSelectedDate] = useState(DEMO_BUSINESS_DATE);
  const [selectedOwner, setSelectedOwner] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<"default" | "alpha">("default");
  const scoped = state.guests.filter((guest) => (guest.date ?? DEMO_BUSINESS_DATE) === selectedDate);
  const owners = Array.from(new Set(scoped.map((guest) => guest.host))).sort();
  const owned = selectedOwner === "all" ? scoped : scoped.filter((guest) => guest.host === selectedOwner);
  const display = filterGuests(sortGuests(owned, sortMode), searchQuery);
  const checked = display.filter((guest) => guest.status === "checked_in").length;
  return (
    <OperationsLayout
      title={t("title")}
      dashboard={
        <>
          <div className="context-bar">
            <DatePicker value={selectedDate} onChange={setSelectedDate} businessDate={DEMO_BUSINESS_DATE} />
            <div className="context-filter-grid">
              <div>
                <label htmlFor="demo-admin-owner" className="type-context-title">{t("userFilter")}</label>
                <select id="demo-admin-owner" value={selectedOwner} onChange={(event) => setSelectedOwner(event.target.value)} className="app-field">
                  <option value="all">{t("allUsers")}</option>
                  {owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
                </select>
              </div>
            </div>
          </div>
          <section className="app-panel">
            <PanelHeader title={t("totalOverview")} headingLevel={2} sortMode={sortMode} onSortToggle={() => setSortMode((current) => current === "default" ? "alpha" : "default")} onRefresh={() => onStateChange((current) => ({ ...current }))} />
            <GuestSearchInput value={searchQuery} onChange={setSearchQuery} />
            <StatGrid items={[
              { label: t("totalGuests"), value: display.length },
              { label: t("waiting"), value: display.length - checked, color: "waiting" },
              { label: t("checked"), value: checked, color: "checked" },
            ]} />
          </section>
        </>
      }
    >
      <section className="main-content-panel" aria-labelledby="demo-admin-guest-list-title">
        <PanelHeader title={t("guestList")} count={display.length} headingLevel={2} headingId="demo-admin-guest-list-title" />
        {display.length === 0 ? (
          <EmptyState icon="users" message={searchQuery ? t("noSearchResults") : t("noGuestsForDate")} />
        ) : (
          <div className="divide-y divide-border-subtle">
            {display.map((guest, index) => (
              <GuestListCard key={guest.id} guest={toGuestCard(guest)} index={index} mode="operations" djName={guest.host} showRegisteredAt onDelete={() => onStateChange((current) => deleteDemoGuest(current, guest.id))} />
            ))}
          </div>
        )}
      </section>
    </OperationsLayout>
  );
}

function DemoRequestManagement({
  requests,
  onStateChange,
  onNotice,
}: {
  requests: DemoGuestLimitRequest[];
  onStateChange: React.Dispatch<React.SetStateAction<DemoState>>;
  onNotice: (message: string) => void;
}) {
  const t = useTranslations("GuestLimitAdmin");
  const pending = requests.filter((request) => request.status === "pending");
  const decided = requests.filter((request) => request.status !== "pending");
  const [approvedAmounts, setApprovedAmounts] = useState<Record<string, number>>(() => Object.fromEntries(requests.map((request) => [request.id, request.requestedCount])));
  const decide = (request: DemoGuestLimitRequest, decision: "approved" | "declined") => {
    onStateChange((current) =>
      decideDemoRequest(current, request.id, decision, {
        approvedCount: approvedAmounts[request.id],
      }),
    );
    onNotice(decision === "approved" ? t("approved") : t("rejected"));
  };
  return (
    <section className="app-panel" aria-labelledby="demo-request-title">
      <PanelHeader title={t("title")} headingId="demo-request-title" count={pending.length} onRefresh={() => onStateChange((current) => ({ ...current }))} />
      <div className="space-y-4 p-4 sm:p-5">
        {pending.length === 0 ? (
          <EmptyState icon="user" message={t("noPending")} />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {pending.map((request) => (
              <article key={request.id} className="border border-border-default bg-canvas p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="type-row-title">{request.requester}</h3>
                    <p className="mt-1 text-xs text-text-muted"><RoleLabel role={request.role} /> · {DEMO_BUSINESS_DATE}</p>
                  </div>
                  <span className="font-mono text-lg text-text-heading">+{request.requestedCount}</span>
                </div>
                <p className="mt-3 min-h-5 text-sm text-text-body">{request.reason || t("noReason")}</p>
                <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <div>
                    <label htmlFor={`demo-approved-${request.id}`} className="sr-only">{t("approvedCount")}</label>
                    <input id={`demo-approved-${request.id}`} type="number" min={1} max={request.requestedCount} value={approvedAmounts[request.id] ?? request.requestedCount} onChange={(event) => setApprovedAmounts((current) => ({ ...current, [request.id]: Number.parseInt(event.target.value, 10) }))} className="app-field" />
                  </div>
                  <button type="button" onClick={() => decide(request, "approved")} className="bg-action-primary px-4 py-2 text-xs font-semibold text-action-text">{t("approve")}</button>
                  <button type="button" onClick={() => decide(request, "declined")} className="border border-status-danger/70 bg-status-danger/10 px-4 py-2 text-xs font-semibold text-status-danger">{t("reject")}</button>
                </div>
              </article>
            ))}
          </div>
        )}
        {decided.length > 0 && (
          <details className="border-t border-border-default pt-4">
            <summary className="cursor-pointer text-sm font-medium text-text-heading">{t("history", { count: decided.length })}</summary>
            <div className="mt-3 divide-y divide-border-subtle border border-border-default bg-canvas">
              {decided.map((request) => (
                <div key={request.id} className="flex items-center justify-between gap-3 p-3 text-xs">
                  <span className="text-text-body">{request.requester} · {DEMO_BUSINESS_DATE}</span>
                  <span className="font-mono text-text-muted">{request.status === "approved" ? t("approvedHistory", { count: request.approvedCount ?? 0 }) : t("rejectedHistory")}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

function DemoLinkManagement({
  links,
  onStateChange,
  onNotice,
}: {
  links: DemoExternalLink[];
  onStateChange: React.Dispatch<React.SetStateAction<DemoState>>;
  onNotice: (message: string) => void;
}) {
  const t = useTranslations("LinkAdmin");
  const demoT = useTranslations("Demo");
  const [activeSection, setActiveSection] = useState<"create" | "manage">("manage");
  const [selectedDate, setSelectedDate] = useState(DEMO_BUSINESS_DATE);
  const [label, setLabel] = useState("");
  const [capacity, setCapacity] = useState(20);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!label.trim()) return;
    onStateChange((current) => createDemoLink(current, { label, capacity }));
    onNotice(demoT("linkCreatedNotice", { label: label.trim() }));
    setLabel("");
    setActiveSection("manage");
  };
  return (
    <OperationsLayout
      title={t("title")}
      dashboard={
        <>
          <div className="context-bar">
            <DatePicker value={selectedDate} onChange={setSelectedDate} businessDate={DEMO_BUSINESS_DATE} />
          </div>
          <div className="app-panel p-4 sm:p-5">
            <h3 className="type-context-title mb-3">{t("section")}</h3>
            <div className="space-y-2">
              {(["create", "manage"] as const).map((section) => (
                <button key={section} type="button" onClick={() => setActiveSection(section)} className={`flex w-full items-center gap-2 border border-border-default p-3 text-left text-sm font-medium ${activeSection === section ? "border-l-2 border-l-action-primary bg-surface-raised text-text-heading" : "bg-surface-raised text-text-muted hover:text-text-heading"}`}>
                  <Icon name={section === "create" ? "add" : "link"} size={17} />
                  {section === "create" ? t("create") : t("manage")}
                </button>
              ))}
            </div>
          </div>
          <section className="app-panel">
            <PanelHeader title={t("manageLinks")} headingLevel={2} />
            <StatGrid items={[
              { label: t("total"), value: links.length },
              { label: t("active"), value: links.filter((link) => link.status === "active").length, color: "checked" },
              { label: t("attention"), value: links.filter((link) => link.used >= link.capacity).length, color: "waiting" },
            ]} />
          </section>
        </>
      }
    >
      {activeSection === "create" ? (
        <section className="app-panel p-4 sm:p-5" aria-labelledby="demo-create-link-title">
          <h2 id="demo-create-link-title" className="type-section-title">{t("createAccessLink")}</h2>
          <p className="mt-2 text-sm text-text-muted">{t("createAccessDescription")}</p>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <label htmlFor="demo-link-label" className="app-label">{t("eventName")}</label>
              <input id="demo-link-label" value={label} onChange={(event) => setLabel(event.target.value)} className="app-field" required />
            </div>
            <div>
              <label htmlFor="demo-link-capacity" className="app-label">{t("maxGuests")}</label>
              <input id="demo-link-capacity" type="number" min={1} max={100} value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} className="app-field" required />
            </div>
            <Button type="submit" fullWidth leftIcon={<Icon name="link" size={16} />}>{t("generateLink")}</Button>
          </form>
        </section>
      ) : (
        <section className="main-content-panel" aria-labelledby="demo-link-list-title">
          <PanelHeader title={t("linkList")} count={links.length} headingLevel={2} headingId="demo-link-list-title" onRefresh={() => onStateChange((current) => ({ ...current }))} />
          {links.length === 0 ? (
            <EmptyState icon="link" message={t("noLinks")} />
          ) : (
            <div className="divide-y divide-border-subtle">
              {links.map((link) => (
                <article key={link.id} className="px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="type-row-title">{link.label}</h3>
                      <p className="mt-1 break-all font-mono text-xs text-text-dim">demo.authon.stann.kr/guest/{link.id}</p>
                    </div>
                    <StatusLabel tone={link.status === "active" ? "checked" : "neutral"} appearance="inline">{link.status === "active" ? t("active") : t("inactive")}</StatusLabel>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="h-1.5 flex-1 bg-surface-raised" aria-hidden="true"><div className="h-full bg-status-checked" style={{ width: `${Math.min(100, link.used / link.capacity * 100)}%` }} /></div>
                    <span className="font-mono text-xs text-text-muted">{link.used}/{link.capacity}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </OperationsLayout>
  );
}

function DemoUserManagement() {
  const t = useTranslations("UserAdmin");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const filtered = DEMO_USERS.filter((user) =>
    (role === "all" || user.role === role) &&
    (!query.trim() || `${user.name} ${user.email}`.toLowerCase().includes(query.trim().toLowerCase())),
  );
  return (
    <OperationsLayout
      title={t("title")}
      dashboard={
        <div className="app-panel p-4 sm:p-5">
          <h3 className="type-context-title mb-3">{t("section")}</h3>
          <button type="button" className="flex w-full items-center gap-2 border border-border-default border-l-2 border-l-action-primary bg-surface-raised p-3 text-left text-sm font-medium text-text-heading">
            <Icon name="users" size={17} />
            {t("users")}
          </button>
          <div className="mt-4 space-y-3">
            <StatGrid items={[
              { label: "DJ", value: DEMO_USERS.filter((user) => user.role === "dj").length },
              { label: t("staff"), value: DEMO_USERS.filter((user) => user.role === "staff").length },
              { label: t("door"), value: DEMO_USERS.filter((user) => user.role === "door_staff").length },
              { label: t("admin"), value: DEMO_USERS.filter((user) => user.role === "venue_admin").length, color: "danger" },
            ]} />
            <StatGrid items={[
              { label: t("ready"), value: DEMO_USERS.filter((user) => user.active).length },
              { label: t("setupPending"), value: 0, color: "waiting" },
              { label: t("inactive"), value: DEMO_USERS.filter((user) => !user.active).length, color: "danger" },
            ]} />
          </div>
        </div>
      }
    >
      <section className="app-panel" aria-labelledby="demo-user-list-title">
        <PanelHeader title={t("userList")} count={filtered.length} headingLevel={2} headingId="demo-user-list-title" />
        <div className="p-4">
          <div className="mb-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_180px]">
            <div>
              <label htmlFor="demo-user-search" className="app-label">{t("searchUsers")}</label>
              <input id="demo-user-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} className="app-field" placeholder={t("searchPlaceholder")} />
            </div>
            <div>
              <label htmlFor="demo-user-role" className="app-label">{t("roleFilter")}</label>
              <select id="demo-user-role" value={role} onChange={(event) => setRole(event.target.value)} className="app-field">
                <option value="all">{t("allRoles")}</option>
                <option value="venue_admin">{t("roleVenueAdmin")}</option>
                <option value="door_staff">{t("roleDoorStaff")}</option>
                <option value="staff">{t("roleStaff")}</option>
                <option value="dj">{t("roleDj")}</option>
              </select>
            </div>
          </div>
          {filtered.length === 0 ? (
            <EmptyState icon="users" message={t("noMatchingUsers")} />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {filtered.map((user) => (
                <article key={user.id} className="app-panel p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="type-row-title font-mono tracking-wider">{user.name}</h3>
                      <p className="truncate font-mono text-xs text-text-muted sm:text-sm">{user.email}</p>
                    </div>
                    <StatusLabel tone="checked" appearance="inline">{t("active")}</StatusLabel>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-border-subtle pt-3 text-xs text-text-muted">
                    <RoleLabel role={user.role} />
                    <span>{t("guestLimit")}: <span className="font-mono text-text-heading">{user.guestLimit ?? "∞"}</span></span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </OperationsLayout>
  );
}

function WorkspacePage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col overflow-x-hidden pt-20 sm:pt-24">
      <div className="page-container">{children}</div>
      <Footer text={DEMO_VENUE_NAME} />
    </div>
  );
}

function sortGuests(guests: DemoGuest[], mode: "default" | "alpha"): DemoGuest[] {
  return [...guests].sort((left, right) =>
    mode === "alpha"
      ? left.name.localeCompare(right.name)
      : new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

function filterGuests(guests: DemoGuest[], query: string): DemoGuest[] {
  const normalized = query.trim().toLowerCase();
  return normalized
    ? guests.filter((guest) => `${guest.name} ${guest.host}`.toLowerCase().includes(normalized))
    : guests;
}

function toGuestCard(guest: DemoGuest) {
  return {
    id: guest.id,
    name: guest.name,
    status: guest.status === "checked_in" ? "checked" as const : "pending" as const,
    createdAt: guest.createdAt,
    checkInTime: guest.checkedInAt,
    date: guest.date ?? DEMO_BUSINESS_DATE,
  };
}
