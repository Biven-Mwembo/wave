// storage.js
import AsyncStorage from '@react-native-async-storage/async-storage';

// Unique keys to isolate our application data partition
const STORAGE_KEYS = {
  THEME_MODE: '@music_app_is_dark_mode',
  FAVORITES: '@music_app_favorite_ids',
  LAST_TRACK: '@music_app_last_track_id',
};

export const StorageEngine = {
  /**
   * Persists the user's high-contrast theme choice
   */
  saveTheme: async (isDarkMode) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.THEME_MODE, JSON.stringify(isDarkMode));
    } catch (error) {
      console.error("Storage Engine failed to sync theme:", error);
    }
  },

  /**
   * Persists the live user favorites ID array
   */
  saveFavorites: async (favoriteIds) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favoriteIds));
    } catch (error) {
      console.error("Storage Engine failed to sync favorites matrix:", error);
    }
  },

  /**
   * Persists the ID of the last active track object
   */
  saveLastTrack: async (trackId) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.LAST_TRACK, trackId);
    } catch (error) {
      console.error("Storage Engine failed to sync track memory state:", error);
    }
  },

  /**
   * Hydrates all persistent data fields into a single pass state object on boot
   */
  loadInitialAppState: async () => {
    try {
      const keys = [STORAGE_KEYS.THEME_MODE, STORAGE_KEYS.FAVORITES, STORAGE_KEYS.LAST_TRACK];
      const baselineStores = await AsyncStorage.multiGet(keys);
      const stateMap = Object.fromEntries(baselineStores);

      return {
        isDarkMode: stateMap[STORAGE_KEYS.THEME_MODE] !== null ? JSON.parse(stateMap[STORAGE_KEYS.THEME_MODE]) : true,
        favoriteIds: stateMap[STORAGE_KEYS.FAVORITES] !== null ? JSON.parse(stateMap[STORAGE_KEYS.FAVORITES]) : ['2', '6', '10'], // default presets
        lastTrackId: stateMap[STORAGE_KEYS.LAST_TRACK] || '1', // fallback to first track
      };
    } catch (error) {
      console.error("Storage Engine failed to hydrate application layout:", error);
      return null;
    }
  }
};