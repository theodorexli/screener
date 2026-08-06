import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Cache utility functions for localStorage
 */
export interface CacheData<T> {
  data: T;
  timestamp: number;
}

/**
 * Get cached data if it's still valid
 * @param key Cache key
 * @param duration Cache duration in milliseconds
 * @returns Cached data if valid, null otherwise
 */
export function getCache<T>(key: string, duration: number): T | null {
  try {
    const cached = localStorage.getItem(key);
    if (cached) {
      const cachedData: CacheData<T> = JSON.parse(cached);
      if (cachedData.timestamp && Date.now() - cachedData.timestamp < duration) {
        return cachedData.data;
      }
    }
  } catch (e) {
    // Cache read failed
  }
  return null;
}

/**
 * Set cache data with timestamp
 * @param key Cache key
 * @param data Data to cache
 */
export function setCache<T>(key: string, data: T): void {
  try {
    const cacheData: CacheData<T> = {
      data,
      timestamp: Date.now()
    };
    localStorage.setItem(key, JSON.stringify(cacheData));
  } catch (e) {
    // Cache write failed
  }
}

