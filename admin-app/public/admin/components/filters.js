import { debounce } from "../lib/http.js";

export const bindFilterInputs = ({ root, selectors, onChange, delay = 220 }) => {
  const handler = debounce(onChange, delay);
  selectors.forEach((selector) => {
    const node = root.querySelector(selector);
    if (!node) return;
    node.addEventListener("input", handler);
    node.addEventListener("change", handler);
  });
};
