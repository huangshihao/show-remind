export interface Selectable {
  name: string;
  songCount: number;
  avatar?: string | null;
}

export interface WizardState {
  step: number; // 0 paste, 1 pick artists, 2 cities, 3 email
  title: string;
  artists: Selectable[];
  selected: string[]; // artist names
  cities: string[];
  email: string;
}

export type WizardAction =
  | { type: "LOADED_PLAYLIST"; title: string; artists: Selectable[] }
  | { type: "TOGGLE_ARTIST"; name: string }
  | { type: "ADD_MANUAL"; name: string }
  | { type: "SET_CITIES"; cities: string[] }
  | { type: "SET_EMAIL"; email: string }
  | { type: "GOTO"; step: number };

export function initialWizard(): WizardState {
  return { step: 0, title: "", artists: [], selected: [], cities: [], email: "" };
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "LOADED_PLAYLIST":
      return {
        ...state,
        step: 1,
        title: action.title,
        artists: action.artists,
        selected: action.artists.map((a) => a.name),
      };
    case "TOGGLE_ARTIST": {
      const on = state.selected.includes(action.name);
      return {
        ...state,
        selected: on
          ? state.selected.filter((n) => n !== action.name)
          : [...state.selected, action.name],
      };
    }
    case "ADD_MANUAL": {
      const name = action.name.trim();
      if (!name) return state;
      const known = state.artists.some((a) => a.name === name);
      return {
        ...state,
        artists: known ? state.artists : [...state.artists, { name, songCount: 0 }],
        selected: state.selected.includes(name) ? state.selected : [...state.selected, name],
      };
    }
    case "SET_CITIES":
      return { ...state, cities: action.cities };
    case "SET_EMAIL":
      return { ...state, email: action.email };
    case "GOTO":
      return { ...state, step: action.step };
  }
}

export function selectedArtistNames(state: WizardState): string[] {
  return state.selected;
}
