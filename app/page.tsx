"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getUser, logout, hasAccess, User } from "../lib/auth";
import Footer from "@/components/Footer";
import Spinner from "@/components/Spinner";
import RoleLabel from "@/components/RoleLabel";
import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";
import { createClient } from "@/lib/supabase/client";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const checkAuth = async () => {
      // 1. 서버 측 실제 세션 확인
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        // 세션이 만료되었거나 없다면 로컬 저장소를 비우고 로그인 페이지로 이동
        await logout();
        return;
      }

      // 2. 세션이 유효하다면 로컬 스토리지 정보 연동 (빠른 렌더링용)
      const currentUser = getUser();
      if (!currentUser) {
        await logout();
        return;
      }

      setUser(currentUser);
      setIsLoading(false);
    };

    checkAuth();
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

            <button
              onClick={logout}
              className="w-8 h-8 sm:w-10 sm:h-10 border border-gray-600 bg-black hover:bg-gray-900 transition-colors flex items-center justify-center ml-4"
            >
              <i className="ri-logout-box-line text-gray-400 text-sm sm:text-base"></i>
            </button>
          </div>

          <div className="bg-gray-900 border border-gray-700 p-4 lg:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-sm sm:text-base lg:text-lg tracking-wider text-white uppercase">
                  {user.name}
                </p>
                <p className="text-xs sm:text-sm text-gray-400 font-mono tracking-wider">
                  ROLE: <RoleLabel role={user.role} /> • LIMIT:{" "}
                  {user.guest_limit}
                </p>
              </div>
              <Link
                href="/profile"
                className="w-8 h-8 sm:w-10 sm:h-10 border border-gray-600 bg-black hover:bg-gray-900 hover:border-white transition-colors flex items-center justify-center"
              >
                <i className="ri-user-settings-line text-gray-400 text-sm sm:text-base"></i>
              </Link>
            </div>
          </div>
        </div>

        <div className="flex-1 px-4 sm:px-6 lg:px-8 flex flex-col">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6 flex-1 content-start">
            {accessibleMenus.map((item, index) => (
              <Link key={item.id} href={item.href} className="block">
                <div
                  className={`bg-gradient-to-br ${item.bgColor} border border-gray-700 p-5 sm:p-6 hover:border-white transition-all duration-300 group h-full flex flex-col justify-between min-h-[180px] lg:min-h-[200px]`}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 border border-gray-600 bg-black/50 flex items-center justify-center group-hover:border-white transition-colors">
                        <i
                          className={`${item.icon} text-white text-base sm:text-lg`}
                        ></i>
                      </div>
                      <div>
                        <h2 className="font-mono text-base sm:text-lg tracking-wider text-white uppercase mb-1">
                          {item.title}
                        </h2>
                        <p className="text-gray-300 font-mono text-xs tracking-wider uppercase">
                          {item.subtitle}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="w-6 h-6 border border-gray-600 flex items-center justify-center group-hover:border-white transition-colors">
                        <span className="text-xs font-mono text-gray-400 group-hover:text-white">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mb-4">
                    <p className="text-gray-400 font-mono text-xs sm:text-sm tracking-wider uppercase">
                      {item.description}
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      <div className="w-1 h-1 bg-gray-600 group-hover:bg-white transition-colors"></div>
                      <div className="w-1 h-1 bg-gray-600 group-hover:bg-white transition-colors"></div>
                      <div className="w-1 h-1 bg-gray-600 group-hover:bg-white transition-colors"></div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs tracking-wider text-gray-400 uppercase group-hover:text-white transition-colors">
                        ACCESS
                      </span>
                      <i className="ri-arrow-right-line text-gray-400 text-sm group-hover:text-white transition-colors"></i>
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
