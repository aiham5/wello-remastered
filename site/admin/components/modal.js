export const createConfirmModal = ({ root, titleEl, bodyEl, cancelBtn, confirmBtn }) => {
  let currentOnConfirm = null;

  const close = () => {
    if (!root) return;
    root.classList.add("is-hidden");
    currentOnConfirm = null;
    document.body.classList.remove("modal-open");
  };

  const open = ({ title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", onConfirm }) => {
    if (!root) return;
    if (titleEl) titleEl.textContent = title || "Confirm action";
    if (bodyEl) bodyEl.textContent = body || "Are you sure?";
    if (confirmBtn) confirmBtn.textContent = confirmLabel;
    if (cancelBtn) cancelBtn.textContent = cancelLabel;
    currentOnConfirm = typeof onConfirm === "function" ? onConfirm : null;
    root.classList.remove("is-hidden");
    document.body.classList.add("modal-open");
  };

  cancelBtn?.addEventListener("click", close);
  confirmBtn?.addEventListener("click", async () => {
    const run = currentOnConfirm;
    if (!run) {
      close();
      return;
    }
    confirmBtn.disabled = true;
    try {
      await run();
      close();
    } finally {
      confirmBtn.disabled = false;
    }
  });

  root?.addEventListener("click", (event) => {
    if (event.target === root) close();
  });

  return { open, close };
};
