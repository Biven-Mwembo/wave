// App.js
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  StyleSheet, Text, View, FlatList, Image, TouchableOpacity, 
  Modal, Dimensions, SafeAreaView, StatusBar, ScrollView, 
  TextInput, ActivityIndicator, Alert, PanResponder 
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av'; 

// Custom Modules
import { StorageEngine } from './storage';
import { LocalMediaEngine } from './mediaLoader'; 

// Require your local album cover asset
const CUSTOM_DISC_IMAGE = require('./assets/disc.jpeg'); 

const { width } = Dimensions.get('window');

const formatTimeLabel = (millis) => {
  if (!millis || isNaN(millis)) return "0:00";
  const totalSeconds = Math.floor(millis / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
};

export default function App() {
  const [isHydrating, setIsHydrating] = useState(true);
  const [musicLibrary, setMusicLibrary] = useState([]); 

  // UI state variables
  const [currentTab, setCurrentTab] = useState('Songs');
  const [isSeeAllActive, setIsSeeAllActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [favoriteIds, setFavoriteIds] = useState([]);
  const [isShuffleOn, setIsShuffleOn] = useState(false);
  const [isRepeatMode, setIsRepeatMode] = useState(0); // 0 = Off, 1 = Repeat One, 2 = Repeat All
  const [audioRoute, setAudioRoute] = useState('speaker'); 
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [volume, setVolume] = useState(0.7); // Global state tracker for volume control engine

  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);

  const [soundInstance, setSoundInstance] = useState(null);

  // References to preserve state sync inside fast asynchronous callbacks
  const isShuffleRef = useRef(isShuffleOn);
  const isRepeatRef = useRef(isRepeatMode);
  const libraryRef = useRef(musicLibrary);
  const trackRef = useRef(currentTrack);

  useEffect(() => { isShuffleRef.current = isShuffleOn; }, [isShuffleOn]);
  useEffect(() => { isRepeatRef.current = isRepeatMode; }, [isRepeatMode]);
  useEffect(() => { libraryRef.current = musicLibrary; }, [musicLibrary]);
  useEffect(() => { trackRef.current = currentTrack; }, [currentTrack]);

  // --- RECONCILIATION & INITIALIZATION HOOK ---
  useEffect(() => {
    async function loadDeviceAndStorageData() {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true, 
          shouldRouteThroughEarpieceIOS: false,
          staysActiveInBackground: true,
        });

        const persistedState = await StorageEngine.loadInitialAppState();
        
        let savedLibrary = [];
        if (persistedState) {
          setIsDarkMode(persistedState.isDarkMode);
          setFavoriteIds(persistedState.favoriteIds || []);
          
          if (persistedState.savedTracks) {
            savedLibrary = persistedState.savedTracks.map(track => ({
              ...track,
              useLocalAssetArt: true
            }));
          }
        }
        
        setMusicLibrary(savedLibrary);

        if (savedLibrary.length > 0) {
          const targetMatch = savedLibrary.find(t => t.id === persistedState?.lastTrackId) || savedLibrary[0];
          if (targetMatch) setCurrentTrack(targetMatch);
        }
      } catch (error) {
        console.error("Failed to initialize app state parameters:", error);
      } finally {
        setIsHydrating(false);
      }
    }
    loadDeviceAndStorageData();

    return () => {
      if (soundInstance) {
        soundInstance.unloadAsync();
      }
    };
  }, []);

  // --- VOLUME BAR INTERCEPT GESTURE RESPONDER ENGINE ---
  const volumeTrackWidth = width * 0.84 - 40; 
  const volumePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt, gestureState) => {
        handleVolumePanUpdate(evt);
      },
      onPanResponderMove: (evt, gestureState) => {
        handleVolumePanUpdate(evt);
      },
    })
  ).current;

  const handleVolumePanUpdate = async (evt) => {
    const touchX = evt.nativeEvent.locationX;
    let computedVolume = touchX / volumeTrackWidth;
    computedVolume = Math.min(Math.max(computedVolume, 0), 1); // Clamp boundary [0.0 - 1.0]
    setVolume(computedVolume);
    
    if (soundInstance) {
      try {
        await soundInstance.setVolumeAsync(computedVolume);
      } catch (err) {
        console.log("Error assigning real-time hardware channel gain volume:", err);
      }
    }
  };

  // --- MANUAL AUDIO TRACK IMPORT WORKFLOW ---
  const handleAddNewSongsWorkflow = async () => {
    try {
      const selectedSongs = await LocalMediaEngine.fetchLocalSongs();
      if (selectedSongs.length === 0) return;

      let duplicateCount = 0;
      const verifiedNewTracks = [];

      selectedSongs.forEach((newTrack) => {
        const isAlreadyAdded = musicLibrary.some(
          (existingTrack) => existingTrack.uri === newTrack.uri
        );

        if (isAlreadyAdded) {
          duplicateCount++;
        } else {
          verifiedNewTracks.push({
            ...newTrack,
            useLocalAssetArt: true 
          });
        }
      });

      if (verifiedNewTracks.length > 0) {
        const updatedLibrary = [...musicLibrary, ...verifiedNewTracks];
        setMusicLibrary(updatedLibrary);

        if (StorageEngine.saveLibraryTracks) {
          await StorageEngine.saveLibraryTracks(updatedLibrary);
        }

        if (!currentTrack && verifiedNewTracks.length > 0) {
          setCurrentTrack(verifiedNewTracks[0]);
        }
      }

      if (duplicateCount > 0) {
        Alert.alert(
          "Import Complete",
          `Added ${verifiedNewTracks.length} new song(s). Skipped ${duplicateCount} duplicate file(s).`
        );
      }
    } catch (error) {
      console.error("Error running import workflow sync updates:", error);
    }
  };

  // --- AUDIO INTERACTIVE PLAYER CONTROLLER ---
  const handleTrackPlaybackToggle = async (targetTrack) => {
    try {
      if (currentTrack?.id === targetTrack.id && soundInstance) {
        await handlePausePlayAction();
        return;
      }

      if (soundInstance !== null) {
        await soundInstance.unloadAsync();
        setSoundInstance(null);
        setIsPlaying(false);
        setPositionMillis(0);
        setPlaybackProgress(0);
      }

      setCurrentTrack(targetTrack);
      await StorageEngine.saveLastTrack(targetTrack.id);

      const { sound } = await Audio.Sound.createAsync(
        { uri: targetTrack.uri },
        { 
          shouldPlay: true,
          progressUpdateIntervalMillis: 100,
          volume: volume // Retain current volume preference instantly on load
        },
        onPlaybackStatusUpdate
      );

      setSoundInstance(sound);
      setIsPlaying(true);
    } catch (error) {
      console.error("Audio engine failed to stream target path node:", error);
      Alert.alert("Playback Error", "The file could not be read. Please try importing it again.");
    }
  };

  const handlePausePlayAction = async () => {
    if (!soundInstance) {
      if (currentTrack) handleTrackPlaybackToggle(currentTrack);
      return;
    }

    if (isPlaying) {
      await soundInstance.pauseAsync();
      setIsPlaying(false);
    } else {
      await soundInstance.playAsync();
      setIsPlaying(true);
    }
  };

  const onPlaybackStatusUpdate = (status) => {
    if (!status.isLoaded) return;

    setPositionMillis(status.positionMillis);
    setDurationMillis(status.durationMillis || 0);

    // Dynamic resolution for missing metadata minutes
    if (status.durationMillis && (!trackRef.current?.duration || trackRef.current.duration === '--:--' || trackRef.current.duration === '0:00')) {
      const updatedLabel = formatTimeLabel(status.durationMillis);
      
      setMusicLibrary(prev => prev.map(t => t.id === trackRef.current.id ? { ...t, duration: updatedLabel } : t));
      setCurrentTrack(prev => prev ? { ...prev, duration: updatedLabel } : null);
    }

    if (status.durationMillis > 0) {
      setPlaybackProgress((status.positionMillis / status.durationMillis) * 100);
    }
    
    // Core Queue Termination Pipeline Interceptor
    if (status.didJustFinish) {
      if (isRepeatRef.current === 1) {
        // Repeat One execution condition loopback
        if (soundInstance) {
          soundInstance.setStatusAsync({ positionMillis: 0, shouldPlay: true });
        }
      } else {
        handleNextTrack();
      }
    }
  };

  const handleThemeChange = async (value) => {
    setIsDarkMode(value);
    await StorageEngine.saveTheme(value);
  };

  const toggleFavorite = async (trackId) => {
    const updated = favoriteIds.includes(trackId) ? favoriteIds.filter(id => id !== trackId) : [...favoriteIds, trackId];
    setFavoriteIds(updated);
    await StorageEngine.saveFavorites(updated);
  };

  const handleNextTrack = () => {
    const library = libraryRef.current;
    const track = trackRef.current;
    if (library.length === 0) return;

    let nextTrack;
    if (isShuffleRef.current) {
      const randomIndex = Math.floor(Math.random() * library.length);
      nextTrack = library[randomIndex];
    } else {
      const idx = library.findIndex(t => t.id === track?.id);
      nextTrack = library[(idx + 1) % library.length];
    }
    if (nextTrack) handleTrackPlaybackToggle(nextTrack);
  };

  const handlePrevTrack = () => {
    const library = libraryRef.current;
    const track = trackRef.current;
    if (library.length === 0) return;

    const idx = library.findIndex(t => t.id === track?.id);
    let prevIdx = idx - 1 < 0 ? library.length - 1 : idx - 1;
    const prevTrack = library[prevIdx];
    if (prevTrack) handleTrackPlaybackToggle(prevTrack);
  };

  const filteredAllSongsData = useMemo(() => {
    if (!searchQuery.trim()) return musicLibrary;
    return musicLibrary.filter(t => t.title.toLowerCase().includes(searchQuery.toLowerCase()) || t.artist.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [searchQuery, musicLibrary]);

  const lovedHitsData = useMemo(() => {
    return [...musicLibrary].sort((a, b) => b.playCount - a.playCount).slice(0, 10);
  }, [musicLibrary]);

  const alphabeticalAllSongsData = useMemo(() => {
    return [...musicLibrary].sort((a, b) => a.title.localeCompare(b.title));
  }, [musicLibrary]);

  const favoriteSongsData = useMemo(() => {
    return musicLibrary.filter(track => favoriteIds.includes(track.id));
  }, [favoriteIds, musicLibrary]);

  const handleTimelineScrub = async (event) => {
    if (!soundInstance) return;
    const clickX = event.nativeEvent.locationX;
    const computedPercentage = Math.min(Math.max(Math.round((clickX / (width * 0.84)) * 100), 0), 100);
    setPlaybackProgress(computedPercentage);

    const status = await soundInstance.getStatusAsync();
    if (status.isLoaded) {
      const targetMillis = (computedPercentage / 100) * status.durationMillis;
      await soundInstance.setPositionAsync(targetMillis);
      setPositionMillis(targetMillis);
    }
  };

  const themeContainer = isDarkMode ? styles.darkContainer : styles.lightContainer;
  const themeTextMain = isDarkMode ? styles.darkTextMain : styles.lightTextMain;
  const themeTextSub = isDarkMode ? styles.darkTextSub : styles.lightTextSub;
  const themeBorder = isDarkMode ? styles.darkBorder : styles.lightBorder;
  const themeSearchBg = isDarkMode ? styles.darkSearchBg : styles.lightSearchBg;

  const renderTrackRow = (item, index) => {
    const isSelected = currentTrack?.id === item.id;
    const isLiked = favoriteIds.includes(item.id);
    return (
      <TouchableOpacity key={`${item.id}-${index}`} style={[styles.trackRow, themeBorder]} onPress={() => handleTrackPlaybackToggle(item)}>
        <Image source={CUSTOM_DISC_IMAGE} style={styles.trackArt} />
        <View style={styles.trackInfo}>
          <Text style={[styles.trackTitle, themeTextMain, isSelected && styles.appleRedText]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.trackArtist, themeTextSub]} numberOfLines={1}>{item.artist}</Text>
        </View>
        <TouchableOpacity style={styles.heartRowButton} onPress={() => toggleFavorite(item.id)}>
          <Ionicons name={isLiked ? "heart" : "heart-outline"} size={20} color={isLiked ? "#ff2d55" : themeTextSub.color} />
        </TouchableOpacity>
        <Text style={[styles.trackDuration, themeTextSub]}>
          {(!item.duration || item.duration === '--:--') ? "0:00" : item.duration}
        </Text>
      </TouchableOpacity>
    );
  };

  if (isHydrating) {
    return (
      <View style={[styles.container, styles.darkContainer, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#ff2d55" />
        <Text style={{ color: '#8e8e93', marginTop: 14, fontWeight: '500' }}>Initializing Storage Containers...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, themeContainer]}>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />

      {isSeeAllActive && currentTab === 'Songs' ? (
        <View style={[StyleSheet.absoluteFillObject, themeContainer, { zIndex: 10, paddingTop: 50 }]}>
          <View style={[styles.subHeaderView, themeBorder]}>
            <TouchableOpacity style={styles.backLinkRow} onPress={() => setIsSeeAllActive(false)}>
              <Ionicons name="chevron-back" size={24} color="#ff2d55" />
              <Text style={styles.backLinkText}>Library</Text>
            </TouchableOpacity>
            <Text style={[styles.centerSubTitle, themeTextMain]}>All Songs (A-Z)</Text>
            <View style={{ width: 60 }} />
          </View>
          <FlatList
            data={alphabeticalAllSongsData}
            keyExtractor={(item) => `all-${item.id}`}
            renderItem={({ item, index }) => renderTrackRow(item, index)}
            contentContainerStyle={{ paddingBottom: 120 }}
          />
        </View>
      ) : null}

      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        {currentTab === 'Songs' && (
          <View>
            <View style={styles.mainHomeHeader}>
              <Text style={[styles.massiveTitle, themeTextMain]}>Library</Text>
              
              <View style={styles.headerRightActionContainer}>
                <TouchableOpacity style={[styles.actionButtonCircle, isDarkMode ? styles.darkToggleBg : styles.lightToggleBg, { marginRight: 10 }]} onPress={handleAddNewSongsWorkflow}>
                  <Ionicons name="add" size={22} color="#ff2d55" />
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionButtonCircle, isDarkMode ? styles.darkToggleBg : styles.lightToggleBg]} onPress={() => handleThemeChange(!isDarkMode)}>
                  <Ionicons name={isDarkMode ? "sunny" : "moon"} size={20} color={isDarkMode ? "#ff2d55" : "#1c1c1e"} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.searchContainerBox}>
              <View style={[styles.searchInnerWrapper, themeSearchBg]}>
                <Ionicons name="search" size={18} color="#8e8e93" style={styles.searchIconLeft} />
                <TextInput
                  style={[styles.searchInputField, { color: isDarkMode ? '#ffffff' : '#000000' }]}
                  placeholder="Search imported music files..."
                  placeholderTextColor="#8e8e93"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoCorrect={false}
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.searchClearBtn}>
                    <Ionicons name="close-circle" size={16} color="#8e8e93" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {musicLibrary.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="cloud-upload-outline" size={64} color="#8e8e93" />
                <Text style={[styles.emptyStateText, themeTextSub]}>Your library is empty. Tap the "+" button above to add tracks manually.</Text>
              </View>
            ) : (
              <>
                {searchQuery.trim().length === 0 ? (
                  <>
                    <Text style={[styles.sectionTitle, themeTextMain]}>Your Loved Hits</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingLeft: 20, paddingBottom: 15 }}>
                      {lovedHitsData.map((item) => (
                        <TouchableOpacity key={`loved-${item.id}`} style={styles.cardItem} onPress={() => handleTrackPlaybackToggle(item)}>
                          <Image source={CUSTOM_DISC_IMAGE} style={styles.cardArtImage} />
                          <Text style={[styles.cardTitleText, themeTextMain]} numberOfLines={1}>{item.title}</Text>
                          <Text style={[styles.cardArtistText, themeTextSub]} numberOfLines={1}>{item.artist}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>

                    <View style={styles.sectionHeaderRow}>
                      <Text style={[styles.sectionTitle, themeTextMain, { marginTop: 0 }]}>All Songs</Text>
                      <TouchableOpacity onPress={() => setIsSeeAllActive(true)}>
                        <Text style={styles.seeAllInlineLink}>See All</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <Text style={[styles.sectionTitle, themeTextMain, { marginTop: 15 }]}>Search Results</Text>
                )}

                <View style={{ paddingHorizontal: 8 }}>
                  {filteredAllSongsData.map((item, index) => renderTrackRow(item, index))}
                </View>
              </>
            )}
          </View>
        )}

        {currentTab === 'Favorites' && (
          <View style={{ paddingHorizontal: 8 }}>
            <View style={styles.mainHomeHeader}>
              <Text style={[styles.massiveTitle, themeTextMain]}>Favorites</Text>
            </View>
            {favoriteSongsData.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="heart-dislike-outline" size={64} color="#8e8e93" />
                <Text style={[styles.emptyStateText, themeTextSub]}>No favorites saved yet.</Text>
              </View>
            ) : (
              favoriteSongsData.map((item, index) => renderTrackRow(item, index))
            )}
          </View>
        )}

        {currentTab === 'Settings' && (
          <View style={{ paddingHorizontal: 20 }}>
            <View style={styles.mainHomeHeader}>
              <Text style={[styles.massiveTitle, themeTextMain]}>Settings</Text>
            </View>
            <View style={[styles.settingBlockContainer, isDarkMode ? styles.darkToggleBg : styles.lightToggleBg]}>
              <Text style={[styles.settingGroupHeader, themeTextMain]}>Theme Engine Config</Text>
              <TouchableOpacity style={styles.inlineSettingToggle} onPress={() => handleThemeChange(!isDarkMode)}>
                <Text style={[styles.settingLabel, themeTextMain]}>High Contrast Dark Mode</Text>
                <Ionicons name={isDarkMode ? "checkbox" : "square-outline"} size={24} color="#ff2d55" />
              </TouchableOpacity>
            </View>

            <View style={[styles.settingBlockContainer, isDarkMode ? styles.darkToggleBg : styles.lightToggleBg, { marginTop: 20 }]}>
              <Text style={[styles.settingGroupHeader, themeTextMain]}>System Storage Specs</Text>
              <View style={styles.inlineSettingToggle}>
                <Text style={[styles.settingLabel, themeTextMain]}>Total Track Cache</Text>
                <Text style={themeTextSub}>{musicLibrary.length} Audio Files Indexed</Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* FLOATING MINI PLAYER BAR */}
      {currentTrack && (
        <TouchableOpacity style={[styles.miniPlayer, isDarkMode ? styles.darkMiniPlayer : styles.lightMiniPlayer, { bottom: 85 }]} activeOpacity={0.9} onPress={() => setIsModalVisible(true)}>
          <Image source={CUSTOM_DISC_IMAGE} style={styles.miniArt} />
          <Text style={[styles.miniText, themeTextMain]} numberOfLines={1}>
            {currentTrack.title} — <Text style={themeTextSub}>{currentTrack.artist}</Text>
          </Text>
          <View style={styles.miniControls}>
            <TouchableOpacity onPress={handlePausePlayAction} style={styles.miniControlBtn}>
              <Ionicons name={isPlaying ? "pause" : "play"} size={22} color={isDarkMode ? "#ffffff" : "#1c1c1e"} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleNextTrack} style={styles.miniControlBtn}>
              <Ionicons name="play-forward" size={22} color={isDarkMode ? "#ffffff" : "#1c1c1e"} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      )}

      {/* FLOATING NAVIGATION BAR */}
      <View style={styles.floatingNavContainer}>
        <LinearGradient colors={isDarkMode ? ['rgba(30,30,32,0.85)', 'rgba(20,20,22,0.95)'] : ['rgba(245,245,247,0.85)', 'rgba(255,255,255,0.95)']} style={styles.floatingNavBlurBg} />
        <TouchableOpacity style={styles.navTabItem} onPress={() => { setCurrentTab('Songs'); setIsSeeAllActive(false); }}>
          <Ionicons name="musical-notes" size={24} color={currentTab === 'Songs' ? '#ff2d55' : '#8e8e93'} />
          <Text style={[styles.navTabText, { color: currentTab === 'Songs' ? '#ff2d55' : '#8e8e93' }]}>Songs</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navTabItem} onPress={() => setCurrentTab('Favorites')}>
          <Ionicons name="heart" size={24} color={currentTab === 'Favorites' ? '#ff2d55' : '#8e8e93'} />
          <Text style={[styles.navTabText, { color: currentTab === 'Favorites' ? '#ff2d55' : '#8e8e93' }]}>Favorites</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navTabItem} onPress={() => setCurrentTab('Settings')}>
          <Ionicons name="settings" size={24} color={currentTab === 'Settings' ? '#ff2d55' : '#8e8e93'} />
          <Text style={[styles.navTabText, { color: currentTab === 'Settings' ? '#ff2d55' : '#8e8e93' }]}>Settings</Text>
        </TouchableOpacity>
      </View>

      {/* NOW PLAYING FULL SCREEN MODAL */}
      <Modal animationType="slide" transparent={true} visible={isModalVisible} onRequestClose={() => setIsModalVisible(false)}>
        <View style={styles.modalContainer}>
          <LinearGradient colors={isDarkMode ? ['#3d0b13', '#161618', '#0d0d0f'] : ['#a1a1a5', '#e5e5ea', '#ffffff']} style={StyleSheet.absoluteFillObject} />
          <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={styles.modalHeaderRow}>
              <TouchableOpacity style={styles.dismissChevron} onPress={() => setIsModalVisible(false)}>
                <Ionicons name="chevron-down" size={28} color={isDarkMode ? "#ff2d55" : "#1c1c1e"} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.audioRouterBadge} onPress={() => setAudioRoute(r => r === 'speaker' ? 'bluetooth' : 'speaker')}>
                <Ionicons name={audioRoute === 'bluetooth' ? "bluetooth" : "volume-high"} size={16} color="#ffffff" style={{ marginRight: 6 }} />
                <Text style={styles.audioRouteText}>{audioRoute === 'bluetooth' ? "AirPods Pro" : "Device Speaker"}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => toggleFavorite(currentTrack?.id)} style={{ padding: 4 }}>
                <Ionicons name={favoriteIds.includes(currentTrack?.id) ? "heart" : "heart-outline"} size={26} color="#ff2d55" />
              </TouchableOpacity>
            </View>

            {/* STATIC SQUARE HIGH-END DESIGN ARTWORK FRAME */}
            <View style={styles.giantArtworkContainer}>
              <Image source={CUSTOM_DISC_IMAGE} style={styles.giantArtwork} />
            </View>

            <View style={styles.metaContainer}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={[styles.modalSongTitle, { color: isDarkMode ? '#ff2d55' : '#1c1c1e' }]} numberOfLines={1}>{currentTrack?.title}</Text>
                <Text style={[styles.modalArtistTitle, { color: isDarkMode ? '#ffffff' : '#8e8e93' }]} numberOfLines={1}>{currentTrack?.artist}</Text>
              </View>
            </View>

            <View style={styles.progressContainer}>
              <TouchableOpacity activeOpacity={1} onPress={handleTimelineScrub} style={styles.progressBarClickShield}>
                <View style={[styles.progressBarBg, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)' }]}>
                  <View style={[styles.progressBarFill, { width: `${playbackProgress}%`, backgroundColor: isDarkMode ? '#ff2d55' : '#1c1c1e' }]} />
                  <View style={[styles.progressKnob, { left: `${playbackProgress}%`, backgroundColor: isDarkMode ? '#ffffff' : '#1c1c1e' }]} />
                </View>
              </TouchableOpacity>
              
              <View style={styles.timeSpread}>
                <Text style={[styles.timeText, { color: isDarkMode ? 'rgba(255,255,255,0.6)' : '#8e8e93' }]}>
                  {formatTimeLabel(positionMillis)}
                </Text>
                <Text style={[styles.timeText, { color: isDarkMode ? 'rgba(255,255,255,0.6)' : '#8e8e93' }]}>
                  {(!currentTrack || !currentTrack.duration || currentTrack.duration === '--:--') ? "0:00" : currentTrack.duration}
                </Text>
              </View>
            </View>

            <View style={styles.mainControlsRow}>
              <TouchableOpacity style={styles.subMediaOptionButton} onPress={() => setIsShuffleOn(!isShuffleOn)}>
                <Ionicons name="shuffle" size={24} color={isShuffleOn ? "#ff2d55" : (isDarkMode ? "rgba(255,255,255,0.4)" : "#8e8e93")} />
                {isShuffleOn && <View style={styles.activeDotIndicator} />}
              </TouchableOpacity>

              <TouchableOpacity style={styles.secondaryControl} onPress={handlePrevTrack}>
                <Ionicons name="play-back" size={36} color={isDarkMode ? "#ffffff" : "#1c1c1e"} />
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.primaryPlayButton} onPress={handlePausePlayAction}>
                <Ionicons name={isPlaying ? "pause-circle" : "play-circle"} size={76} color={isDarkMode ? "#ff2d55" : "#1c1c1e"} />
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.secondaryControl} onPress={handleNextTrack}>
                <Ionicons name="play-forward" size={36} color={isDarkMode ? "#ffffff" : "#1c1c1e"} />
              </TouchableOpacity>

              <TouchableOpacity style={styles.subMediaOptionButton} onPress={() => setIsRepeatMode(prev => (prev + 1) % 3)}>
                <Ionicons name={isRepeatMode === 1 ? "repeat" : "repeat"} size={24} color={isRepeatMode > 0 ? "#ff2d55" : (isDarkMode ? "rgba(255,255,255,0.4)" : "#8e8e93")} />
                {isRepeatMode === 1 && <View style={styles.repeatOneTextBadge}><Text style={styles.repeatOneMiniText}>1</Text></View>}
                {isRepeatMode === 2 && <View style={styles.activeDotIndicator} />}
              </TouchableOpacity>
            </View>

            {/* FULLY FUNCTIONAL INTERACTIVE VOLUME DRAG BAR */}
            <View style={styles.volumeContainer}>
              <Ionicons name="volume-low" size={18} color={isDarkMode ? "rgba(255,255,255,0.6)" : "#8e8e93"} />
              <View style={styles.volumeTrackWrapper} {...volumePanResponder.panHandlers}>
                <View style={[styles.volumeTrackBg, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)' }]}>
                  <View style={[styles.volumeTrackFill, { width: `${volume * 100}%`, backgroundColor: isDarkMode ? '#ff2d55' : '#8e8e93' }]} />
                  <View style={[styles.volumeKnob, { left: `${volume * 100}%`, backgroundColor: isDarkMode ? '#ffffff' : '#8e8e93' }]} />
                </View>
              </View>
              <Ionicons name="volume-high" size={18} color={isDarkMode ? "rgba(255,255,255,0.6)" : "#8e8e93"} />
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  mainHomeHeader: { paddingHorizontal: 20, paddingTop: 25, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  massiveTitle: { fontSize: 34, fontWeight: 'bold', letterSpacing: -0.6 },
  headerRightActionContainer: { flexDirection: 'row', alignItems: 'center' },
  actionButtonCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 22, fontWeight: 'bold', marginHorizontal: 20, marginTop: 25, marginBottom: 12, letterSpacing: -0.2 },
  lightContainer: { backgroundColor: '#ffffff' },
  darkContainer: { backgroundColor: '#000000' },
  lightTextMain: { color: '#000000' },
  darkTextMain: { color: '#ffffff' },
  lightTextSub: { color: '#8e8e93' },
  darkTextSub: { color: '#8e8e93' },
  appleRedText: { color: '#ff2d55', fontWeight: 'bold' },
  lightBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e5ea' },
  darkBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1c1c1e' },
  lightToggleBg: { backgroundColor: '#f2f2f7' },
  darkToggleBg: { backgroundColor: '#1c1c1e' },
  searchContainerBox: { paddingHorizontal: 20, marginVertical: 8 },
  searchInnerWrapper: { flexDirection: 'row', alignItems: 'center', height: 38, borderRadius: 10, paddingHorizontal: 10 },
  lightSearchBg: { backgroundColor: '#f2f2f7' },
  darkSearchBg: { backgroundColor: '#1c1c1e' },
  searchIconLeft: { marginRight: 8 },
  searchInputField: { flex: 1, fontSize: 16, height: '100%', padding: 0 },
  searchClearBtn: { padding: 4 },
  cardItem: { width: 140, marginRight: 16, alignItems: 'center' },
  cardArtImage: { width: 140, height: 140, borderRadius: 16 }, // Uniform premium square corners
  cardTitleText: { fontSize: 14, fontWeight: '600', marginTop: 6, textAlign: 'center', width: '100%' },
  cardArtistText: { fontSize: 13, marginTop: 2, textAlign: 'center', width: '100%' },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginRight: 20, marginTop: 15, marginBottom: 10 },
  seeAllInlineLink: { fontSize: 16, color: '#ff2d55', fontWeight: '600' },
  trackRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12 },
  trackArt: { width: 46, height: 46, borderRadius: 8 }, 
  trackInfo: { flex: 1, marginLeft: 14 },
  trackTitle: { fontSize: 15, fontWeight: '600' },
  trackArtist: { fontSize: 13, marginTop: 2 },
  heartRowButton: { padding: 8, marginRight: 4 },
  trackDuration: { fontSize: 13, width: 34, textAlign: 'right' },
  subHeaderView: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, paddingHorizontal: 10 },
  backLinkRow: { flexDirection: 'row', alignItems: 'center', width: 80 },
  backLinkText: { color: '#ff2d55', fontSize: 17 },
  centerSubTitle: { fontSize: 17, fontWeight: '600' },
  miniPlayer: { position: 'absolute', left: 12, right: 12, height: 62, borderRadius: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
  lightMiniPlayer: { backgroundColor: 'rgba(250,250,252,0.95)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.05)' },
  darkMiniPlayer: { backgroundColor: 'rgba(28,28,30,0.95)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.04)' },
  miniArt: { width: 44, height: 44, borderRadius: 6 },
  miniText: { flex: 1, marginLeft: 12, fontSize: 14, fontWeight: '600' },
  miniControls: { flexDirection: 'row', alignItems: 'center' },
  miniControlBtn: { paddingHorizontal: 8 },
  floatingNavContainer: { position: 'absolute', bottom: 15, left: 20, right: 20, height: 60, borderRadius: 25, flexDirection: 'row', overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 10 },
  floatingNavBlurBg: { ...StyleSheet.absoluteFillObject },
  navTabItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navTabText: { fontSize: 11, fontWeight: '600', marginTop: 4 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 60 },
  emptyStateText: { fontSize: 16, marginTop: 12, textAlign: 'center', paddingHorizontal: 40 },
  settingBlockContainer: { borderRadius: 14, padding: 16, marginHorizontal: 2 },
  settingGroupHeader: { fontSize: 14, fontWeight: '700', textTransform: 'uppercase', opacity: 0.4, marginBottom: 14, letterSpacing: 0.5 },
  inlineSettingToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  settingLabel: { fontSize: 16, fontWeight: '500' },
  modalContainer: { flex: 1 },
  modalHeaderRow: { flexDirection: 'row', width: width * 0.85, alignItems: 'center', justifyContent: 'space-between', paddingTop: 10 },
  dismissChevron: { padding: 4, marginLeft: -10 },
  audioRouterBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.12)', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20 },
  audioRouteText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  giantArtworkContainer: { width: width * 0.84, height: width * 0.84, shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.35, shadowRadius: 25, elevation: 20 },
  giantArtwork: { width: '100%', height: '100%', borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }, 
  metaContainer: { width: width * 0.84, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalSongTitle: { fontSize: 24, fontWeight: 'bold', letterSpacing: -0.3 },
  modalArtistTitle: { fontSize: 20, marginTop: 2, fontWeight: '400' },
  progressContainer: { width: width * 0.84 },
  progressBarClickShield: { paddingVertical: 10, width: '100%' },
  progressBarBg: { height: 4, borderRadius: 2, flexDirection: 'row', alignItems: 'center', position: 'relative' },
  progressBarFill: { height: '100%', borderRadius: 2 },
  progressKnob: { width: 8, height: 8, borderRadius: 4, position: 'absolute', marginLeft: -4 },
  timeSpread: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  timeText: { fontSize: 12, fontWeight: '500' },
  mainControlsRow: { flexDirection: 'row', width: width * 0.84, justifyContent: 'space-between', alignItems: 'center' },
  primaryPlayButton: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  secondaryControl: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center' },
  subMediaOptionButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  activeDotIndicator: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#ff2d55', position: 'absolute', bottom: 2 },
  repeatOneTextBadge: { position: 'absolute', right: 8, top: 8, backgroundColor: '#ff2d55', width: 12, height: 12, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  repeatOneMiniText: { color: '#ffffff', fontSize: 8, fontWeight: 'bold' },
  volumeContainer: { flexDirection: 'row', width: width * 0.84, alignItems: 'center', justifyContent: 'space-between', paddingBottom: 20 },
  volumeTrackWrapper: { flex: 1, height: 30, justifyContent: 'center', marginHorizontal: 10 },
  volumeTrackBg: { height: 4, borderRadius: 2, width: '100%', position: 'relative', flexDirection: 'row', alignItems: 'center' },
  volumeTrackFill: { height: '100%', borderRadius: 2 },
  volumeKnob: { width: 12, height: 12, borderRadius: 6, position: 'absolute', marginLeft: -6 }
});