// mediaLoader.js
import * as DocumentPicker from 'expo-document-picker';

export const LocalMediaEngine = {
  /**
   * Opens the native iOS file picker to let the user manually select audio files.
   */
  fetchLocalSongs: async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets) {
        console.log('User cancelled audio import');
        return [];
      }

      const songs = result.assets.map((file, index) => {
        const cleanTitle = file.name ? file.name.replace(/\.[^/.]+$/, '') : `Track ${index + 1}`;

        return {
          // Fallback construction ensuring a string format id
          id: file.name ? `${file.name}-${Date.now()}-${index}` : `song-${Date.now()}-${index}`,
          title: cleanTitle,
          artist: 'Local Import',
          albumArt: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=300&auto=format&fit=crop',
          duration: '--:--', // Duration can be resolved dynamically by expo-av once played
          uri: file.uri,
          size: file.size || 0,
          mimeType: file.mimeType || 'audio/*',
          playCount: 0,
        };
      });

      return songs;
    } catch (error) {
      console.error('Failed to manually select local audio files:', error);
      return [];
    }
  },
};