const normalizeHash = (hash) => {
  const raw = String(hash || window.location.hash || "").replace(/^#\/?/, "");
  return raw || "overview";
};

export const createRouter = ({ onRouteChange }) => {
  let started = false;

  const handler = () => {
    const route = normalizeHash(window.location.hash);
    onRouteChange(route);
  };

  const start = () => {
    if (started) {
      handler();
      return;
    }
    started = true;
    window.addEventListener("hashchange", handler);
    handler();
  };

  const navigate = (route) => {
    const next = String(route || "overview").replace(/^#\/?/, "");
    if (normalizeHash(window.location.hash) === next) {
      onRouteChange(next);
      return;
    }
    window.location.hash = `#/${next}`;
  };

  const stop = () => {
    if (!started) return;
    started = false;
    window.removeEventListener("hashchange", handler);
  };

  return { start, stop, navigate };
};
