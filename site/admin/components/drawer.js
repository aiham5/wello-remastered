export const createDrawer = ({ root, titleEl, contentEl, closeBtn }) => {
  const close = () => {
    if (!root) return;
    root.classList.add("is-hidden");
    if (contentEl) contentEl.innerHTML = "";
    document.body.classList.remove("drawer-open");
  };

  const open = ({ title = "Details", content }) => {
    if (!root) return;
    if (titleEl) titleEl.textContent = title;
    if (contentEl) {
      contentEl.innerHTML = "";
      if (typeof content === "string") contentEl.innerHTML = content;
      else if (content instanceof Node) contentEl.appendChild(content);
    }
    root.classList.remove("is-hidden");
    document.body.classList.add("drawer-open");
  };

  closeBtn?.addEventListener("click", close);
  root?.addEventListener("click", (event) => {
    if (event.target === root) close();
  });

  return { open, close };
};
