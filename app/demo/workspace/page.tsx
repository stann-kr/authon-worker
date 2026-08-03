"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import Alert from "@/components/Alert";
import Button from "@/components/Button";
import EmptyState from "@/components/EmptyState";
import Icon, { type IconName } from "@/components/Icon";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import PanelHeader from "@/components/PanelHeader";
import RoleLabel from "@/components/RoleLabel";
import Spinner from "@/components/Spinner";
import StatGrid from "@/components/StatGrid";
import StatusLabel from "@/components/StatusLabel";
import { getDemoAccess, type DemoAccess, type DemoSession } from "@/lib/demo/auth";
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
  setDemoGuestCheckIn,
  type DemoActivity,
  type DemoExternalLink,
  type DemoGuest,
  type DemoGuestLimitRequest,
  type DemoState,
} from "@/lib/demo/state";

type WorkspaceView = "overview" | DemoAccess;

interface WorkspaceNavItem {
  id: WorkspaceView;
  icon: IconName;
  label: string;
}

export default function DemoWorkspacePage() {
  const t = useTranslations("Demo");
  const [state, setState] = useState<DemoState>(() => createDemoState());
  const [session, setSession] = useState<DemoSession | null>(null);
  const [activeView, setActiveView] = useState<WorkspaceView>("overview");
  const [notice, setNotice] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const storedSession = readDemoSession(window.sessionStorage);
    const requestedView = new URLSearchParams(window.location.search).get("view");
    setState(readDemoState(window.localStorage));
    setSession(storedSession);
    if (
      storedSession &&
      isWorkspaceView(requestedView) &&
      (requestedView === "overview" || getDemoAccess(storedSession.role).includes(requestedView))
    ) {
      setActiveView(requestedView);
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (isHydrated) writeDemoState(window.localStorage, state);
  }, [isHydrated, state]);

  const allowedViews = useMemo(
    () => (session ? getDemoAccess(session.role) : []),
    [session],
  );

  const navigation = useMemo<WorkspaceNavItem[]>(() => {
    const allItems: WorkspaceNavItem[] = [
      { id: "overview", icon: "home", label: t("workspaceOverview") },
      { id: "guests", icon: "user-add", label: t("tabGuests") },
      { id: "door", icon: "login", label: t("tabDoor") },
      { id: "requests", icon: "warning", label: t("tabRequests") },
      { id: "links", icon: "link", label: t("tabLinks") },
    ];
    return allItems.filter(
      (item) => item.id === "overview" || allowedViews.includes(item.id),
    );
  }, [allowedViews, t]);

  if (!isHydrated) {
    return <Spinner mode="fullscreen" text={t("loadingWorkspace")} />;
  }

  if (!session) {
    return <WorkspaceSessionRequired />;
  }

  const waitingPartyCount = state.guests
    .filter((guest) => guest.status === "waiting")
    .reduce((sum, guest) => sum + guest.partySize, 0);
  const checkedInPartyCount = state.guests
    .filter((guest) => guest.status === "checked_in")
    .reduce((sum, guest) => sum + guest.partySize, 0);
  const pendingRequestCount = state.requests.filter(
    (request) => request.status === "pending",
  ).length;

  const currentNav = navigation.find((item) => item.id === activeView) ?? navigation[0];
  const selectView = (view: WorkspaceView) => {
    setActiveView(view);
    setNotice("");
    const url = new URL(window.location.href);
    if (view === "overview") url.searchParams.delete("view");
    else url.searchParams.set("view", view);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };
  const signOut = () => {
    clearDemoSession(window.sessionStorage);
    setSession(null);
  };
  const resetDemo = () => {
    if (!window.confirm(t("resetConfirm"))) return;
    setState(createDemoState());
    setActiveView("overview");
    setNotice(t("resetComplete"));
  };

  return (
    <div className="min-h-[100dvh] bg-canvas lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <WorkspaceSidebar
        session={session}
        navigation={navigation}
        activeView={activeView}
        onSelect={selectView}
        onSignOut={signOut}
      />

      <div className="min-w-0">
        <WorkspaceTopBar session={session} onSignOut={signOut} />
        <ShiftStrip
          waiting={waitingPartyCount}
          checkedIn={checkedInPartyCount}
          pendingRequests={pendingRequestCount}
          showRequests={session.role === "venue_admin"}
        />
        <WorkspaceMobileNavigation
          navigation={navigation}
          activeView={activeView}
          onSelect={selectView}
        />

        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
          <div className="mb-6 flex flex-col gap-4 border-b border-border-subtle pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-dim">
                {t("workspaceEyebrow")}
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-text-heading sm:text-3xl">
                {currentNav.label}
              </h1>
              <WorkspaceViewDescription view={activeView} />
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/demo"
                className="pressable inline-flex min-h-11 items-center gap-2 border border-border-default px-4 text-xs font-medium text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text-heading"
              >
                <Icon name="arrow-left" size={15} />
                {t("guidedMode")}
              </Link>
              <Button
                variant="danger"
                size="sm"
                onClick={resetDemo}
                leftIcon={<Icon name="refresh" size={15} />}
              >
                {t("resetDemo")}
              </Button>
            </div>
          </div>

          {notice && <Alert type="success" message={notice} className="mb-5" />}

          {activeView === "overview" && (
            <WorkspaceOverview
              state={state}
              session={session}
              allowedViews={allowedViews}
              waiting={waitingPartyCount}
              checkedIn={checkedInPartyCount}
              pendingRequests={pendingRequestCount}
              onSelect={selectView}
            />
          )}
          {activeView === "guests" && (
            <GuestWorkspace
              guests={state.guests}
              onAdd={(input) => {
                setState((current) => addDemoGuest(current, input));
                setNotice(t("guestAddedNotice", { name: input.name.trim() }));
              }}
            />
          )}
          {activeView === "door" && (
            <DoorWorkspace
              guests={state.guests}
              onCheckIn={(guestId, checkedIn) => {
                const guest = state.guests.find((candidate) => candidate.id === guestId);
                setState((current) => setDemoGuestCheckIn(current, guestId, checkedIn));
                if (guest) {
                  setNotice(
                    checkedIn
                      ? t("checkedInNotice", { name: guest.name })
                      : t("checkInUndoneNotice", { name: guest.name }),
                  );
                }
              }}
            />
          )}
          {activeView === "requests" && (
            <RequestWorkspace
              requests={state.requests}
              onDecide={(requestId, decision) => {
                const request = state.requests.find((candidate) => candidate.id === requestId);
                setState((current) => decideDemoRequest(current, requestId, decision));
                if (request) {
                  setNotice(
                    decision === "approved"
                      ? t("requestApprovedNotice", { name: request.requester })
                      : t("requestDeclinedNotice", { name: request.requester }),
                  );
                }
              }}
            />
          )}
          {activeView === "links" && (
            <LinkWorkspace
              links={state.links}
              onCreate={(input) => {
                setState((current) => createDemoLink(current, input));
                setNotice(t("linkCreatedNotice", { label: input.label.trim() }));
              }}
            />
          )}

          <p className="mt-8 border-t border-border-subtle pt-5 text-xs leading-relaxed text-text-dim">
            {t("persistenceNote")}
          </p>
        </main>
      </div>
    </div>
  );
}

