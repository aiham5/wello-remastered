(() => {
  const configured =
    typeof window.__WELLO_ADMIN_HOST__ === "string"
      ? window.__WELLO_ADMIN_HOST__
      : "https://ADMIN_HOST";
  const normalized = configured.replace(/\/+$/, "");
  const status = document.getElementById("status-text");
  if (!normalized || normalized.includes("ADMIN_HOST")) {
    if (status) {
      status.textContent =
        "Admin redirect host is not configured yet. Set window.__WELLO_ADMIN_HOST__ to continue.";
    }
    return;
  }
  const currentPath = window.location.pathname.replace(/^\/admin\/?/, "");
  const nextUrl = `${normalized}/${currentPath}${window.location.search}${window.location.hash}`;
  const link = document.getElementById("admin-link");
  if (link) link.href = nextUrl;
  window.location.replace(nextUrl);
})();

