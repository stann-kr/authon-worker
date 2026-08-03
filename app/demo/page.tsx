"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import Alert from "@/components/Alert";
import Button from "@/components/Button";
import EmptyState from "@/components/EmptyState";
import Icon, { type IconName } from "@/components/Icon";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import PanelHeader from "@/components/PanelHeader";
import StatGrid from "@/components/StatGrid";
import StatusLabel from "@/components/StatusLabel";
import {
  addDemoGuest,
  createDemoLink,
  createDemoState,
  decideDemoRequest,
  getDemoProgress,
  isDemoState,
  setDemoGuestCheckIn,
  type DemoActivity,
  type DemoExternalLink,
  type DemoGuest,
  type DemoGuestLimitRequest,
  type DemoState,
} from "@/lib/demo/state";

const DEMO_STORAGE_KEY = "authon:portfolio-demo:v1";

type DemoView = "guests" | "door" | "requests" | "links";

interface DemoTab {
  id: DemoView;
  icon: IconName;
  label: string;
}

export default function DemoPage() {
  const t = useTranslations("Demo");
  const [state, setState] = useState<DemoState>(() => createDemoState());
  const [activeView, setActiveView] = useState<DemoView>("guests");
  const [notice, setNotice] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);

  const tabs = useMemo<DemoTab[]>(
    () => [
      { id: "guests", icon: "user-add", label: t("tabGuests") },
      { id: "door", icon: "login", label: t("tabDoor") },
      { id: "requests", icon: "warning", label: t("tabRequests") },
      { id: "links", icon: "link", label: t("tabLinks") },
    ],
    [t],
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(DEMO_STORAGE_KEY);
    if (stored) {
      try {
        const parsed: unknown = JSON.parse(stored);
        if (isDemoState(parsed)) setState(parsed);
      } catch {
        window.localStorage.removeItem(DEMO_STORAGE_KEY);
      }
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  }, [isHydrated, state]);

  const waitingPartyCount = state.guests
    .filter((guest) => guest.status === "waiting")
    .reduce((sum, guest) => sum + guest.partySize, 0);
  const checkedInPartyCount = state.guests
    .filter((guest) => guest.status === "checked_in")
    .reduce((sum, guest) => sum + guest.partySize, 0);
  const pendingRequestCount = state.requests.filter(
    (request) => request.status === "pending",
  ).length;

  const resetDemo = () => {
    if (!window.confirm(t("resetConfirm"))) return;
    setState(createDemoState());
    setActiveView("guests");
    setNotice(t("resetComplete"));
  };

  const selectTabByKeyboard = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    tabIndex: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (tabIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (tabIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    setActiveView(nextTab.id);
    document.getElementById(`demo-tab-${nextTab.id}`)?.focus();
  };

  return (
    <div className="page-shell">
      <header className="border-b border-border-subtle bg-canvas">
        <div className="mx-auto flex min-h-16 w-full max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center border border-border-strong bg-surface font-mono text-xs font-semibold text-text-heading">
              A
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-text-heading">AUTHON</p>
              <p className="truncate font-mono text-[11px] uppercase tracking-[0.12em] text-status-checked">
                {t("sandboxStatus")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher compact />
            <Link
              href="/auth/login"
              className="pressable inline-flex min-h-9 items-center gap-2 border border-border-default px-3 text-xs font-medium text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text-heading"
            >
              <span className="hidden sm:inline">{t("exitDemo")}</span>
              <Icon name="arrow-right" size={16} />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
        <section className="mb-6 grid gap-5 border-b border-border-subtle pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,32rem)] lg:items-end">
          <div>
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.16em] text-text-muted">
              {t("eyebrow")}
            </p>
            <h1 className="max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-text-heading sm:text-4xl lg:text-5xl">
              {t("title")}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-text-muted sm:text-base">
              {t("description")}
            </p>
          </div>
          <div className="border-l-2 border-status-checked bg-status-checked/10 px-4 py-3">
            <p className="text-sm font-semibold text-text-heading">{t("safeTitle")}</p>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              {t("safeDescription")}
            </p>
          </div>
        </section>

        <ScenarioRail
          state={state}
          activeView={activeView}
          onSelect={setActiveView}
        />

        <div className="mt-6">
          <StatGrid
            items={[
              { label: t("statWaiting"), value: waitingPartyCount, color: "waiting" },
              { label: t("statCheckedIn"), value: checkedInPartyCount, color: "checked" },
              { label: t("statRequests"), value: pendingRequestCount },
              { label: t("statLinks"), value: state.links.length },
            ]}
          />
        </div>

        {notice && (
          <Alert
            type="success"
            message={notice}
            className="mt-4"
          />
        )}

        <div className="mt-6">
          <div
            role="tablist"
            aria-label={t("workspaceSections")}
            className="grid grid-cols-2 divide-x divide-y divide-border-subtle border border-border-subtle bg-surface sm:grid-cols-4 sm:divide-y-0"
          >
            {tabs.map((tab, index) => {
              const isActive = activeView === tab.id;
              return (
                <button
                  key={tab.id}
                  id={`demo-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`demo-panel-${tab.id}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => {
                    setActiveView(tab.id);
                    setNotice("");
                  }}
                  onKeyDown={(event) => selectTabByKeyboard(event, index)}
                  className={`relative flex min-h-14 items-center justify-center gap-2 px-3 text-xs font-medium after:absolute after:inset-x-0 after:-bottom-px after:h-px sm:text-sm ${
                    isActive
                      ? "bg-surface-raised text-text-heading after:bg-action-primary"
                      : "bg-surface text-text-muted after:bg-transparent hover:bg-surface-raised hover:text-text-heading"
                  }`}
                >
                  <Icon name={tab.icon} size={18} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div
            id={`demo-panel-${activeView}`}
            role="tabpanel"
            aria-labelledby={`demo-tab-${activeView}`}
            className="mt-4"
          >
            {activeView === "guests" && (
              <GuestRegistrationPanel
                guests={state.guests}
                onAdd={(input) => {
                  setState((current) => addDemoGuest(current, input));
                  setNotice(t("guestAddedNotice", { name: input.name.trim() }));
                }}
              />
            )}
            {activeView === "door" && (
              <DoorPanel
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
              <RequestPanel
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
              <LinkPanel
                links={state.links}
                onCreate={(input) => {
                  setState((current) => createDemoLink(current, input));
                  setNotice(t("linkCreatedNotice", { label: input.label.trim() }));
                }}
              />
            )}
          </div>
        </div>

        <ActivityPanel activity={state.activity} />

        <div className="mt-6 flex flex-col items-start justify-between gap-3 border-t border-border-subtle pt-5 sm:flex-row sm:items-center">
          <p className="max-w-2xl text-xs leading-relaxed text-text-dim">
            {t("persistenceNote")}
          </p>
          <Button variant="danger" size="sm" onClick={resetDemo} leftIcon={<Icon name="refresh" size={16} />}>
            {t("resetDemo")}
          </Button>
        </div>
      </main>
    </div>
  );
}

function ScenarioRail({
  state,
  activeView,
  onSelect,
}: {
  state: DemoState;
  activeView: DemoView;
  onSelect: (view: DemoView) => void;
}) {
  const t = useTranslations("Demo");
  const progress = getDemoProgress(state);
  const missions: Array<{
    view: DemoView;
    label: string;
    complete: boolean;
  }> = [
    { view: "guests", label: t("missionAddGuest"), complete: state.completedSteps.guestAdded },
    { view: "door", label: t("missionCheckIn"), complete: state.completedSteps.guestCheckedIn },
    { view: "requests", label: t("missionReview"), complete: state.completedSteps.requestReviewed },
    { view: "links", label: t("missionCreateLink"), complete: state.completedSteps.linkCreated },
  ];

  return (
    <section aria-labelledby="demo-scenario-title" className="border border-border-subtle bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 sm:px-5">
        <div>
          <h2 id="demo-scenario-title" className="type-panel-title">
            {t("scenarioTitle")}
          </h2>
          <p className="mt-1 text-xs text-text-muted">{t("scenarioDescription")}</p>
        </div>
        <span className="font-mono text-xs text-text-heading">
          {t("scenarioProgress", { complete: progress, total: missions.length })}
        </span>
      </div>
      <ol className="grid md:grid-cols-4">
        {missions.map((mission, index) => (
          <li key={mission.view} className="border-b border-border-subtle last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
            <button
              type="button"
              onClick={() => onSelect(mission.view)}
              aria-current={activeView === mission.view ? "step" : undefined}
              className={`flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left ${
                activeView === mission.view ? "bg-surface-raised" : "hover:bg-surface-raised"
              }`}
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center border font-mono text-xs ${
                  mission.complete
                    ? "border-status-checked bg-status-checked/10 text-status-checked"
                    : "border-border-default text-text-muted"
                }`}
              >
                {mission.complete ? <Icon name="check" size={15} /> : index + 1}
              </span>
              <span className={mission.complete ? "text-sm text-text-muted line-through" : "text-sm font-medium text-text-heading"}>
                {mission.label}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function GuestRegistrationPanel({
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
    <div className="operations-layout">
      <section className="app-panel p-4 sm:p-5" aria-labelledby="demo-add-guest-title">
        <h2 id="demo-add-guest-title" className="type-panel-title">{t("addGuestTitle")}</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">{t("addGuestDescription")}</p>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="demo-guest-name" className="app-label">{t("guestName")}</label>
            <input
              id="demo-guest-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="app-field"
              maxLength={60}
              placeholder={t("guestNamePlaceholder")}
              required
            />
          </div>
          <div>
            <label htmlFor="demo-host" className="app-label">{t("host")}</label>
            <input
              id="demo-host"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              className="app-field"
              maxLength={60}
              required
            />
          </div>
          <div>
            <label htmlFor="demo-party-size" className="app-label">{t("partySize")}</label>
            <input
              id="demo-party-size"
              type="number"
              min={1}
              max={10}
              value={partySize}
              onChange={(event) => setPartySize(Number(event.target.value))}
              className="app-field"
              required
            />
          </div>
          <Button type="submit" fullWidth leftIcon={<Icon name="user-add" size={17} />}>
            {t("addToGuestList")}
          </Button>
        </form>
      </section>

      <GuestListPanel guests={guests} />
    </div>
  );
}

function GuestListPanel({ guests }: { guests: DemoGuest[] }) {
  const t = useTranslations("Demo");
  return (
    <section className="main-content-panel" aria-labelledby="demo-guest-list-title">
      <PanelHeader title={t("guestListTitle")} count={guests.length} headingId="demo-guest-list-title" headingLevel={2} />
      <div className="divide-y divide-border-subtle">
        {guests.map((guest) => (
          <GuestRow key={guest.id} guest={guest} />
        ))}
      </div>
    </section>
  );
}

function GuestRow({
  guest,
  action,
}: {
  guest: DemoGuest;
  action?: React.ReactNode;
}) {
  const t = useTranslations("Demo");
  return (
    <article className={`guest-list-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-l-2 px-4 py-3 sm:px-5 ${guest.status === "checked_in" ? "border-status-checked bg-status-checked/[0.04]" : "border-status-waiting bg-surface"}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="type-row-title truncate">{guest.name}</h3>
          <span className="font-mono text-xs text-text-muted">{t("partyCount", { count: guest.partySize })}</span>
        </div>
        <p className="mt-1 text-xs text-text-muted">{t("hostedBy", { host: guest.host })}</p>
        {guest.status === "checked_in" && (
          <StatusLabel tone="checked" appearance="inline" className="mt-1.5">
            {t("checkedInStatus")}
          </StatusLabel>
        )}
      </div>
      {action}
    </article>
  );
}

function DoorPanel({
  guests,
  onCheckIn,
}: {
  guests: DemoGuest[];
  onCheckIn: (guestId: string, checkedIn: boolean) => void;
}) {
  const t = useTranslations("Demo");
  const [query, setQuery] = useState("");
  const filteredGuests = guests.filter((guest) =>
    `${guest.name} ${guest.host}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  return (
    <div className="operations-layout">
      <section className="app-panel p-4 sm:p-5" aria-labelledby="demo-door-title">
        <h2 id="demo-door-title" className="type-panel-title">{t("doorTitle")}</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">{t("doorDescription")}</p>
        <div className="mt-5">
          <label htmlFor="demo-door-search" className="app-label">{t("searchGuest")}</label>
          <div className="relative">
            <Icon name="search" size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-dim" />
            <input
              id="demo-door-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="app-field guest-search-input pl-11"
              placeholder={t("searchPlaceholder")}
            />
          </div>
        </div>
        <div className="mt-5 border-t border-border-subtle pt-4">
          <p className="font-mono text-xs uppercase tracking-[0.12em] text-text-dim">{t("doorTipLabel")}</p>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">{t("doorTip")}</p>
        </div>
      </section>

      <section className="main-content-panel" aria-labelledby="demo-door-list-title">
        <PanelHeader title={t("doorListTitle")} count={filteredGuests.length} headingId="demo-door-list-title" headingLevel={2} />
        {filteredGuests.length === 0 ? (
          <EmptyState icon="search" message={t("noGuestsFound")} description={t("noGuestsFoundDescription")} />
        ) : (
          <div className="divide-y divide-border-subtle">
            {filteredGuests.map((guest) => (
              <GuestRow
                key={guest.id}
                guest={guest}
                action={
                  <Button
                    size="sm"
                    variant={guest.status === "checked_in" ? "ghost" : "primary"}
                    onClick={() => onCheckIn(guest.id, guest.status !== "checked_in")}
                    leftIcon={<Icon name={guest.status === "checked_in" ? "undo" : "login"} size={16} />}
                  >
                    {guest.status === "checked_in" ? t("undo") : t("checkIn")}
                  </Button>
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RequestPanel({
  requests,
  onDecide,
}: {
  requests: DemoGuestLimitRequest[];
  onDecide: (requestId: string, decision: "approved" | "declined") => void;
}) {
  const t = useTranslations("Demo");
  return (
    <div className="operations-layout">
      <section className="app-panel p-4 sm:p-5" aria-labelledby="demo-request-title">
        <h2 id="demo-request-title" className="type-panel-title">{t("requestTitle")}</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">{t("requestDescription")}</p>
        <div className="mt-5 border-l-2 border-status-waiting bg-status-waiting/10 px-4 py-3">
          <p className="font-mono text-xs text-status-waiting">{t("policyLabel")}</p>
          <p className="mt-1 text-sm leading-relaxed text-text-muted">{t("policyDescription")}</p>
        </div>
      </section>

      <section className="main-content-panel" aria-labelledby="demo-request-list-title">
        <PanelHeader title={t("requestListTitle")} count={requests.length} headingId="demo-request-list-title" headingLevel={2} />
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
                    {request.status === "approved"
                      ? t("approvedStatus", { count: request.approvedCount ?? 0 })
                      : t("declinedStatus")}
                  </StatusLabel>
                )}
              </div>
              {request.status === "pending" && (
                <div className="flex gap-2">
                  <Button variant="danger" size="sm" onClick={() => onDecide(request.id, "declined")}>
                    {t("decline")}
                  </Button>
                  <Button size="sm" onClick={() => onDecide(request.id, "approved")} leftIcon={<Icon name="check" size={16} />}>
                    {t("approve")}
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function LinkPanel({
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
    <div className="operations-layout">
      <section className="app-panel p-4 sm:p-5" aria-labelledby="demo-link-title">
        <h2 id="demo-link-title" className="type-panel-title">{t("linkTitle")}</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">{t("linkDescription")}</p>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="demo-link-label" className="app-label">{t("linkLabel")}</label>
            <input
              id="demo-link-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              className="app-field"
              maxLength={80}
              placeholder={t("linkLabelPlaceholder")}
              required
            />
          </div>
          <div>
            <label htmlFor="demo-link-capacity" className="app-label">{t("capacity")}</label>
            <input
              id="demo-link-capacity"
              type="number"
              min={1}
              max={100}
              value={capacity}
              onChange={(event) => setCapacity(Number(event.target.value))}
              className="app-field"
              required
            />
          </div>
          <Button type="submit" fullWidth leftIcon={<Icon name="link" size={17} />}>
            {t("createLink")}
          </Button>
        </form>
      </section>

      <section className="main-content-panel" aria-labelledby="demo-link-list-title">
        <PanelHeader title={t("linkListTitle")} count={links.length} headingId="demo-link-list-title" headingLevel={2} />
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
                  <div
                    className="h-full bg-status-checked"
                    style={{ width: `${Math.min(100, (link.used / link.capacity) * 100)}%` }}
                  />
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

function ActivityPanel({ activity }: { activity: DemoActivity[] }) {
  const t = useTranslations("Demo");
  const locale = useLocale();
  const formatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
    [locale],
  );

  const activityLabel = (item: DemoActivity) => {
    switch (item.kind) {
      case "guest_added":
        return t("activityGuestAdded", { subject: item.subject });
      case "guest_checked_in":
        return t("activityGuestCheckedIn", { subject: item.subject });
      case "guest_check_in_undone":
        return t("activityGuestCheckInUndone", { subject: item.subject });
      case "request_approved":
        return t("activityRequestApproved", { subject: item.subject });
      case "request_declined":
        return t("activityRequestDeclined", { subject: item.subject });
      case "link_created":
        return t("activityLinkCreated", { subject: item.subject });
    }
  };

  return (
    <section className="mt-6 border border-border-subtle bg-surface" aria-labelledby="demo-activity-title">
      <PanelHeader title={t("activityTitle")} count={activity.length} headingId="demo-activity-title" headingLevel={2} />
      <ol className="divide-y divide-border-subtle">
        {activity.slice(0, 5).map((item) => (
          <li key={item.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-4 px-4 py-3 text-sm sm:px-5">
            <time dateTime={item.createdAt} className="font-mono text-xs text-text-dim">
              {formatter.format(new Date(item.createdAt))}
            </time>
            <span className="text-text-body">{activityLabel(item)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
