export function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

export function setCookie(name, value, maxAgeSeconds) {
  const parts = [name + '=' + encodeURIComponent(value), 'Path=/', 'SameSite=Lax'];
  if (maxAgeSeconds !== undefined && maxAgeSeconds !== null) parts.push('Max-Age=' + maxAgeSeconds);
  document.cookie = parts.join('; ');
}