function isWorkspaceView(value: string | null): value is WorkspaceView {
  return (
    value === "overview" ||
    value === "guests" ||
    value === "door" ||
    value === "requests" ||
    value === "links"
  );
}

function WorkspaceViewDescription({ view }: { view: WorkspaceView }) {
  const t = useTranslations("Demo");
  let description: string;
  switch (view) {
    case "overview":
      description = t("workspaceOverviewDescription");
      break;
    case "guests":
      description = t("addGuestDescription");
      break;
    case "door":
      description = t("doorDescription");
      break;
    case "requests":
      description = t("requestDescription");
      break;
    case "links":
      description = t("linkDescription");
      break;
  }
  return <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">{description}</p>;
}

function WorkspaceSessionRequired() {
  const t = useTranslations("Demo");
  return (
    <div className="page-shell">
      <header className="border-b border-border-subtle bg-canvas">
        <div className="mx-auto flex min-h-16 w-full max-w-[1040px] items-center justify-between px-4 sm:px-6">
          <AuthonMark />
          <LanguageSwitcher compact />
        </div>
      </header>
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
          <Link
            href="/demo"
            className="pressable mt-6 inline-flex min-h-11 items-center gap-2 border border-action-primary bg-action-primary px-5 text-sm font-semibold text-action-text hover:bg-action-hover"
          >
            {t("chooseDemoAccount")}
            <Icon name="arrow-right" size={16} />
          </Link>
        </section>
      </main>
    </div>
  );
}

