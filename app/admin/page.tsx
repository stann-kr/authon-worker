"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useLocalStorage } from "../../lib/hooks";
import AdminHeader from "./components/AdminHeader";
import GuestList from "./components/GuestList";
import LinkManagement from "./components/LinkManagement";
import UserManagement from "./components/UserManagement";
import VenueManagement from "./components/VenueManagement";
import AuthGuard from "../../components/AuthGuard";
import Footer from "../../components/Footer";
import { getBusinessDate, formatDateDisplay } from "../../lib/date";
import { getUser } from "../../lib/auth";

export default function AdminPage() {
  return (
    <AuthGuard requiredAccess={["admin"]}>
      <AdminPageContent />
    </AuthGuard>
  );
}

function offsetDate(baseYmd: string, deltaDays: number): string {
  const ymdMatch = baseYmd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!ymdMatch) return baseYmd;
  const [, y, m, d] = ymdMatch.map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + deltaDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function AdminPageContent() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useLocalStorage(
    "admin:activeTab",
    "guests",
  );
  const [selectedDate, setSelectedDate] = useLocalStorage(
    "admin:selectedDate",
    getBusinessDate(),
  );
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    const user = getUser();
    setIsSuperAdmin(user?.role === "super_admin");
  }, []);

  const tabs = useMemo(
    () => [
      { id: "guests", label: "GUEST", icon: "ri-group-line", shortcut: "1" },
      { id: "links", label: "LINKS", icon: "ri-link", shortcut: "2" },
      { id: "users", label: "USERS", icon: "ri-user-settings-line", shortcut: "3" },
      ...(isSuperAdmin
        ? [{ id: "venues", label: "VENUES", icon: "ri-store-2-line", shortcut: "4" }]
        : []),
    ],
    [isSuperAdmin],
  );

  // Keyboard shortcut listener for tab switching & home return
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === "Escape") {
        router.push("/");
      } else if (e.key === "1" && tabs[0]) {
        setActiveTab(tabs[0].id);
      } else if (e.key === "2" && tabs[1]) {
        setActiveTab(tabs[1].id);
      } else if (e.key === "3" && tabs[2]) {
        setActiveTab(tabs[2].id);
      } else if (e.key === "4" && tabs[3]) {
        setActiveTab(tabs[3].id);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tabs, setActiveTab, router]);

  const isToday = selectedDate === getBusinessDate();

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <AdminHeader />
      <div className="flex-1 overflow-x-hidden pt-20 sm:pt-24 flex flex-col">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 w-full lg:flex-1 lg:min-h-0 flex flex-col">
          {/* Tab Bar */}
          <div className="mb-4 lg:mb-6 flex-shrink-0">
            <div
              role="tablist"
              aria-label="Admin Sections"
              className={`grid ${tabs.length === 4 ? "grid-cols-4" : "grid-cols-3"} gap-px bg-gray-700`}
            >
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    role="tab"
                    id={`tab-${tab.id}`}
                    aria-selected={isActive}
                    aria-controls={`panel-${tab.id}`}
                    onClick={() => setActiveTab(tab.id)}
                    className={`p-3 sm:p-4 font-mono text-xs sm:text-sm tracking-wider uppercase transition-colors relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white z-10 ${
                      isActive
                        ? "bg-white text-black font-bold"
                        : "bg-gray-900 text-gray-400 hover:text-white hover:bg-gray-800"
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2">
                      <i className={`${tab.icon} text-sm sm:text-base`} aria-hidden="true"></i>
                      <span className="text-xs">{tab.label}</span>
                      <span className="hidden lg:inline-block text-[10px] text-gray-500 border border-gray-700 px-1 py-0.5 rounded ml-1 font-mono">
                        [{tab.shortcut}]
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date Selector & Quick Preset Switcher */}
          {(activeTab === "guests" || activeTab === "links") && (
            <div className="mb-4 lg:mb-6 flex-shrink-0">
              <div className="bg-gray-900 border border-gray-700 p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <h3 className="font-mono text-xs sm:text-sm tracking-wider text-gray-400 uppercase">
                      OPERATIONAL DATE
                    </h3>
                    {isToday ? (
                      <span className="px-2 py-0.5 text-[10px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-800 uppercase tracking-wider">
                        LIVE TODAY
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-[10px] font-mono bg-gray-800 text-gray-300 border border-gray-700 uppercase tracking-wider">
                        CUSTOM DATE
                      </span>
                    )}
                  </div>

                  {/* Quick Date Presets */}
                  <div className="flex items-center gap-1.5 self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setSelectedDate(offsetDate(selectedDate, -1))}
                      aria-label="Previous operational date (-1 day)"
                      title="Previous day (-1d)"
                      className="px-2.5 py-1 bg-black border border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white font-mono text-xs tracking-wider transition-colors flex items-center gap-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                    >
                      <i className="ri-arrow-left-s-line" aria-hidden="true"></i>
                      <span>-1D</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSelectedDate(getBusinessDate())}
                      aria-label="Set date to today's operational business date"
                      className={`px-3 py-1 border font-mono text-xs tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ${
                        isToday
                          ? "bg-white text-black border-white font-bold"
                          : "bg-black border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white"
                      }`}
                    >
                      TODAY
                    </button>

                    <button
                      type="button"
                      onClick={() => setSelectedDate(offsetDate(selectedDate, 1))}
                      aria-label="Next operational date (+1 day)"
                      title="Next day (+1d)"
                      className="px-2.5 py-1 bg-black border border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white font-mono text-xs tracking-wider transition-colors flex items-center gap-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                    >
                      <span>+1D</span>
                      <i className="ri-arrow-right-s-line" aria-hidden="true"></i>
                    </button>
                  </div>
                </div>

                <div className="relative h-[46px] group">
                  {/* Mirroring UI Layer */}
                  <div className="absolute inset-0 bg-black border border-gray-600 px-4 py-3 flex items-center justify-between pointer-events-none group-focus-within:border-white transition-colors">
                    <span className="text-white font-mono text-sm tracking-wider">
                      {formatDateDisplay(selectedDate)}
                    </span>
                    <i className="ri-calendar-line text-gray-400" aria-hidden="true"></i>
                  </div>

                  {/* Hidden Native Input */}
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
                    aria-label="Select custom date"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 [color-scheme:dark]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Active Tab Panel */}
          <div
            role="tabpanel"
            id={`panel-${activeTab}`}
            aria-labelledby={`tab-${activeTab}`}
            className="lg:flex-1 lg:min-h-0 flex flex-col min-h-[460px] lg:min-h-[520px]"
          >
            {activeTab === "guests" && (
              <GuestList selectedDate={selectedDate} />
            )}
            {activeTab === "links" && (
              <LinkManagement selectedDate={selectedDate} />
            )}
            {activeTab === "users" && <UserManagement />}
            {activeTab === "venues" && <VenueManagement />}
          </div>
        </div>
        <Footer />
      </div>
    </div>
  );
}
