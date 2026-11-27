const FIRST_PERSON_KEY = "titan-racers.first-person.v1";

/** The player's First-person view switch, kept on this device. Off by default. */
export function readFirstPersonView() {
  try {
    return window.localStorage.getItem(FIRST_PERSON_KEY) === "on";
  } catch {
    // Unreadable storage: the chase camera.
    return false;
  }
}

export function writeFirstPersonView(on: boolean) {
  try {
    window.localStorage.setItem(FIRST_PERSON_KEY, on ? "on" : "off");
  } catch {
    // Storage can be unavailable (private mode); the race keeps the choice.
  }
}