function AuthonMark() {
  const t = useTranslations("Demo");
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-9 w-9 place-items-center border border-border-strong bg-surface font-mono text-xs font-semibold text-text-heading">
        A
      </div>
      <div>
        <p className="text-sm font-semibold text-text-heading">AUTHON</p>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-status-checked">
          {t("workspaceMode")}
        </p>
      </div>
    </div>
  );
}

function WorkspaceSidebar({
  session,
  navigation,
  activeView,
  onSelect,
  onSignOut,
}: {
  session: DemoSession;
  navigation: WorkspaceNavItem[];
  activeView: WorkspaceView;
  onSelect: (view: WorkspaceView) => void;
  onSignOut: () => void;
}) {
  const t = useTranslations("Demo");
  return (
    <aside className="sticky top-0 hidden h-[100dvh] flex-col border-r border-border-subtle bg-surface lg:flex">
      <div className="border-b border-border-subtle px-5 py-5">
        <AuthonMark />
        <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-dim">
          {t("venueName")}
        </p>
        <p className="mt-1 text-sm font-medium text-text-heading">Faust Seoul</p>
      </div>
      <nav className="flex-1 px-3 py-4" aria-label={t("workspaceNavigation")}>
        <p className="px-3 pb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-dim">
          {t("operations")}
        </p>
        <div className="space-y-1">
          {navigation.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={activeView === item.id ? "page" : undefined}
              className={`pressable flex min-h-11 w-full items-center gap-3 border-l-2 px-3 text-left text-sm ${
                activeView === item.id
                  ? "border-action-primary bg-surface-raised text-text-heading"
                  : "border-transparent text-text-muted hover:bg-surface-hover hover:text-text-heading"
              }`}
            >
              <Icon name={item.icon} size={17} />
              {item.label}
            </button>
          ))}
        </div>
      </nav>
      <div className="border-t border-border-subtle p-4">
        <p className="text-sm font-semibold text-text-heading">{session.name}</p>
        <div className="mt-1 text-xs text-text-muted">
          <RoleLabel role={session.role} />
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="pressable mt-4 flex min-h-11 w-full items-center gap-2 border border-border-default px-3 text-xs font-medium text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text-heading"
        >
          <Icon name="logout" size={16} />
          {t("switchAccount")}
        </button>
      </div>
    </aside>
  );
}

function WorkspaceTopBar({
  session,
  onSignOut,
}: {
  session: DemoSession;
  onSignOut: () => void;
}) {
  const t = useTranslations("Demo");
  const locale = useLocale();
  const shiftDate = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Seoul",
      }).format(new Date("2026-08-03T12:00:00.000Z")),
    [locale],
  );
  return (
    <header className="sticky top-0 z-30 border-b border-border-subtle bg-canvas">
      <div className="flex min-h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
        <div className="lg:hidden"><AuthonMark /></div>
        <div className="hidden lg:block">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-dim">
            {t("currentShift")}
          </p>
          <p className="mt-0.5 text-sm font-medium text-text-heading">{shiftDate} · 22:00–06:00</p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher compact />
          <div className="hidden border-l border-border-subtle pl-3 text-right sm:block lg:hidden">
            <p className="text-xs font-medium text-text-heading">{session.name}</p>
            <p className="mt-0.5 text-[11px] text-text-muted"><RoleLabel role={session.role} /></p>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            aria-label={t("switchAccount")}
            className="pressable grid h-11 w-11 place-items-center border border-border-default text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text-heading lg:hidden"
          >
            <Icon name="logout" size={17} />
          </button>
          <Link
            href="/demo"
            className="pressable hidden min-h-11 items-center gap-2 border border-border-default px-4 text-xs font-medium text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text-heading lg:inline-flex"
          >
            {t("guidedMode")}
            <Icon name="arrow-right" size={15} />
          </Link>
        </div>
      </div>
    </header>
  );
}

