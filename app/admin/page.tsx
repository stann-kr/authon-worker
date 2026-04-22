"use client";

import { useState, useEffect } from "react";
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

function AdminPageContent() {
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

  const tabs = [
    { id: "guests", label: "GUEST", icon: "ri-group-line" },
    { id: "links", label: "LINKS", icon: "ri-link" },
    { id: "users", label: "USERS", icon: "ri-user-settings-line" },
    ...(isSuperAdmin
      ? [{ id: "venues", label: "VENUES", icon: "ri-store-2-line" }]
      : []),
  ];

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <AdminHeader />
      <div className="flex-1 overflow-x-hidden pt-20 sm:pt-24 flex flex-col">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 w-full lg:flex-1 lg:min-h-0 flex flex-col">
          <div className="mb-4 lg:mb-6 flex-shrink-0">
            <div
              className={`grid ${tabs.length === 4 ? "grid-cols-4" : "grid-cols-3"} gap-px bg-gray-700`}
            >
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`p-3 sm:p-4 font-mono text-xs sm:text-sm tracking-wider uppercase transition-colors ${
                    activeTab === tab.id
                      ? "bg-white text-black"
                      : "bg-gray-900 text-gray-400 hover:text-white"
                  }`}
                >
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2">
                    <i className={`${tab.icon} text-sm sm:text-base`}></i>
                    <span className="text-xs">{tab.label}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {(activeTab === "guests" || activeTab === "links") && (
            <div className="mb-4 lg:mb-6 flex-shrink-0">
              <div className="bg-gray-900 border border-gray-700 p-4 sm:p-5">
                <div className="mb-2">
                  <h3 className="font-mono text-xs sm:text-sm tracking-wider text-gray-400 uppercase">
                    SELECT DATE
                  </h3>
                </div>
                <div className="relative h-[46px] group">
                  {/* Mirroring UI Layer */}
                  <div className="absolute inset-0 bg-black border border-gray-600 px-4 py-3 flex items-center justify-between pointer-events-none group-focus-within:border-white transition-colors">
                    <span className="text-white font-mono text-sm tracking-wider">
                      {formatDateDisplay(selectedDate)}
                    </span>
                    <i className="ri-calendar-line text-gray-400"></i>
                  </div>

                  {/* Hidden Native Input */}
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    onClick={(e) => (e.target as any).showPicker?.()}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 [color-scheme:dark]"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="lg:flex-1 lg:min-h-0 flex flex-col min-h-[460px] lg:min-h-[520px]">
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
