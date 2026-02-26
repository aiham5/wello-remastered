export const withTimeout = async (promise, ms, label = "request") => {
  let timeoutId;
  const timer = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`${label} timed out`);
      error.name = "TimeoutError";
      reject(error);
    }, ms);
  });
  try {
    return await Promise.race([promise, timer]);
  } finally {
    clearTimeout(timeoutId);
  }
};

export const debounce = (fn, delay = 250) => {
  let id = null;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), delay);
  };
};