function ShiftStrip({
  waiting,
  checkedIn,
  pendingRequests,
  showRequests,
}: {
  waiting: number;
  checkedIn: number;
  pendingRequests: number;
  showRequests: boolean;
}) {
  const t = useTranslations("Demo");
  return (
    <dl className={`grid grid-cols-2 border-b border-border-subtle bg-surface ${showRequests ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
      <div className="flex min-h-12 items-center gap-2 border-b border-r border-border-subtle px-4 sm:border-b-0 lg:px-6">
        <span className="h-2 w-2 bg-status-checked" aria-hidden="true" />
        <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-dim">{t("doorStatus")}</dt>
        <dd className="text-xs font-semibold text-status-checked">{t("doorsOpen")}</dd>
      </div>
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border-subtle px-4 sm:border-b-0 sm:border-r lg:px-6">
        <dt className="text-xs text-text-muted">{t("statWaiting")}</dt>
        <dd className="font-mono text-sm text-status-waiting">{waiting}</dd>
      </div>
      <div className={`flex min-h-12 items-center justify-between gap-3 px-4 lg:px-6 ${showRequests ? "border-r border-border-subtle" : "col-span-2 sm:col-span-1"}`}>
        <dt className="text-xs text-text-muted">{t("statCheckedIn")}</dt>
        <dd className="font-mono text-sm text-status-checked">{checkedIn}</dd>
      </div>
      {showRequests && (
        <div className="flex min-h-12 items-center justify-between gap-3 px-4 lg:px-6">
          <dt className="text-xs text-text-muted">{t("statRequests")}</dt>
          <dd className="font-mono text-sm text-text-heading">{pendingRequests}</dd>
        </div>
      )}
    </dl>
  );
}

function WorkspaceMobileNavigation({
  navigation,
  activeView,
  onSelect,
}: {
  navigation: WorkspaceNavItem[];
  activeView: WorkspaceView;
  onSelect: (view: WorkspaceView) => void;
}) {
  const t = useTranslations("Demo");
  return (
    <nav className="overflow-x-auto border-b border-border-subtle bg-surface lg:hidden" aria-label={t("workspaceNavigation")}>
      <div className="flex min-w-max px-2">
        {navigation.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={activeView === item.id ? "page" : undefined}
            className={`pressable flex min-h-12 items-center gap-2 border-b-2 px-3 text-xs font-medium ${
              activeView === item.id
                ? "border-action-primary text-text-heading"
                : "border-transparent text-text-muted"
            }`}
          >
            <Icon name={item.icon} size={15} />
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function WorkspaceOverview({
  state,
  session,
  allowedViews,
  waiting,
  checkedIn,
  pendingRequests,
  onSelect,
}: {
  state: DemoState;
  session: DemoSession;
  allowedViews: readonly DemoAccess[];
  waiting: number;
  checkedIn: number;
  pendingRequests: number;
  onSelect: (view: WorkspaceView) => void;
}) {
  const t = useTranslations("Demo");
  const quickActions = [
    { view: "guests" as const, icon: "user-add" as const, label: t("missionAddGuest") },
    { view: "door" as const, icon: "login" as const, label: t("missionCheckIn") },
    { view: "requests" as const, icon: "warning" as const, label: t("missionReview") },
    { view: "links" as const, icon: "link" as const, label: t("missionCreateLink") },
  ].filter((item) => allowedViews.includes(item.view));

  return (
    <div className="space-y-5">
      <StatGrid
        items={[
          { label: t("statWaiting"), value: waiting, color: "waiting" },
          { label: t("statCheckedIn"), value: checkedIn, color: "checked" },
          ...(session.role === "venue_admin"
            ? [
                { label: t("statRequests"), value: pendingRequests },
                { label: t("statLinks"), value: state.links.length },
              ]
            : []),
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <section className="main-content-panel" aria-labelledby="workspace-roster-title">
          <PanelHeader
            title={t("tonightAtDoor")}
            count={state.guests.length}
            headingId="workspace-roster-title"
            headingLevel={2}
          />
          <GuestRows guests={state.guests.slice(0, 5)} mode="overview" />
          {allowedViews.includes("door") && (
            <button
              type="button"
              onClick={() => onSelect("door")}
              className="pressable flex min-h-12 items-center justify-between border-t border-border-subtle px-4 text-xs font-medium text-text-muted hover:bg-surface-hover hover:text-text-heading sm:px-5"
            >
              {t("openDoorWorkspace")}
              <Icon name="arrow-right" size={15} />
            </button>
          )}
        </section>

        <div className="space-y-5">
          <section className="border border-border-subtle bg-surface" aria-labelledby="quick-actions-title">
            <div className="border-b border-border-subtle px-4 py-4 sm:px-5">
              <h2 id="quick-actions-title" className="type-panel-title">{t("quickActions")}</h2>
              <p className="mt-1 text-xs text-text-muted">{t("roleScopeDescription")}</p>
            </div>
            <div className={`grid ${quickActions.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
              {quickActions.map((action, index) => (
                <button
                  key={action.view}
                  type="button"
                  onClick={() => onSelect(action.view)}
                  className={`pressable flex min-h-24 flex-col items-start justify-between gap-3 p-4 text-left hover:bg-surface-hover ${
                    index % 2 === 0 && index + 1 < quickActions.length
                      ? "border-r border-border-subtle"
                      : ""
                  } ${
                    index < Math.floor((quickActions.length - 1) / 2) * 2
                      ? "border-b border-border-subtle"
                      : ""
                  }`}
                >
                  <Icon name={action.icon} size={18} className="text-text-muted" />
                  <span className="text-sm font-medium text-text-heading">{action.label}</span>
                </button>
              ))}
            </div>
          </section>
          <ActivityFeed activity={state.activity} compact />
        </div>
      </div>
    </div>
  );
}

function GuestWorkspace({
  guests,
  onAdd,
}: {
  guests: DemoGuest[];
  onAdd: (input: { name: string; host: string; partySize: number }) => void;
}) {
  const t = useTranslations("Demo");
  const [name, setName] = useState("");
  const [host, setHost] = useState("Resident DJ");
  const [partySize, setPartySize] = useState(1);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !host.trim()) return;
    onAdd({ name, host, partySize });
    setName("");
    setPartySize(1);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)] lg:items-start">
      <section className="app-panel p-4 sm:p-5" aria-labelledby="workspace-add-guest-title">
        <h2 id="workspace-add-guest-title" className="type-panel-title">{t("addGuestTitle")}</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">{t("addGuestDescription")}</p>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="workspace-guest-name" className="app-label">{t("guestName")}</label>
            <input id="workspace-guest-name" value={name} onChange={(event) => setName(event.target.value)} className="app-field" maxLength={60} placeholder={t("guestNamePlaceholder")} required />
          </div>
          <div>
            <label htmlFor="workspace-host" className="app-label">{t("host")}</label>
            <input id="workspace-host" value={host} onChange={(event) => setHost(event.target.value)} className="app-field" maxLength={60} required />
          </div>
          <div>
            <label htmlFor="workspace-party-size" className="app-label">{t("partySize")}</label>
            <input id="workspace-party-size" type="number" min={1} max={10} value={partySize} onChange={(event) => setPartySize(Number(event.target.value))} className="app-field" required />
          </div>
          <Button type="submit" fullWidth leftIcon={<Icon name="user-add" size={16} />}>{t("addToGuestList")}</Button>
        </form>
      </section>
      <section className="main-content-panel" aria-labelledby="workspace-guest-list-title">
        <PanelHeader title={t("guestListTitle")} count={guests.length} headingId="workspace-guest-list-title" headingLevel={2} />
        <GuestRows guests={guests} mode="overview" />
      </section>
    </div>
  );
}

