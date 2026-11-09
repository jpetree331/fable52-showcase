// View state kept in the URL fragment, so any result can be shared as a link
// and survives a reload. Nothing is sent anywhere: fragments never leave the
// browser.

const read = () => new URLSearchParams(window.location.hash.slice(1));

export const store = {
  get(key, fallback = '') {
    return read().get(key) ?? fallback;
  },
  set(key, value) {
    const params = read();
    if (value === '' || value === null || value === undefined) params.delete(key);
    else params.set(key, String(value));
    const hash = params.toString();
    history.replaceState(null, '', hash ? `#${hash}` : window.location.pathname + window.location.search);
  },
};
