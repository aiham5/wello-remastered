export const createToastManager = (container) => {
  const show = ({ type = "info", message = "" }) => {
    if (!container || !message) return;
    const item = document.createElement("div");
    item.className = `admin-toast ${type}`;
    item.textContent = message;
    container.appendChild(item);
    requestAnimationFrame(() => item.classList.add("is-visible"));
    setTimeout(() => {
      item.classList.remove("is-visible");
      setTimeout(() => item.remove(), 180);
    }, 2800);
  };

  return {
    info: (message) => show({ type: "info", message }),
    success: (message) => show({ type: "success", message }),
    error: (message) => show({ type: "error", message }),
    warning: (message) => show({ type: "warning", message }),
  };
};
