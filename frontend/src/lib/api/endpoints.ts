import { api } from './client';

export const apiEndpoints = {
  login: (payload: { login: string; password: string; remember: boolean }) =>
    api.post('/auth/login', payload).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
  dashboard: (params?: { scope?: 'mine' | 'all' }) => api.get('/dashboard', { params }).then((r) => r.data),
  downloads: (params?: { scope?: 'mine' | 'all'; target_user_id?: number; q?: string; status?: string }) =>
    api.get('/downloads', { params }).then((r) => r.data),
  createDownload: (payload: unknown) => api.post('/downloads', payload).then((r) => r.data),
  downloadFormats: (url: string) => api.get('/downloads/formats', { params: { url }, timeout: 90000 }).then((r) => r.data),
  updateDownload: (id: number | string, payload: unknown) => api.put(`/downloads/${id}`, payload).then((r) => r.data),
  updateDownloadByLocal: (localId: string, payload: unknown) => api.put(`/downloads/by-local/${encodeURIComponent(localId)}`, payload).then((r) => r.data),
  deleteDownloadByLocal: (localId: string) => api.delete(`/downloads/by-local/${encodeURIComponent(localId)}`).then((r) => r.data),
  retryDownload: (id: number | string) => api.post(`/downloads/${id}/retry`).then((r) => r.data),
  collections: () => api.get('/collections').then((r) => r.data),
  collectionById: (id: number | string) => api.get(`/collections/${id}`).then((r) => r.data),
  createCollection: (payload: unknown) => api.post('/collections', payload).then((r) => r.data),
  updateCollection: (id: number | string, payload: unknown) => api.put(`/collections/${id}`, payload).then((r) => r.data),
  deleteCollection: (id: number | string) => api.delete(`/collections/${id}`).then((r) => r.data),
  subtitles: () => api.get('/subtitles').then((r) => r.data),
  syncStatus: () => api.get('/sync').then((r) => r.data),
  enqueueSync: (payload: unknown) => api.post('/sync', payload).then((r) => r.data),
  activity: () => api.get('/activity').then((r) => r.data),
  settings: () => api.get('/settings').then((r) => r.data),
  saveSettings: (payload: unknown) => api.put('/settings', payload).then((r) => r.data),
  systemStatus: () => api.get('/system/status').then((r) => r.data),
  uploadYoutubeCookies: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api
      .post('/system/youtube-cookies', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })
      .then((r) => r.data);
  },
  deleteYoutubeCookies: () => api.delete('/system/youtube-cookies').then((r) => r.data),
  youtubeSearch: (q: string, limit = 10) => api.get('/youtube/search', { params: { q, limit }, timeout: 45000 }).then((r) => r.data),
  recommendations: (limit = 12) => api.get('/recommendations', { params: { limit } }).then((r) => r.data),
  users: () => api.get('/users').then((r) => r.data),
};
