(() => {
  const storageKey = "wello-admin-theme";
  const saved = localStorage.getItem(storageKey);
  const prefersDark =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme =
    saved === "dark" || saved === "light"
      ? saved
      : prefersDark
        ? "dark"
        : "light";
  document.documentElement.setAttribute("data-theme", theme);
})();

