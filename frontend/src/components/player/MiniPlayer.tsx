import {
  ChevronDown,
  Expand,
  ListOrdered,
  Maximize2,
  Mic2,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Subtitles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { formatDuration } from '../../lib/format';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../lib/db/database';
import { useUiStore } from '../../store/uiStore';

export function MiniPlayer() {
  const {
    queue,
    currentIndex,
    isPlaying,
    playTrack,
    setPlaying,
    next,
    prev,
    volume,
    setVolume,
    speed,
    setSpeed,
    miniMode,
    expandPlayer,
    minimizePlayer,
    closePlayer,
    playbackMode,
    setPlaybackMode,
    repeatMode,
    setRepeatMode,
    onTrackEnded,
    subtitleLanguage,
    setSubtitleLanguage,
  } = usePlayerStore();
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [queueVisible, setQueueVisible] = useState(true);
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pushToast = useUiStore((state) => state.pushNotification);

  const currentTrack = useMemo(() => queue[currentIndex], [queue, currentIndex]);
  const trackLocalId = currentTrack?.localId ?? '';
  const offlineMedia = useLiveQuery(
    () => (trackLocalId ? db.offlineMedia.where('downloadLocalId').equals(trackLocalId).first() : undefined),
    [trackLocalId]
  );
  const offlineSubtitles = useLiveQuery(
    () => (trackLocalId ? db.offlineSubtitles.where('downloadLocalId').equals(trackLocalId).toArray() : []),
    [trackLocalId]
  );
  const offlineMediaBlob = offlineMedia?.blob;
  const offlineMediaUrl = useMemo(() => {
    if (!offlineMediaBlob) {
      return null;
    }
    return URL.createObjectURL(offlineMediaBlob);
  }, [offlineMediaBlob]);
  const offlineSubtitleTracks = useMemo(() => {
    const rows = offlineSubtitles ?? [];
    return rows.map((row) => ({
      localId: `${row.subtitleLocalId}-offline`,
      language: row.language,
      path: URL.createObjectURL(row.blob),
      isDefault: false,
    }));
  }, [offlineSubtitles]);
  const effectiveSubtitles = useMemo(
    () => (offlineSubtitleTracks.length > 0 ? offlineSubtitleTracks : (currentTrack?.subtitles ?? [])),
    [offlineSubtitleTracks, currentTrack?.subtitles]
  );
  const effectiveSrc = offlineMediaUrl ?? (currentTrack?.src ?? '');
  const isVideo = currentTrack?.mediaKind === 'video';
  const resolvedDuration = duration > 0 ? duration : Number(currentTrack?.durationSeconds ?? 0);
  const upcomingTracks = useMemo(
    () => queue.filter((_, index) => index !== currentIndex).slice(0, 10),
    [queue, currentIndex]
  );

  useEffect(
    () => () => {
      if (offlineMediaUrl) {
        URL.revokeObjectURL(offlineMediaUrl);
      }
    },
    [offlineMediaUrl]
  );

  useEffect(
    () => () => {
      offlineSubtitleTracks.forEach((item) => URL.revokeObjectURL(item.path));
    },
    [offlineSubtitleTracks]
  );

  useEffect(() => {
    if (!mediaRef.current) {
      return;
    }
    mediaRef.current.volume = volume;
    mediaRef.current.playbackRate = speed;
  }, [volume, speed, effectiveSrc, trackLocalId]);

  useEffect(() => {
    if (!mediaRef.current) {
      return;
    }
    if (isPlaying) {
      void mediaRef.current.play().catch(() => {
        pushToast({
          id: crypto.randomUUID(),
          title: 'No se puede reproducir',
          body: 'Archivo no disponible en red o cache offline.',
          createdAt: new Date().toISOString(),
        });
      });
    } else {
      mediaRef.current.pause();
    }
  }, [isPlaying, effectiveSrc, trackLocalId, pushToast]);

  useEffect(() => {
    if (!isVideo || !mediaRef.current) {
      return;
    }
    const textTracks = mediaRef.current.textTracks;
    for (let i = 0; i < textTracks.length; i += 1) {
      const track = textTracks[i];
      if (!subtitleLanguage) {
        track.mode = 'disabled';
        continue;
      }
      track.mode = (track.language || '').toLowerCase() === subtitleLanguage.toLowerCase() ? 'showing' : 'disabled';
    }
  }, [subtitleLanguage, isVideo, effectiveSubtitles, trackLocalId]);

  useEffect(() => {
    const handler = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  useEffect(() => {
    if (miniMode) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) {
        minimizePlayer();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [miniMode, minimizePlayer]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      const media = mediaRef.current as unknown as {
        requestFullscreen?: () => Promise<void>;
        webkitEnterFullscreen?: () => void;
      } | null;
      const panel = panelRef.current as unknown as {
        requestFullscreen?: () => Promise<void>;
      } | null;

      if (isVideo && media?.requestFullscreen) {
        await media.requestFullscreen();
      } else if (panel?.requestFullscreen) {
        await panel.requestFullscreen();
      } else if (isVideo && media?.webkitEnterFullscreen) {
        media.webkitEnterFullscreen();
      }

      try {
        const orientationApi = (screen as unknown as { orientation?: { lock?: (mode: string) => Promise<void> } }).orientation;
        if (orientationApi?.lock) {
          await orientationApi.lock('landscape');
        }
      } catch {
        // no-op
      }
    } catch {
      pushToast({
        id: crypto.randomUUID(),
        title: 'Pantalla completa no disponible',
        body: 'Este navegador o dispositivo no soporta fullscreen para este medio.',
        createdAt: new Date().toISOString(),
      });
    }
  };

  if (!currentTrack) {
    return <></>;
  }

  return (
    <section
      className={
        miniMode
          ? 'fixed bottom-3 left-3 right-3 z-30 rounded-2xl border border-[#2B323A] bg-[#101418]/96 shadow-[0_0_28px_rgba(0,0,0,.5)] backdrop-blur transition-all duration-300 ease-[cubic-bezier(.22,1,.36,1)] will-change-transform animate-[playerMiniIn_.24s_ease-out]'
          : 'fixed inset-0 z-50 flex items-end justify-center bg-black/72 p-2 backdrop-blur-[2px] transition-all duration-300 ease-[cubic-bezier(.22,1,.36,1)] will-change-transform animate-[playerOverlayIn_.22s_ease-out] sm:items-center sm:p-4'
      }
      onClick={!miniMode ? () => minimizePlayer() : undefined}
    >
      <div
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
        className={
          miniMode
            ? 'w-full transform-gpu transition-all duration-300 ease-[cubic-bezier(.22,1,.36,1)]'
            : 'w-full max-w-[min(96vw,1500px)] overflow-hidden rounded-2xl border border-[#2D343B] bg-[#0F1418] shadow-[0_0_50px_rgba(0,0,0,.6)] transform-gpu transition-all duration-300 ease-[cubic-bezier(.22,1,.36,1)] animate-[playerPanelIn_.28s_cubic-bezier(.22,1,.36,1)]'
        }
      >
        <div
          className={
            miniMode
              ? 'space-y-3 p-3'
              : queueVisible
                ? 'grid gap-4 p-4 lg:grid-cols-[minmax(0,1.85fr)_minmax(360px,1fr)]'
                : 'grid gap-4 p-4 lg:grid-cols-1'
          }
        >
          <div className='space-y-3'>
            <div className='flex items-center justify-between gap-3'>
              <button
                type='button'
                onClick={miniMode ? () => expandPlayer() : () => minimizePlayer()}
                className='flex min-w-0 flex-1 items-center gap-3 text-left'
                title={miniMode ? 'Abrir reproductor' : 'Minimizar reproductor'}
              >
                <div
                  className={`${miniMode ? 'h-11 w-11' : 'h-14 w-14'} shrink-0 overflow-hidden rounded-lg border border-[#2A3036] bg-[#0B0E11] transition-all duration-300 ease-[cubic-bezier(.22,1,.36,1)]`}
                >
                  {currentTrack.poster ? (
                    <img src={currentTrack.poster} alt={currentTrack.title} className='h-full w-full object-cover' />
                  ) : (
                    <div className='grid h-full place-items-center text-[10px] text-[#6F7782]'>
                      {currentTrack.mediaKind.toUpperCase()}
                    </div>
                  )}
                </div>

                <div className='min-w-0'>
                  <p className='line-clamp-2 text-sm font-semibold text-[#E9EEF6]'>{currentTrack.title}</p>
                  <p className='text-[11px] uppercase tracking-[0.08em] text-[#9AA3AE]'>
                    {currentTrack.mediaKind} • {isPlaying ? 'playing' : 'paused'} • {playbackMode === 'shuffle' ? 'aleatorio' : 'ordenado'} • {repeatMode === 'one' ? 'repetir 1' : 'sin repetir'}
                  </p>
                </div>
              </button>

              <div className='flex items-center gap-1'>
                <button
                  type='button'
                  className='rounded-md border border-[#2A3036] p-1 text-[#A3FF12] transition-all duration-200 hover:scale-105 hover:border-[#2F5B2B]'
                  onClick={miniMode ? () => expandPlayer() : () => minimizePlayer()}
                  title={miniMode ? 'Abrir modal' : 'Minimizar'}
                >
                  {miniMode ? <Maximize2 size={14} /> : <ChevronDown size={16} />}
                </button>
                <button
                  type='button'
                  className='rounded-md border border-[#2A3036] p-1 text-[#F7E733] transition-all duration-200 hover:scale-105 hover:border-[#6B6420]'
                  onClick={() => void toggleFullscreen()}
                  title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
                >
                  <Expand size={14} />
                </button>
                <button
                  type='button'
                  className='rounded-md border border-[#3B4148] p-1 text-[#D3DAE3] transition-all duration-200 hover:scale-105 hover:border-[#5A2028] hover:text-[#FFB7BD]'
                  onClick={closePlayer}
                  title='Cerrar reproductor'
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {isVideo ? (
              <video
                ref={mediaRef}
                src={effectiveSrc}
                className={`w-full rounded-xl border border-[#242A30] bg-[#080A0B] ${miniMode ? 'h-40' : 'h-[54vh] min-h-[320px] max-h-[720px]'}`}
                poster={currentTrack.poster ?? undefined}
                controls={false}
                loop={repeatMode === 'one'}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onLoadedMetadata={(event) => {
                  setCurrentTime(event.currentTarget.currentTime || 0);
                  setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
                }}
                muted={volume === 0}
                autoPlay={isPlaying}
                onEnded={onTrackEnded}
                onError={() => {
                  pushToast({
                    id: crypto.randomUUID(),
                    title: 'Error de reproducción',
                    body: 'No se pudo cargar el video MP4. Revisa estado de descarga o cache offline.',
                    createdAt: new Date().toISOString(),
                  });
                }}
              >
                {effectiveSubtitles.map((subtitle) => (
                  <track
                    key={subtitle.localId}
                    src={subtitle.path}
                    srcLang={subtitle.language}
                    kind='subtitles'
                    label={subtitle.language.toUpperCase()}
                    default={subtitleLanguage ? subtitle.language === subtitleLanguage : subtitle.isDefault}
                  />
                ))}
              </video>
            ) : (
              <>
                <audio
                  ref={mediaRef}
                  src={effectiveSrc}
                  loop={repeatMode === 'one'}
                  onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                  muted={volume === 0}
                  autoPlay={isPlaying}
                  onLoadedMetadata={(event) => {
                    setCurrentTime(event.currentTarget.currentTime || 0);
                    setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
                  }}
                  onEnded={onTrackEnded}
                  onError={() => {
                    pushToast({
                      id: crypto.randomUUID(),
                      title: 'Error de reproducción',
                      body: 'No se pudo cargar el audio MP3. Revisa estado de descarga o cache offline.',
                      createdAt: new Date().toISOString(),
                    });
                  }}
                />
                {!miniMode && (
                  <div className='grid h-[50vh] min-h-[300px] place-items-center rounded-xl border border-[#242A30] bg-[radial-gradient(circle_at_20%_20%,rgba(163,255,18,.12),transparent_42%),radial-gradient(circle_at_80%_16%,rgba(247,231,51,.08),transparent_42%),#0C1014] animate-[playerPanelIn_.25s_ease-out]'>
                    <div className='w-full max-w-[320px] rounded-2xl border border-[#2A3138] bg-[#11161A] p-4 shadow-[0_0_30px_rgba(0,0,0,.4)]'>
                      <div className='aspect-square overflow-hidden rounded-xl border border-[#303840] bg-[#0A0E11]'>
                        {currentTrack.poster ? (
                          <img src={currentTrack.poster} alt={currentTrack.title} className='h-full w-full object-cover' />
                        ) : (
                          <div className='grid h-full place-items-center text-sm text-[#7B858F]'>Sin portada</div>
                        )}
                      </div>
                      <p className='mt-3 line-clamp-2 text-sm font-semibold text-[#ECF2FA]'>{currentTrack.title}</p>
                      <p className='mt-1 text-[11px] uppercase tracking-[0.08em] text-[#A1ABB6]'>Audio player • background ready</p>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className='flex items-center gap-3'>
              <button
                type='button'
                onClick={() => setPlaybackMode(playbackMode === 'ordered' ? 'shuffle' : 'ordered')}
                className={`player-btn ${playbackMode === 'shuffle' ? 'border-[#6B6420] text-[#F7E733]' : 'border-[#2F5B2B] text-[#A3FF12]'}`}
                title={playbackMode === 'shuffle' ? 'Modo aleatorio activo' : 'Modo ordenado activo'}
              >
                {playbackMode === 'shuffle' ? <Shuffle size={14} /> : <ListOrdered size={14} />}
              </button>
              <button
                type='button'
                onClick={() => setRepeatMode(repeatMode === 'one' ? 'off' : 'one')}
                className={`player-btn ${repeatMode === 'one' ? 'border-[#6B6420] text-[#F7E733]' : 'border-[#2A3036] text-[#B7C0CB]'}`}
                title={repeatMode === 'one' ? 'Repetir canción activo' : 'Repetir canción desactivado'}
              >
                <span className='relative inline-flex'>
                  <Repeat size={14} />
                  {repeatMode === 'one' && (
                    <span className='absolute -bottom-1.5 -right-1.5 rounded border border-[#6B6420] bg-[#2B2B16] px-0.5 text-[8px] leading-3 text-[#F7E733]'>
                      1
                    </span>
                  )}
                </span>
              </button>
              <button type='button' onClick={prev} className='player-btn transition-all duration-200 hover:scale-105'>
                <SkipBack size={15} />
              </button>
              <button
                type='button'
                onClick={() => setPlaying(!isPlaying)}
                className='grid h-10 w-10 place-items-center rounded-full border border-[#2F5B2B] bg-[#162116] text-[#A3FF12] shadow-[0_0_14px_rgba(163,255,18,.2)] transition-all duration-200 hover:scale-105'
              >
                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <button type='button' onClick={next} className='player-btn transition-all duration-200 hover:scale-105'>
                <SkipForward size={15} />
              </button>

              <div className='ml-2 flex flex-1 items-center gap-2'>
                <span className='w-10 text-right text-xs text-[#9EA7B2]'>{formatDuration(currentTime)}</span>
                <input
                  type='range'
                  min={0}
                  max={Math.max(resolvedDuration, 1)}
                  value={Math.min(currentTime, Math.max(resolvedDuration, 1))}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setCurrentTime(value);
                    if (mediaRef.current) {
                      mediaRef.current.currentTime = value;
                    }
                  }}
                  className='h-1 flex-1 accent-[#A3FF12]'
                />
                <span className='w-10 text-xs text-[#9EA7B2]'>{formatDuration(resolvedDuration)}</span>
              </div>
            </div>

            <div className='flex flex-wrap items-center gap-2'>
              <button type='button' onClick={() => setVolume(volume > 0 ? 0 : 1)} className='player-btn' title='Mute'>
                {volume > 0 ? <Volume2 size={14} /> : <VolumeX size={14} />}
              </button>

              <input
                type='range'
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setVolume(value);
                  if (mediaRef.current) {
                    mediaRef.current.volume = value;
                  }
                }}
                className='h-1 w-28 accent-[#A3FF12]'
              />

              <label className='ml-1 text-xs text-[#9EA7B2]'>x</label>
              <select
                value={speed}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setSpeed(value);
                  if (mediaRef.current) {
                    mediaRef.current.playbackRate = value;
                  }
                }}
                className='rounded border border-[#2A3036] bg-[#151B1F] px-2 py-1 text-xs text-[#D6DDE6]'
              >
                {[0.75, 1, 1.25, 1.5, 2].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>

              {effectiveSubtitles.length > 0 && (
                <div className='ml-auto flex items-center gap-2'>
                  <Subtitles size={14} className='text-[#F7E733]' />
                  <select
                    value={subtitleLanguage ?? ''}
                    onChange={(event) => setSubtitleLanguage(event.target.value || null)}
                    className='rounded border border-[#6B6420] bg-[#2B2B16] px-2 py-1 text-xs text-[#F7E733]'
                  >
                    <option value=''>OFF</option>
                    {effectiveSubtitles.map((subtitle) => (
                      <option key={subtitle.localId} value={subtitle.language}>
                        {subtitle.language.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <span className='inline-flex items-center gap-1 rounded-md border border-[#2F5B2B] bg-[#142016] px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[#A3FF12]'>
                <Mic2 size={10} />
                {offlineMediaUrl ? 'Offline activo' : 'Segundo plano activo'}
              </span>

              {!miniMode && (
                <button
                  type='button'
                  onClick={() => setQueueVisible((value) => !value)}
                  className='rounded-md border border-[#3B4148] bg-[#1A1F24] px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[#D3DAE3] hover:border-[#6B6420] hover:text-[#F7E733]'
                  title={queueVisible ? 'Ocultar cola' : 'Mostrar cola'}
                >
                  {queueVisible ? 'Ocultar cola' : 'Mostrar cola'}
                </button>
              )}
            </div>
          </div>

          {!miniMode && queueVisible && (
            <aside className='space-y-3 rounded-xl border border-[#252C33] bg-[#12171B] p-3 animate-[playerPanelIn_.26s_ease-out]'>
              <div className='flex items-center justify-between'>
                <h3 className='text-sm font-semibold uppercase tracking-[0.08em] text-[#E7EDF5]'>Siguiente en cola</h3>
                <span className='text-xs text-[#9BA6B2]'>{upcomingTracks.length} total</span>
              </div>

              <div className='max-h-[48vh] space-y-2 overflow-auto pr-1'>
                {upcomingTracks.map((track) => (
                  <button
                    key={track.localId}
                    type='button'
                    onClick={() => playTrack(track)}
                    className='flex w-full items-center gap-2 rounded-lg border border-[#2A3138] bg-[#141A1F] p-2 text-left transition hover:border-[#3B444E]'
                  >
                    <div className='h-10 w-10 shrink-0 overflow-hidden rounded border border-[#2C343D] bg-[#0A0E11]'>
                      {track.poster ? (
                        <img src={track.poster} alt={track.title} className='h-full w-full object-cover' />
                      ) : (
                        <div className='grid h-full place-items-center text-[10px] text-[#77818D]'>{track.mediaKind.toUpperCase()}</div>
                      )}
                    </div>
                    <div className='min-w-0'>
                      <p className='line-clamp-2 text-xs font-semibold text-[#E4EAF2]'>{track.title}</p>
                      <p className='text-[10px] uppercase tracking-[0.08em] text-[#98A3AF]'>{track.mediaKind}</p>
                    </div>
                  </button>
                ))}

                {upcomingTracks.length === 0 && (
                  <p className='rounded-lg border border-[#262D34] bg-[#141A1F] p-3 text-xs text-[#98A3AF]'>
                    No hay más elementos en cola. Añade música o videos desde Biblioteca/Listas.
                  </p>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>
    </section>
  );
}
