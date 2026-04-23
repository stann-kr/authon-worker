"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getUser, logout, hasAccess, User } from "../lib/auth";
import Footer from "@/components/Footer";
import Spinner from "@/components/Spinner";
import RoleLabel from "@/components/RoleLabel";
import Button from "@/components/Button";
import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const currentUser = getUser();
    if (!currentUser) {
      logout();
      return;
    }

    setUser(currentUser);
    setIsLoading(false);
  }, [router]);

  if (isLoading) {
    return <Spinner mode="fullscreen" text="LOADING..." />;
  }

  if (!user) {
    return null;
  }

  const menuItems = [
    {
      id: "guest",
      title: "GUEST",
      subtitle: "ACCESS REGISTRATION",
      description: "REGISTER FOR EVENT ACCESS",
      icon: "ri-user-line",
      href: "/guest",
      bgColor: "from-blue-900 to-blue-800",
      requiredAccess: ["guest"],
    },
    {
      id: "door",
      title: "DOOR",
      subtitle: "ENTRANCE CONTROL",
      description: "CHECK GUEST VERIFICATION",
      icon: "ri-door-open-line",
      href: "/door",
      bgColor: "from-purple-900 to-purple-800",
      requiredAccess: ["door"],
    },
    {
      id: "admin",
      title: "ADMIN",
      subtitle: "SYSTEM MANAGEMENT",
      description: "GUEST CONTROL SYSTEM",
      icon: "ri-settings-line",
      href: "/admin",
      bgColor: "from-gray-900 to-black",
      requiredAccess: ["admin"],
    },
  ];

  const accessibleMenus = menuItems.filter((item) =>
    hasAccess(user.role, item.requiredAccess),
  );

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <div className="w-full max-w-6xl mx-auto flex flex-col flex-1">
        <div className="px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between mb-6 lg:mb-8">
            <div className="text-left flex-1">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 bg-white"></div>
                <div className="w-2 h-2 bg-white"></div>
                <div className="w-2 h-2 bg-white"></div>
              </div>
              <h1 className="font-mono text-xl sm:text-2xl lg:text-3xl tracking-wider text-white uppercase mb-1">
                {BRAND_NAME}
              </h1>
              <p className="text-xs sm:text-sm text-gray-400 tracking-widest font-mono uppercase">
                {BRAND_TAGLINE}
              </p>
            </div>

            <Button
              onClick={logout}
              variant="ghost"
              className="w-8 h-8 sm:w-10 sm:h-10 p-0 border border-border-default text-text-muted hover:bg-surface-hover"
              aria-label="Logout"
            >
              <i className="ri-logout-box-line text-sm sm:text-base" aria-hidden="true"></i>
            </Button>
          </div>

          <div className="bg-surface border border-border-subtle p-4 lg:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-sm sm:text-base lg:text-lg tracking-wider text-white uppercase">
                  {user.name}
                </p>
                <p className="text-xs sm:text-sm text-text-muted font-mono tracking-wider">
                  ROLE: <RoleLabel role={user.role} /> • LIMIT:{" "}
                  {user.guest_limit}
                </p>
              </div>
              <Link href="/profile" passHref>
                <Button
                  variant="ghost"
                  className="w-8 h-8 sm:w-10 sm:h-10 p-0 border border-border-default text-text-muted hover:bg-surface-hover"
                  aria-label="Edit Profile"
                >
                  <i className="ri-user-settings-line text-sm sm:text-base" aria-hidden="true"></i>
                </Button>
              </Link>
            </div>
          </div>
        </div>

        <div className="flex-1 px-4 sm:px-6 lg:px-8 flex flex-col">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6 flex-1 content-start">
            {accessibleMenus.map((item, index) => (
              <Link key={item.id} href={item.href} className="block group">
                <div
                  className={`bg-gradient-to-br ${item.bgColor} border border-border-subtle p-5 sm:p-6 group-hover:border-border-focus transition-all duration-300 h-full flex flex-col justify-between min-h-[180px] lg:min-h-[200px] active:scale-[0.99]`}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 border border-border-default bg-surface-black/50 flex items-center justify-center group-hover:border-border-focus transition-colors">
                        <i
                          className={`${item.icon} text-white text-base sm:text-lg`}
                          aria-hidden="true"
                        ></i>
                      </div>
                      <div>
                        <h2 className="font-mono text-base sm:text-lg tracking-wider text-white uppercase mb-1">
                          {item.title}
                        </h2>
                        <p className="text-text-body font-mono text-xs tracking-wider uppercase">
                          {item.subtitle}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="w-6 h-6 border border-border-default flex items-center justify-center group-hover:border-border-focus transition-colors">
                        <span className="text-xs font-mono text-text-muted group-hover:text-white">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mb-4">
                    <p className="text-text-muted font-mono text-xs sm:text-sm tracking-wider uppercase">
                      {item.description}
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      <div className="w-1 h-1 bg-border-subtle group-hover:bg-white transition-colors"></div>
                      <div className="w-1 h-1 bg-border-subtle group-hover:bg-white transition-colors"></div>
                      <div className="w-1 h-1 bg-border-subtle group-hover:bg-white transition-colors"></div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs tracking-wider text-text-muted group-hover:text-white transition-colors">
                        ACCESS
                      </span>
                      <i className="ri-arrow-right-line text-text-muted text-sm group-hover:text-white transition-colors" aria-hidden="true"></i>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
