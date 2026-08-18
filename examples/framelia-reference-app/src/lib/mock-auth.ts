import { useState } from "react";

export interface MockUser {
  name: string;
  email: string;
}

const STORAGE_KEY = "framelia-mock-user";
const FALLBACK_USER: MockUser = {
  name: "Demo User",
  email: "demo@framelia.local",
};

function isMockUser(value: unknown): value is MockUser {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "email" in value &&
    typeof value.email === "string"
  );
}

export function readMockUser(): MockUser {
  if (typeof window === "undefined") return FALLBACK_USER;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return FALLBACK_USER;
    const user: unknown = JSON.parse(stored);
    if (isMockUser(user)) return user;
  } catch {
    // Use fallback user when local storage is unavailable or malformed.
  }

  return FALLBACK_USER;
}

export function setMockUser(user: MockUser) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function clearMockUser() {
  window.localStorage.removeItem(STORAGE_KEY);
}

export function useMockUser() {
  const [user] = useState(readMockUser);
  return { user };
}