function DoorWorkspace({
  guests,
  onCheckIn,
}: {
  guests: DemoGuest[];
  onCheckIn: (guestId: string, checkedIn: boolean) => void;
}) {
  const t = useTranslations("Demo");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredGuests = guests.filter(
    (guest) =>
      !normalizedQuery ||
      guest.name.toLocaleLowerCase().includes(normalizedQuery) ||
      guest.host.toLocaleLowerCase().includes(normalizedQuery),
  );

  return (
    <section className="main-content-panel" aria-labelledby="workspace-door-list-title">
      <div className="grid gap-4 border-b border-border-subtle p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:p-5">
        <div>
          <label htmlFor="workspace-door-search" className="app-label">{t("searchGuest")}</label>
          <div className="relative">
            <Icon name="search" size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-dim" />
            <input id="workspace-door-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} className="app-field guest-search-input pl-11" placeholder={t("searchPlaceholder")} />
          </div>
        </div>
        <div className="border-l-2 border-status-checked bg-status-checked/10 px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-status-checked">{t("doorTipLabel")}</p>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-text-muted">{t("doorTip")}</p>
        </div>
      </div>
      <PanelHeader title={t("doorListTitle")} count={filteredGuests.length} headingId="workspace-door-list-title" headingLevel={2} />
      {filteredGuests.length === 0 ? (
        <EmptyState message={t("noGuestsFound")} description={t("noGuestsFoundDescription")} />
      ) : (
        <GuestRows guests={filteredGuests} mode="door" onCheckIn={onCheckIn} />
      )}
    </section>
  );
}

