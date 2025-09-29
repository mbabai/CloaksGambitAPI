export function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

export function setCookie(name, value, maxAgeSeconds) {
  const secureContext = typeof window !== 'undefined' && window.location && window.location.protocol === 'https:';
  const parts = [name + '=' + encodeURIComponent(value), 'Path=/'];
  const hostname = typeof window !== 'undefined' && window.location ? window.location.hostname : '';
  if (hostname === 'cloaksgambit.bymarcell.com') {
    parts.push('Domain=cloaksgambit.bymarcell.com');
  }
  if (secureContext) {
    parts.push('SameSite=None', 'Secure');
  } else {
    parts.push('SameSite=Lax');
  }
  if (typeof maxAgeSeconds === 'number') parts.push('Max-Age=' + maxAgeSeconds);
  document.cookie = parts.join('; ');
}


