import { create } from 'zustand';
import type { PlayerTrack } from '../types/models';

type PlaybackMode = 'ordered' | 'shuffle';

const buildShufflePool = (length: number, excludeIndex: number): number[] => {
  const pool: number[] = [];
  for (let i = 0; i < length; i += 1) {
    if (i !== excludeIndex) {
      pool.push(i);
    }
  }

  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
};

interface PlayerState {
  queue: PlayerTrack[];
  currentIndex: number;
  isPlaying: boolean;
  volume: number;
  speed: number;
  subtitleLanguage: string | null;
  miniMode: boolean;
  playbackMode: PlaybackMode;
  shuffleHistory: number[];
  shufflePool: number[];
  setQueue: (queue: PlayerTrack[], startLocalId?: string) => void;
  playTrack: (track: PlayerTrack) => void;
  setPlaying: (isPlaying: boolean) => void;
  setPlaybackMode: (mode: PlaybackMode) => void;
  next: () => void;
  prev: () => void;
  onTrackEnded: () => void;
  setVolume: (volume: number) => void;
  setSpeed: (speed: number) => void;
  setSubtitleLanguage: (language: string | null) => void;
  setMiniMode: (miniMode: boolean) => void;
  expandPlayer: () => void;
  minimizePlayer: () => void;
  toggleMiniMode: () => void;
  closePlayer: () => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  currentIndex: 0,
  isPlaying: false,
  volume: 1,
  speed: 1,
  subtitleLanguage: null,
  miniMode: true,
  playbackMode: 'ordered',
  shuffleHistory: [],
  shufflePool: [],
  setQueue: (queue, startLocalId) => {
    const index = startLocalId ? Math.max(queue.findIndex((x) => x.localId === startLocalId), 0) : 0;
    const playbackMode = get().playbackMode;
    set({
      queue,
      currentIndex: index,
      isPlaying: queue.length > 0,
      miniMode: queue.length > 0 ? false : get().miniMode,
      shuffleHistory: [],
      shufflePool: playbackMode === 'shuffle' ? buildShufflePool(queue.length, index) : [],
    });
  },
  playTrack: (track) => {
    const { queue, playbackMode } = get();
    const existingIndex = queue.findIndex((x) => x.localId === track.localId);

    if (existingIndex >= 0) {
      set({
        currentIndex: existingIndex,
        isPlaying: true,
        miniMode: false,
        shufflePool: playbackMode === 'shuffle' ? buildShufflePool(queue.length, existingIndex) : get().shufflePool,
      });
      return;
    }

    set({ queue: [track], currentIndex: 0, isPlaying: true, miniMode: false, shuffleHistory: [], shufflePool: [] });
  },
  setPlaying: (isPlaying) => set({ isPlaying }),
  setPlaybackMode: (mode) =>
    set((state) => {
      if (mode === state.playbackMode) {
        return {};
      }
      return {
        playbackMode: mode,
        shuffleHistory: [],
        shufflePool: mode === 'shuffle' ? buildShufflePool(state.queue.length, state.currentIndex) : [],
      };
    }),
  next: () =>
    set((state) => {
      if (state.queue.length <= 1) {
        return {};
      }

      if (state.playbackMode === 'shuffle') {
        let pool = state.shufflePool.filter((idx) => idx !== state.currentIndex);
        if (pool.length === 0) {
          pool = buildShufflePool(state.queue.length, state.currentIndex);
        }
        const nextIndex = pool[0];
        if (nextIndex === undefined) {
          return {};
        }
        return {
          currentIndex: nextIndex,
          isPlaying: true,
          shuffleHistory: [...state.shuffleHistory, state.currentIndex].slice(-100),
          shufflePool: pool.slice(1),
        };
      }

      return {
        currentIndex: state.currentIndex >= state.queue.length - 1 ? state.currentIndex : state.currentIndex + 1,
      };
    }),
  prev: () =>
    set((state) => {
      if (state.queue.length === 0) {
        return {};
      }

      if (state.playbackMode === 'shuffle' && state.shuffleHistory.length > 0) {
        const history = [...state.shuffleHistory];
        const previousIndex = history.pop();
        if (previousIndex === undefined) {
          return {};
        }
        return {
          currentIndex: previousIndex,
          isPlaying: true,
          shuffleHistory: history,
          shufflePool: [state.currentIndex, ...state.shufflePool.filter((idx) => idx !== previousIndex)],
        };
      }

      return {
        currentIndex: state.currentIndex <= 0 ? 0 : state.currentIndex - 1,
      };
    }),
  onTrackEnded: () =>
    set((state) => {
      const total = state.queue.length;
      if (total <= 1) {
        return { isPlaying: false };
      }

      if (state.playbackMode === 'shuffle') {
        let pool = state.shufflePool.filter((idx) => idx !== state.currentIndex);
        if (pool.length === 0) {
          pool = buildShufflePool(total, state.currentIndex);
        }
        const nextIndex = pool[0];
        if (nextIndex === undefined) {
          return { isPlaying: false };
        }
        return {
          currentIndex: nextIndex,
          isPlaying: true,
          shuffleHistory: [...state.shuffleHistory, state.currentIndex].slice(-100),
          shufflePool: pool.slice(1),
        };
      }

      if (state.currentIndex < total - 1) {
        return { currentIndex: state.currentIndex + 1, isPlaying: true };
      }

      return { isPlaying: false };
    }),
  setVolume: (volume) => set({ volume }),
  setSpeed: (speed) => set({ speed }),
  setSubtitleLanguage: (subtitleLanguage) => set({ subtitleLanguage }),
  setMiniMode: (miniMode) => set({ miniMode }),
  expandPlayer: () => set({ miniMode: false }),
  minimizePlayer: () => set({ miniMode: true }),
  toggleMiniMode: () => set((state) => ({ miniMode: !state.miniMode })),
  closePlayer: () =>
    set({
      queue: [],
      currentIndex: 0,
      isPlaying: false,
      miniMode: true,
      subtitleLanguage: null,
      shuffleHistory: [],
      shufflePool: [],
    }),
}));