function GuestRows({
  guests,
  mode,
  onCheckIn,
}: {
  guests: DemoGuest[];
  mode: "overview" | "door";
  onCheckIn?: (guestId: string, checkedIn: boolean) => void;
}) {
  const t = useTranslations("Demo");
  return (
    <div className="divide-y divide-border-subtle">
      {guests.map((guest) => (
        <article key={guest.id} className={`guest-list-row grid gap-3 border-l-2 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5 ${guest.status === "checked_in" ? "border-status-checked" : "border-status-waiting"}`}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="type-row-title">{guest.name}</h3>
              <span className="font-mono text-xs text-text-dim">{t("partyCount", { count: guest.partySize })}</span>
              {guest.status === "checked_in" && <StatusLabel tone="checked" appearance="inline">{t("checkedInStatus")}</StatusLabel>}
            </div>
            <p className="mt-1 text-xs text-text-muted">{t("hostedBy", { host: guest.host })}</p>
          </div>
          {mode === "door" && onCheckIn && (
            <Button variant={guest.status === "checked_in" ? "outline" : "primary"} size="sm" onClick={() => onCheckIn(guest.id, guest.status !== "checked_in")} leftIcon={<Icon name={guest.status === "checked_in" ? "undo" : "check"} size={15} />}>
              {guest.status === "checked_in" ? t("undo") : t("checkIn")}
            </Button>
          )}
        </article>
      ))}
    </div>
  );
}

