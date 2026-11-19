// Small fetch wrapper that attaches the login token
const TOKEN_KEY = 'pm_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/google')) {
    setToken(null);
    window.location.href = '/login';
  }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const authHeader = () => (getToken() ? { Authorization: `Bearer ${getToken()}` } : {});

// Upload a file (multipart). Uses XHR so the caller can show progress (0–1).
export function apiUpload(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    Object.entries(authHeader()).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    if (onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON (e.g. proxy error page) */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      if (xhr.status === 401) { setToken(null); window.location.href = '/login'; }
      reject(new Error(data.error || (xhr.status === 413 ? 'This file is too large' : `Upload failed (${xhr.status})`)));
    };
    xhr.onerror = () => reject(new Error('Upload failed – check your connection'));
    xhr.send(formData);
  });
}

// Fetch a protected file as a Blob (images and downloads need the login token)
export async function apiBlob(path) {
  const res = await fetch(`/api${path}`, { headers: authHeader() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Could not load file (${res.status})`);
  }
  return res.blob();
}
