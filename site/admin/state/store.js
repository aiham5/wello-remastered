export const createStore = () => {
  const state = {
    session: null,
    profile: null,
    activeModule: "overview",
    moduleState: {},
  };
  const listeners = new Set();

  const getState = () => state;
  const setState = (patch) => {
    Object.assign(state, patch || {});
    listeners.forEach((listener) => listener(state));
  };
  const setModuleState = (key, patch) => {
    if (!state.moduleState[key]) state.moduleState[key] = {};
    state.moduleState[key] = { ...state.moduleState[key], ...(patch || {}) };
    listeners.forEach((listener) => listener(state));
  };
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { getState, setState, setModuleState, subscribe };
};
