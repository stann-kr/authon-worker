"use client";

import { useState, useEffect } from "react";
import { getUser } from "../../../lib/auth";
import {
  createUserViaEdge,
  fetchVenues,
  type Venue,
} from "../../../lib/api/guests";

export default function InviteUser() {
  const [createMode, setCreateMode] = useState<"invite" | "password">("invite");
  const [formData, setFormData] = useState({
    email: "",
    name: "",
    role: "dj" as "venue_admin" | "door_staff" | "staff" | "dj",
    guest_limit: "",
    venue_id: "",
    password: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [venues, setVenues] = useState<Venue[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    const user = getUser();
    setCurrentUser(user);

    // Set default venue_id from current user
    if (user?.venue_id) {
      setFormData((prev) => ({ ...prev, venue_id: user.venue_id as string }));
    }

    // Super admin can choose venue
    if (user?.role === "super_admin") {
      fetchVenues().then(({ data }) => {
        if (data) setVenues(data);
      });
    }
  }, []);

  const isSuperAdmin = currentUser?.role === "super_admin";

  // Role options depend on caller role
  const roleOptions = isSuperAdmin
    ? [
        { value: "venue_admin", label: "VENUE ADMIN" },
        { value: "door_staff", label: "DOOR STAFF" },
        { value: "staff", label: "STAFF" },
        { value: "dj", label: "DJ" },
      ]
    : [
        { value: "venue_admin", label: "VENUE ADMIN" },
        { value: "door_staff", label: "DOOR STAFF" },
        { value: "staff", label: "STAFF" },
        { value: "dj", label: "DJ" },
      ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    setSuccess("");

    if (!formData.venue_id) {
      setError("Please select a venue.");
      setIsLoading(false);
      return;
    }

    // guest_limit 유효성 검사
    if (formData.role !== "venue_admin") {
      const limitVal = parseInt(String(formData.guest_limit));
      if (isNaN(limitVal) || limitVal < 1) {
        setError("Guest limit must be a number of 1 or more.");
        setIsLoading(false);
        return;
      }
    }

    try {
      const { data, error: createError } = await createUserViaEdge({
        email: formData.email,
        name: formData.name,
        role: formData.role,
        venueId: formData.venue_id,
        guestLimit:
          formData.role === "venue_admin"
            ? 999
            : parseInt(String(formData.guest_limit)),
        ...(createMode === "password" && formData.password
          ? { password: formData.password }
          : {}),
      });

      if (createError) {
        setError(createError.message || "Failed to create user.");
      } else {
        const msg =
          createMode === "password"
            ? `Account created for ${formData.name} (${formData.email}). Temporary password: ${formData.password}`
            : `Invitation email sent to ${formData.name} (${formData.email}).`;
        setSuccess(msg);
        setFormData((prev) => ({
          ...prev,
          email: "",
          name: "",
          role: "dj",
          guest_limit: "",
          password: "",
        }));
      }
    } catch (err: any) {
      setError(err.message || "An error occurred while creating the user.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 border border-gray-700 p-4 sm:p-5">
        <h2 className="font-mono text-lg tracking-wider text-white uppercase mb-4">
          CREATE USER
        </h2>

        <div className="grid grid-cols-2 gap-px bg-gray-700 mb-4">
          <button
            type="button"
            onClick={() => setCreateMode("invite")}
            className={`p-3 font-mono text-xs tracking-wider uppercase transition-colors ${
              createMode === "invite"
                ? "bg-white text-black"
                : "bg-black text-gray-400 hover:text-white"
            }`}
          >
            <i className="ri-mail-send-line mr-1"></i> EMAIL INVITE
          </button>
          <button
            type="button"
            onClick={() => setCreateMode("password")}
            className={`p-3 font-mono text-xs tracking-wider uppercase transition-colors ${
              createMode === "password"
                ? "bg-white text-black"
                : "bg-black text-gray-400 hover:text-white"
            }`}
          >
            <i className="ri-key-line mr-1"></i> TEMP PASSWORD
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSuperAdmin && venues.length > 0 && (
            <div>
              <label className="block text-gray-400 font-mono text-xs tracking-wider uppercase mb-2">
                VENUE
              </label>
              <div className="relative">
                <select
                  value={formData.venue_id}
                  onChange={(e) =>
                    setFormData({ ...formData, venue_id: e.target.value })
                  }
                  className="w-full appearance-none bg-black border border-gray-700 px-4 py-3 pr-10 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-white"
                  required
                >
                  <option value="">SELECT VENUE</option>
                  {venues.map((venue) => (
                    <option key={venue.id} value={venue.id}>
                      {venue.name} ({venue.type})
                    </option>
                  ))}
                </select>
                <i className="ri-arrow-down-s-line absolute right-3 top-1/2 -translate-y-1/2 text-base text-gray-400 pointer-events-none"></i>
              </div>
            </div>
          )}

          <div>
            <label className="block text-gray-400 font-mono text-xs tracking-wider uppercase mb-2">
              EMAIL ADDRESS
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
              className="w-full bg-black border border-gray-700 px-4 py-3 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-white"
              placeholder="user@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-gray-400 font-mono text-xs tracking-wider uppercase mb-2">
              NAME
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="w-full bg-black border border-gray-700 px-4 py-3 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-white"
              placeholder="Enter full name"
              required
            />
          </div>

          <div>
            <label className="block text-gray-400 font-mono text-xs tracking-wider uppercase mb-2">
              ROLE
            </label>
            <div className="grid grid-cols-4 gap-2">
              {roleOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    setFormData({ ...formData, role: opt.value as any })
                  }
                  className={`p-3 border font-mono text-xs tracking-wider uppercase transition-colors ${
                    formData.role === opt.value
                      ? "bg-white text-black border-white"
                      : "bg-black text-gray-400 border-gray-700 hover:text-white hover:border-gray-500"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {formData.role !== "venue_admin" && (
            <div>
              <label className="block text-gray-400 font-mono text-xs tracking-wider uppercase mb-2">
                GUEST LIMIT
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={formData.guest_limit}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9]/g, "");
                  setFormData({ ...formData, guest_limit: val as any });
                }}
                className="w-full bg-black border border-gray-700 px-4 py-3 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-white"
                placeholder="Enter guest limit"
              />
            </div>
          )}

          {createMode === "password" && (
            <div>
              <label className="block text-gray-400 font-mono text-xs tracking-wider uppercase mb-2">
                TEMPORARY PASSWORD
              </label>
              <input
                type="text"
                value={formData.password}
                onChange={(e) =>
                  setFormData({ ...formData, password: e.target.value })
                }
                className="w-full bg-black border border-gray-700 px-4 py-3 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-white"
                placeholder="Min 6 characters"
                minLength={6}
                required
              />
              <p className="text-gray-500 font-mono text-xs mt-1 tracking-wider">
                Share this with the user and ask them to change it after first
                login
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-900/30 border border-red-700 p-3">
              <p className="text-red-400 font-mono text-xs tracking-wider">
                {error}
              </p>
            </div>
          )}

          {success && (
            <div className="bg-green-900/30 border border-green-700 p-4">
              <p className="text-green-400 font-mono text-xs tracking-wider uppercase mb-1">
                {createMode === "password"
                  ? "ACCOUNT CREATED"
                  : "INVITATION SENT"}
              </p>
              <p className="text-green-300 font-mono text-xs tracking-wider">
                {success}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-white text-black py-3 font-mono text-sm tracking-wider uppercase hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            {isLoading ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border border-black border-t-transparent rounded-full animate-spin"></div>
                <span>
                  {createMode === "password" ? "CREATING..." : "SENDING..."}
                </span>
              </div>
            ) : createMode === "password" ? (
              "CREATE ACCOUNT"
            ) : (
              "SEND INVITATION"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