function RequestWorkspace({
  requests,
  onDecide,
}: {
  requests: DemoGuestLimitRequest[];
  onDecide: (requestId: string, decision: "approved" | "declined") => void;
}) {
  const t = useTranslations("Demo");
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(17rem,0.6fr)_minmax(0,1.4fr)] lg:items-start">
      <aside className="border-l-2 border-status-waiting bg-status-waiting/10 p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-status-waiting">{t("policyLabel")}</p>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">{t("policyDescription")}</p>
      </aside>
      <section className="main-content-panel" aria-labelledby="workspace-request-list-title">
        <PanelHeader title={t("requestListTitle")} count={requests.length} headingId="workspace-request-list-title" headingLevel={2} />
        <div className="divide-y divide-border-subtle">
          {requests.map((request) => (
            <article key={request.id} className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="type-row-title">{request.requester}</h3>
                  <span className="font-mono text-xs uppercase text-text-dim">{request.role}</span>
                </div>
                <p className="mt-1 text-sm text-text-body">{t("requestCount", { count: request.requestedCount })}</p>
                <p className="mt-1 text-xs text-text-muted">{request.reason}</p>
                {request.status !== "pending" && (
                  <StatusLabel tone={request.status === "approved" ? "checked" : "danger"} appearance="inline" className="mt-2">
                    {request.status === "approved" ? t("approvedStatus", { count: request.approvedCount ?? 0 }) : t("declinedStatus")}
                  </StatusLabel>
                )}
              </div>
              {request.status === "pending" && (
                <div className="flex gap-2">
                  <Button variant="danger" size="sm" onClick={() => onDecide(request.id, "declined")}>{t("decline")}</Button>
                  <Button size="sm" onClick={() => onDecide(request.id, "approved")} leftIcon={<Icon name="check" size={15} />}>{t("approve")}</Button>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function LinkWorkspace({
  links,
  onCreate,
}: {
  links: DemoExternalLink[];
  onCreate: (input: { label: string; capacity: number }) => void;
}) {
  const t = useTranslations("Demo");
  const [label, setLabel] = useState("");
  const [capacity, setCapacity] = useState(20);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!label.trim()) return;
    onCreate({ label, capacity });
    setLabel("");
    setCapacity(20);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)] lg:items-start">
      <section className="app-panel p-4 sm:p-5" aria-labelledby="workspace-link-title">
        <h2 id="workspace-link-title" className="type-panel-title">{t("linkTitle")}</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">{t("linkDescription")}</p>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="workspace-link-label" className="app-label">{t("linkLabel")}</label>
            <input id="workspace-link-label" value={label} onChange={(event) => setLabel(event.target.value)} className="app-field" maxLength={80} placeholder={t("linkLabelPlaceholder")} required />
          </div>
          <div>
            <label htmlFor="workspace-link-capacity" className="app-label">{t("capacity")}</label>
            <input id="workspace-link-capacity" type="number" min={1} max={100} value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} className="app-field" required />
          </div>
          <Button type="submit" fullWidth leftIcon={<Icon name="link" size={16} />}>{t("createLink")}</Button>
        </form>
      </section>
      <section className="main-content-panel" aria-labelledby="workspace-link-list-title">
        <PanelHeader title={t("linkListTitle")} count={links.length} headingId="workspace-link-list-title" headingLevel={2} />
        <div className="divide-y divide-border-subtle">
          {links.map((link) => (
            <article key={link.id} className="px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="type-row-title">{link.label}</h3>
                  <p className="mt-1 break-all font-mono text-xs text-text-dim">demo.authon.app/g/{link.id}</p>
                </div>
                <StatusLabel tone="checked" appearance="inline">{t("activeStatus")}</StatusLabel>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="h-1.5 flex-1 bg-surface-raised" aria-hidden="true">
                  <div className="h-full bg-status-checked" style={{ width: `${Math.min(100, (link.used / link.capacity) * 100)}%` }} />
                </div>
                <span className="font-mono text-xs text-text-muted">{link.used}/{link.capacity}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ActivityFeed({ activity, compact = false }: { activity: DemoActivity[]; compact?: boolean }) {
  const t = useTranslations("Demo");
  const locale = useLocale();
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }), [locale]);
  const activityLabel = (item: DemoActivity) => {
    switch (item.kind) {
      case "guest_added": return t("activityGuestAdded", { subject: item.subject });
      case "guest_checked_in": return t("activityGuestCheckedIn", { subject: item.subject });
      case "guest_check_in_undone": return t("activityGuestCheckInUndone", { subject: item.subject });
      case "request_approved": return t("activityRequestApproved", { subject: item.subject });
      case "request_declined": return t("activityRequestDeclined", { subject: item.subject });
      case "link_created": return t("activityLinkCreated", { subject: item.subject });
    }
  };

  return (
    <section className="border border-border-subtle bg-surface" aria-labelledby="workspace-activity-title">
      <PanelHeader title={t("activityTitle")} count={activity.length} headingId="workspace-activity-title" headingLevel={2} />
      <ol className="divide-y divide-border-subtle">
        {activity.slice(0, compact ? 4 : 6).map((item) => (
          <li key={item.id} className="grid grid-cols-[4rem_minmax(0,1fr)] gap-3 px-4 py-3 text-sm sm:px-5">
            <time dateTime={item.createdAt} className="font-mono text-xs text-text-dim">{formatter.format(new Date(item.createdAt))}</time>
            <span className="text-xs leading-relaxed text-text-body">{activityLabel(item)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
