const NOTE_MODE_CACHE = {};
const EMAIL_STORAGE_KEY = "emailForSignIn";

export function getStoredEmailForSignIn() {
  try {
    return localStorage.getItem(EMAIL_STORAGE_KEY) || "";
  } catch (err) {
    console.error("Error reading stored email", err);
    return "";
  }
}

export function setStoredEmailForSignIn(email) {
  try {
    localStorage.setItem(EMAIL_STORAGE_KEY, email);
  } catch (err) {
    console.error("Error persisting stored email", err);
  }
}

export function clearStoredEmailForSignIn() {
  try {
    localStorage.removeItem(EMAIL_STORAGE_KEY);
  } catch (err) {
    console.error("Error clearing stored email", err);
  }
}

function getNoteModeKey(coursePath, lessonTitle, noteId = "") {
  return `${coursePath || ""}::${lessonTitle || ""}::${noteId || "draft"}`;
}

export function getNoteMode(coursePath, lessonTitle, noteId = "") {
  return NOTE_MODE_CACHE[getNoteModeKey(coursePath, lessonTitle, noteId)] || "edit";
}

export function setNoteMode(coursePath, lessonTitle, noteId = "", mode = "edit") {
  NOTE_MODE_CACHE[getNoteModeKey(coursePath, lessonTitle, noteId)] = mode;
}

