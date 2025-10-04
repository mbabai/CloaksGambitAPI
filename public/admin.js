import { preloadAssets } from '/js/modules/utils/assetPreloader.js';
import { upgradeButton } from '/js/modules/ui/buttons.js';
import { getIconAsset } from '/js/modules/ui/icons.js';

const AUTHORIZED_EMAIL = 'marcellbabai@gmail.com';
const GOOGLE_ICON_SRC = getIconAsset('google') || '/assets/images/google-icon.png';

preloadAssets();

const loginContainer = document.getElementById('adminLoginContainer');
const unauthorizedContainer = document.getElementById('adminUnauthorizedContainer');
const dashboardContainer = document.getElementById('adminDashboardContainer');
const loginButton = document.getElementById('adminGoogleLoginBtn');

let dashboardLoaded = false;

function showLogin() {
  if (loginContainer) loginContainer.hidden = false;
  if (unauthorizedContainer) unauthorizedContainer.hidden = true;
  if (dashboardContainer) dashboardContainer.hidden = true;
}

function showUnauthorized() {
  if (loginContainer) loginContainer.hidden = true;
  if (unauthorizedContainer) unauthorizedContainer.hidden = false;
  if (dashboardContainer) dashboardContainer.hidden = true;
}

function showDashboard() {
  if (loginContainer) loginContainer.hidden = true;
  if (unauthorizedContainer) unauthorizedContainer.hidden = true;
  if (dashboardContainer) dashboardContainer.hidden = false;
}

async function fetchSession() {
  try {
    const res = await fetch('/api/auth/session', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include'
    });
    if (!res.ok) {
      throw new Error(`Session request failed (${res.status})`);
    }
    return await res.json().catch(() => null);
  } catch (err) {
    console.warn('Failed to fetch admin session', err);
    return null;
  }
}

async function initialize() {
  if (loginButton) {
    const img = loginButton.querySelector('img');
    if (img) {
      img.src = GOOGLE_ICON_SRC;
      img.alt = 'Google';
    }
    upgradeButton(loginButton, { variant: 'neutral', position: 'relative' });
    loginButton.addEventListener('click', () => {
      window.location.href = '/api/auth/google';
    });
  }

  const session = await fetchSession();
  const isAuthenticated = Boolean(session?.authenticated && !session?.isGuest);
  const email = (session?.email || '').trim().toLowerCase();

  if (!isAuthenticated) {
    showLogin();
    return;
  }

  if (email !== AUTHORIZED_EMAIL) {
    showUnauthorized();
    return;
  }

  showDashboard();

  if (!dashboardLoaded) {
    dashboardLoaded = true;
    try {
      await import('./admin-dashboard.js');
    } catch (err) {
      console.error('Failed to load admin dashboard module', err);
    }
  }
}

initialize();
