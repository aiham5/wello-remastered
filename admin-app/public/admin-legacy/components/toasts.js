export const createToastManager = (container) => {
  const show = ({ type = "info", message = "", action = null, durationMs = 2800 }) => {
    if (!container || !message) return null;

    const item = document.createElement("div");
    item.className = `admin-toast ${type}`;

    const text = document.createElement("span");
    text.className = "admin-toast-text";
    text.textContent = message;
    item.appendChild(text);

    let closed = false;
    let actionConsumed = false;

    const close = () => {
      if (closed) return;
      closed = true;
      item.classList.remove("is-visible");
      setTimeout(() => item.remove(), 180);
    };

    if (action && typeof action.onClick === "function" && action.label) {
      const actionBtn = document.createElement("button");
      actionBtn.type = "button";
      actionBtn.className = "admin-toast-action";
      actionBtn.textContent = String(action.label);
      actionBtn.addEventListener("click", async () => {
        if (actionConsumed) return;
        actionConsumed = true;
        actionBtn.disabled = true;
        try {
          await action.onClick();
        } finally {
          close();
        }
      });
      item.appendChild(actionBtn);
    }

    container.appendChild(item);
    requestAnimationFrame(() => item.classList.add("is-visible"));
    setTimeout(() => close(), Math.max(1200, Number(durationMs) || 2800));

    return { close };
  };

  return {
    info: (message, opts = {}) => show({ type: "info", message, ...opts }),
    success: (message, opts = {}) => show({ type: "success", message, ...opts }),
    error: (message, opts = {}) => show({ type: "error", message, ...opts }),
    warning: (message, opts = {}) => show({ type: "warning", message, ...opts }),
  };
};
