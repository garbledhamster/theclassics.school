import {
  actionCodeSettings,
  auth,
  db,
  deleteDoc,
  doc,
  getDoc,
  onAuthStateChanged,
  runTransaction,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  isSignInWithEmailLink,
  signOut,
  setDoc
} from './firebase-config.js';
import { clearTrustedDeviceCache, persistTrustedCache, getTrustedCache } from './utils.js';
import { decodeSalt, decryptSecret, deriveKeyFromPassphrase, encryptSecret, generatePassphrase } from './vault.js';

const authPanels = Array.from(document.querySelectorAll("[data-auth-panel]"));
const authEmailFields = Array.from(document.querySelectorAll("[data-auth-email]"));
const authSendButtons = Array.from(document.querySelectorAll("[data-auth-send]"));
const authStatusLabels = Array.from(document.querySelectorAll("[data-auth-status]"));
const settingsSection = document.querySelector('[data-section="settings"]');
const lockedContent = document.getElementById("lockedContent");
const gate = document.getElementById("passphraseGate");
const gatePassphraseInput = document.getElementById("gatePassphrase");
const gateUnlockBtn = document.getElementById("gateUnlockBtn");
const gateInitializeBtn = document.getElementById("gateInitializeBtn");
const gateGenerateBtn = document.getElementById("gateGenerateBtn");
const gateTrustedDevice = document.getElementById("gateTrustedDevice");
const openSettingsBtn = document.getElementById("openSettingsBtn");
const settingsFields = document.getElementById("settingsFields");
const settingsDisplayName = document.getElementById("settingsDisplayName");
const settingsApiKey = document.getElementById("settingsApiKey");
const settingsMetadata = document.getElementById("settingsMetadata");
const settingsNewPassphrase = document.getElementById("settingsNewPassphrase");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const rotatePassphraseBtn = document.getElementById("rotatePassphraseBtn");
const resetAccountBtn = document.getElementById("resetAccountBtn");
const settingsStatus = document.getElementById("settingsStatus");
const generateQuizBtn = document.getElementById("generateQuizBtn");
const quizLessonContext = document.getElementById("quizLessonContext");
const quizStatus = document.getElementById("quizStatus");
const quizList = document.getElementById("quizList");
const quizDetails = document.getElementById("quizDetails");
const quizLessonFilter = document.getElementById("quizLessonFilter");
const notesList = document.getElementById("notesList");
const notesEmptyState = document.getElementById("notesEmptyState");
const sidebarOverlay = document.getElementById("sidebarOverlay");
const mobileSidebarToggle = document.getElementById("mobileSidebarToggle");
const sidebarToggleButton = document.getElementById("sidebarToggle");
const mobileBreakpoint = window.matchMedia("(max-width: 1024px)");

const navLinks = {
  home: document.getElementById("homeLink"),
  lessons: document.getElementById("lessonsLink"),
  quizzes: document.getElementById("quizzesLink"),
  notes: document.getElementById("notesLink"),
  settings: document.getElementById("openSettingsBtn")
};

const sectionRegistry = {
  home: document.querySelectorAll('[data-section="home"]'),
  lessons: document.querySelectorAll('[data-section="lessons"]'),
  quizzes: document.querySelectorAll('[data-section="quizzes"]'),
  notes: document.querySelectorAll('[data-section="notes"]'),
  settings: document.querySelectorAll('[data-section="settings"]')
};

let lessonProgress = { lessons: {}, notes: {} };
const DATA_MIGRATION_VERSION = 1;
let profileVersionInfo = buildVersionInfo("bootstrap-profile");
let progressVersionInfo = buildVersionInfo("bootstrap-progress");
let quizVersionInfo = buildVersionInfo("bootstrap-quizzes");
let vaultDoc = null;
let derivedVaultKey = null;
let derivedVaultSalt = null;
let encryptedLessonProgressPayload = null;
let pendingEncryptedProgressPayload = null;
let encryptedQuizPayload = null;
let pendingEncryptedQuizPayload = null;
let decryptedUserPayload = null;
let quizStore = getDefaultQuizStore();
let activeQuizId = null;
const noteModeCache = {};
const quizAttempts = {};
let pendingEmailLinkMode = isSignInWithEmailLink(auth, window.location.href);

function getEmailFromQuerystring() {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get("email")?.trim() || "";
  } catch (e) {
    console.warn("Unable to parse email from link", e);
    return "";
  }
}

function stripEmailLinkParams() {
  const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash || ""}`;
  window.history.replaceState({}, document.title, cleanUrl);
}

function setAuthStatus(message, type = "info") {
  authStatusLabels.forEach(label => {
    if (!label) return;
    label.textContent = message;
    label.classList.remove("info", "error", "success");
    label.classList.add(type);
  });
}

async function completeEmailLinkSignIn(email) {
  const trimmedEmail = (email || "").trim();
  if (!trimmedEmail) {
    setAuthStatus("Enter your email to finish signing in.", "error");
    authEmailFields[0]?.focus();
    return;
  }

  try {
    setAuthStatus("Completing sign-in...", "info");
    await signInWithEmailLink(auth, trimmedEmail, window.location.href);
    localStorage.setItem("emailForSignIn", trimmedEmail);
    pendingEmailLinkMode = false;
    stripEmailLinkParams();
    setAuthStatus("Sign-in link verified. Finishing up...", "success");
  } catch (e) {
    console.error(e);
    setAuthStatus("Unable to complete sign-in. Check that the email matches the link.", "error");
  }
}

async function handleSendSignIn(button) {
  if (auth.currentUser) {
    await signOut(auth);
    return;
  }
  const targetInputId = button?.dataset?.emailField;
  const emailInput = targetInputId ? document.getElementById(targetInputId) : authEmailFields[0];
  const email = emailInput?.value?.trim();
  if (!email) {
    setAuthStatus("Please enter your email.", "error");
    return;
  }
  try {
    if (pendingEmailLinkMode) {
      await completeEmailLinkSignIn(email);
      return;
    }
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    localStorage.setItem("emailForSignIn", email);
    setAuthStatus("Sign-in link sent! Check your email.", "success");
  } catch (e) {
    console.error(e);
    setAuthStatus("Error sending link.", "error");
  }
}

authSendButtons.forEach(btn =>
  btn.addEventListener("click", () => {
    handleSendSignIn(btn);
  })
);

if (pendingEmailLinkMode) {
  const storedEmail = localStorage.getItem("emailForSignIn");
  const linkEmail = storedEmail || getEmailFromQuerystring();
  if (linkEmail) {
    completeEmailLinkSignIn(linkEmail);
  } else {
    setAuthStatus("Enter your email to finish signing in with this link.", "info");
    authSendButtons.forEach(btn => {
      if (!btn) return;
      btn.textContent = "Complete Sign-In";
    });
    const firstEmailField = authEmailFields[0];
    if (firstEmailField) {
      firstEmailField.focus();
    }
  }
}

onAuthStateChanged(auth, async user => {
  updateAuthUI(user);
  if (user) {
  } else {
    clearVaultState();
    currentCourseData = {};
    currentCoursePath = "";
    currentLessonSelection = null;
    setActiveSection("home");
    updateQuizContext();
    setQuizStatus("");
    renderNotesSummary();
  }

  await loadUserProgress(user);
  await loadVaultState(user);
  await loadUserQuizzes(user);
  await tryAutoUnlockFromTrustedCache();
  await refreshCourseStatuses();

  if (user && !derivedVaultKey) {
    showPassphraseGate();
  }

  if (currentCoursePath && currentCourseData.course) {
    showCourseContent(currentCourseData, currentCoursePath);
  } else if (user) {
    setActiveSection("home");
  }

  scheduleStickyHeightUpdate();
});

let allCourses = [];
let currentCourseData = {};
let currentCoursePath = "";
const defaultGuidePath = "lessons/0000_HowToUseThisSite.yaml";
let isSidebarCollapsed = false;
let isSidebarOpen = false;
let currentSection = "home";
let currentLessonSelection = null;
let noteFocusTarget = null;

function updateStickyHeights() {
  const root = document.documentElement;
  const header = document.querySelector("header");
  const nav = document.querySelector(".primary-nav");
  const headerHeight = header?.offsetHeight || 0;
  const navHeight = nav?.offsetHeight || 0;
  const navContribution = isMobileViewport() ? 0 : navHeight;
  const stackHeight = headerHeight + navContribution;
  root.style.setProperty("--nav-height", `${navHeight}px`);
  root.style.setProperty("--nav-offset", `${navContribution}px`);
  root.style.setProperty("--header-height", `${headerHeight}px`);
  root.style.setProperty("--header-stack-height", `${stackHeight}px`);
  root.style.setProperty("--sticky-offset", `${stackHeight}px`);
}

function scheduleStickyHeightUpdate() {
  requestAnimationFrame(updateStickyHeights);
}

function isMobileViewport() {
  return mobileBreakpoint.matches;
}

function setMobileSidebarOpen(open) {
  const sidebar = document.getElementById("lessonSidebar");
  isSidebarOpen = open;
  sidebar?.classList.toggle("mobile-open", open);
  sidebarOverlay?.classList.toggle("active", open);
  document.body?.classList.toggle("sidebar-locked", open);
  mobileSidebarToggle?.setAttribute("aria-expanded", open ? "true" : "false");
  if (!open && sidebar) {
    sidebar.scrollTop = 0;
  }
}

function resetSidebarForViewport() {
  updateStickyHeights();
  const sidebar = document.getElementById("lessonSidebar");
  const layout = document.getElementById("lessonLayout");
  if (!sidebar || !layout) return;
  if (isMobileViewport()) {
    isSidebarCollapsed = false;
    layout.classList.remove("collapsed");
    sidebar.classList.remove("collapsed");
    setMobileSidebarOpen(false);
    return;
  }
  setMobileSidebarOpen(false);
  isSidebarCollapsed = false;
  sidebar.classList.remove("mobile-open");
  layout.classList.remove("collapsed");
}

function setDerivedVaultKeyContext(key, saltBytes) {
  derivedVaultKey = key;
  if (saltBytes) {
    derivedVaultSalt = saltBytes;
  }
}

function getActiveSaltBytes(payload) {
  if (payload && payload.salt) return decodeSalt(payload.salt);
  if (derivedVaultSalt) return derivedVaultSalt;
  if (vaultDoc && vaultDoc.salt) return decodeSalt(vaultDoc.salt);
  return null;
}

function saltsMatch(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function setSettingsStatus(message, type = "info") {
  if (!settingsStatus) return;
  settingsStatus.textContent = message;
  settingsStatus.classList.remove("info", "error", "success");
  settingsStatus.classList.add(type);
}

function setQuizStatus(message, type = "info") {
  if (!quizStatus) return;
  quizStatus.textContent = message;
  quizStatus.classList.remove("info", "error", "success");
  quizStatus.classList.add(type);
}

function updateAuthUI(user) {
  const isSignedIn = !!user;
  const isPendingCompletion = pendingEmailLinkMode && !isSignedIn;
  setAuthStatus(
    isSignedIn && user?.email
      ? `Signed in as: ${user.email}`
      : isPendingCompletion
        ? "Enter your email to finish signing in with this link."
        : "Not signed in",
    isSignedIn ? "success" : "info"
  );
  authSendButtons.forEach(btn => {
    if (!btn) return;
    btn.textContent = isSignedIn ? "Sign Out" : isPendingCompletion ? "Complete Sign-In" : "Send Sign-In Link";
  });
  authEmailFields.forEach(input => {
    if (!input) return;
    input.style.display = isSignedIn ? "none" : "inline-block";
    if (!isSignedIn) input.value = "";
  });
  authPanels.forEach(panel => {
    if (!panel) return;
    panel.style.display = isSignedIn ? "none" : "";
  });
  scheduleStickyHeightUpdate();
}

function updateSettingsSectionState() {
  if (!settingsFields || !settingsStatus) return;
  if (!auth.currentUser) {
    resetSettingsForm();
    return;
  }
  if (derivedVaultKey) {
    settingsFields.style.display = "";
    populateSettingsFields();
    setSettingsStatus("Settings unlocked for this session.", "success");
  } else {
    settingsFields.style.display = "none";
    setSettingsStatus(
      "Unlock with your passphrase to edit settings. You can still reset your account below.",
      "info"
    );
  }
}

function setActiveSection(target) {
  currentSection = target;
  Object.entries(sectionRegistry).forEach(([key, nodes]) => {
    nodes.forEach(node => {
      node.classList.toggle("section-hidden", key !== target);
    });
  });
  Object.entries(navLinks).forEach(([key, link]) => {
    if (link) link.classList.toggle("active", key === target);
  });
  if (target === "notes") renderNotesSummary();
}

function updateQuizContext(customMessage) {
  if (!quizLessonContext) return;
  if (customMessage) {
    quizLessonContext.textContent = customMessage;
    return;
  }
  if (currentLessonSelection && currentLessonSelection.title) {
    quizLessonContext.textContent = `Current lesson: ${currentLessonSelection.title}`;
  } else if (currentCourseData?.course) {
    quizLessonContext.textContent = "Select a lesson in the Lessons page to target your quiz.";
  } else {
    quizLessonContext.textContent = "Choose a course from Home to begin.";
  }
}

function showPassphraseGate() {
  if (gate) gate.style.display = "flex";
}

function hidePassphraseGate() {
  if (gate) gate.style.display = "none";
}

function openPassphraseGate(preferredAction = "unlock") {
  showPassphraseGate();
  if (gatePassphraseInput) gatePassphraseInput.focus();
  if (preferredAction === "initialize") {
    gateInitializeBtn?.focus();
  } else if (preferredAction === "unlock") {
    gateUnlockBtn?.focus();
  }
}

function buildVersionInfo(reason) {
  return {
    version: DATA_MIGRATION_VERSION,
    updatedAt: new Date().toISOString(),
    reason
  };
}

function normalizeVersionInfo(info, reason) {
  if (!info) return buildVersionInfo(reason);
  return {
    ...info,
    version: info.version || DATA_MIGRATION_VERSION,
    updatedAt: new Date().toISOString(),
    reason: info.reason || reason
  };
}

function readPassphraseInput() {
  return (gatePassphraseInput?.value || "").trim();
}

function attachVersionMetadata(raw, reason) {
  try {
    const parsed = JSON.parse(raw || "{}");
    const versionInfo = normalizeVersionInfo(parsed.versionInfo, reason);
    return JSON.stringify({ ...parsed, versionInfo });
  } catch (e) {
    return JSON.stringify({ value: raw || "", versionInfo: buildVersionInfo(reason) });
  }
}

function normalizeNoteEntry(raw, fallbackText = "") {
  const now = new Date().toISOString();
  if (!raw || typeof raw !== "object") {
    const text = typeof raw === "string" ? raw : fallbackText;
    return {
      id: `note-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      text,
      summary: buildNoteSummary(text),
      createdAt: now,
      updatedAt: now
    };
  }
  const text = raw.text || raw.summary || fallbackText || "";
  const createdAt = raw.createdAt || now;
  return {
    id: raw.id || `note-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text,
    summary: raw.summary || buildNoteSummary(text),
    createdAt,
    updatedAt: raw.updatedAt || createdAt
  };
}

function normalizeNoteList(value) {
  if (Array.isArray(value)) return value.map(v => normalizeNoteEntry(v)).filter(n => n.text || n.summary);
  if (typeof value === "string") return [normalizeNoteEntry({ text: value })];
  if (value && typeof value === "object") return [normalizeNoteEntry(value)];
  return [];
}

function normalizeLessonNotes(rawNotes) {
  const normalized = {};
  Object.entries(rawNotes || {}).forEach(([coursePath, lessonMap]) => {
    const lessons = {};
    Object.entries(lessonMap || {}).forEach(([lessonTitle, noteValue]) => {
      const entries = normalizeNoteList(noteValue);
      if (entries.length) lessons[lessonTitle] = entries;
    });
    if (Object.keys(lessons).length) normalized[coursePath] = lessons;
  });
  return normalized;
}

function parseLessonProgressText(txt) {
  try {
    const parsed = JSON.parse(txt || "{}");
    progressVersionInfo = normalizeVersionInfo(parsed.versionInfo, "lesson-progress-import");
    const lessons = parsed?.lessons || {};
    const notes = normalizeLessonNotes(parsed?.notes || {});
    return { lessons, notes };
  } catch (e) {
    progressVersionInfo = buildVersionInfo("lesson-progress-legacy");
    return { lessons: {}, notes: {} };
  }
}

function getDefaultQuizStore() {
  const normalized = normalizeVersionInfo(quizVersionInfo, "quizzes-default");
  quizVersionInfo = normalized;
  return { quizzes: [], versionInfo: normalized };
}

function parseQuizPayload(txt) {
  try {
    const parsed = JSON.parse(txt || "{}");
    quizVersionInfo = normalizeVersionInfo(parsed.versionInfo, "quizzes-import");
    return { quizzes: parsed.quizzes || [], versionInfo: quizVersionInfo };
  } catch (e) {
    const fallback = buildVersionInfo("quizzes-legacy");
    quizVersionInfo = fallback;
    return { quizzes: [], versionInfo: fallback };
  }
}

function serializeQuizPayload() {
  const normalized = normalizeVersionInfo(quizVersionInfo, "quizzes-save");
  quizVersionInfo = normalized;
  const quizzes = Array.isArray(quizStore?.quizzes) ? quizStore.quizzes : [];
  return JSON.stringify({ quizzes, versionInfo: normalized });
}

function formatQuizTimestamp(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts || "";
  return d.toLocaleString();
}

function serializeLessonProgress() {
  const normalized = normalizeVersionInfo(progressVersionInfo, "lesson-progress-save");
  progressVersionInfo = normalized;
  const normalizedNotes = normalizeLessonNotes(lessonProgress.notes || {});
  lessonProgress.notes = normalizedNotes;
  return JSON.stringify({
    lessons: lessonProgress.lessons || {},
    notes: normalizedNotes,
    versionInfo: normalized
  });
}

async function decryptLessonProgressPayload(payload, key) {
  const decryptedText = await decryptSecret(payload, key);
  lessonProgress = parseLessonProgressText(decryptedText);
  encryptedLessonProgressPayload = payload;
  pendingEncryptedProgressPayload = null;
  await refreshCourseStatuses();
  renderNotesSummary();
  if (currentCoursePath && currentCourseData.course) {
    showCourseContent(currentCourseData, currentCoursePath);
  }
}

async function tryDecryptPendingProgress() {
  if (pendingEncryptedProgressPayload) {
    try {
      const { key } = await ensureProgressKey(pendingEncryptedProgressPayload);
      await decryptLessonProgressPayload(pendingEncryptedProgressPayload, key);
    } catch (err) {
      console.error("Error decrypting lesson progress:", err);
    }
  }
}

async function ensureProgressKey(payload) {
  const saltBytes = getActiveSaltBytes(payload);
  if (derivedVaultKey && derivedVaultSalt && saltBytes && saltsMatch(derivedVaultSalt, saltBytes)) {
    setDerivedVaultKeyContext(derivedVaultKey, saltBytes);
    return { key: derivedVaultKey, saltBytes };
  }
  if (!saltBytes) throw new Error("Missing salt for encrypted progress.");
  throw new Error("Missing passphrase for encrypted progress.");
}

async function ensureQuizKey(payload) {
  const saltBytes = getActiveSaltBytes(payload);
  if (derivedVaultKey && (!saltBytes || (derivedVaultSalt && saltBytes && saltsMatch(derivedVaultSalt, saltBytes)))) {
    setDerivedVaultKeyContext(derivedVaultKey, saltBytes || derivedVaultSalt);
    return { key: derivedVaultKey, saltBytes: saltBytes || derivedVaultSalt };
  }
  if (!saltBytes) throw new Error("Missing salt for encrypted quiz data.");
  throw new Error("Missing passphrase for encrypted quiz data.");
}

async function decryptQuizPayload(payload, key) {
  const decryptedText = await decryptSecret(payload, key);
  quizStore = parseQuizPayload(decryptedText);
  encryptedQuizPayload = payload;
  pendingEncryptedQuizPayload = null;
  renderQuizList();
}

async function tryDecryptPendingQuizzes() {
  if (pendingEncryptedQuizPayload) {
    try {
      const { key } = await ensureQuizKey(pendingEncryptedQuizPayload);
      await decryptQuizPayload(pendingEncryptedQuizPayload, key);
      setQuizStatus("Quizzes unlocked for this session.", "success");
    } catch (err) {
      console.error("Error decrypting quizzes:", err);
    }
  }
}

async function tryDecryptAllPending() {
  await tryDecryptPendingProgress();
  await tryDecryptPendingQuizzes();
}

async function loadUserProgress(user) {
  try {
    lessonProgress = { lessons: {}, notes: {} };
    encryptedLessonProgressPayload = null;
    pendingEncryptedProgressPayload = null;
    if (!user) {
      renderNotesSummary();
      return;
    }
    const snap = await getDoc(doc(db, "lessonProgress", user.uid));
    if (!snap.exists()) {
      renderNotesSummary();
      return;
    }
    const data = snap.data();
    if (data && data.ciphertext) {
      encryptedLessonProgressPayload = data;
      if (derivedVaultKey) {
        const { key } = await ensureProgressKey(data);
        await decryptLessonProgressPayload(data, key);
      } else {
        pendingEncryptedProgressPayload = data;
        renderNotesSummary();
      }
    } else if (data && (data.lessons || data.notes)) {
      progressVersionInfo = normalizeVersionInfo(data.versionInfo, "lesson-progress-plaintext");
      lessonProgress = {
        lessons: data.lessons || {},
        notes: data.notes || {}
      };
      renderNotesSummary();
    }
  } catch (e) {
    console.error("Error loading progress:", e);
    lessonProgress = { lessons: {}, notes: {} };
    renderNotesSummary();
  }
}

async function loadUserQuizzes(user) {
  try {
    resetQuizState();
    if (!user) {
      setQuizStatus("Sign in to generate and view quizzes.", "info");
      return;
    }
    const snap = await getDoc(doc(db, "quizzes", user.uid));
    if (!snap.exists()) {
      setQuizStatus("No saved quizzes yet. Generate one from a lesson to get started.", "info");
      return;
    }
    const data = snap.data();
    if (data && data.ciphertext) {
      encryptedQuizPayload = data;
      if (derivedVaultKey) {
        const { key } = await ensureQuizKey(data);
        await decryptQuizPayload(data, key);
        setQuizStatus("Loaded quizzes from your vault.", "success");
      } else {
        pendingEncryptedQuizPayload = data;
        setQuizStatus("Unlock with your passphrase to view saved quizzes.", "info");
      }
    } else if (data && data.quizzes) {
      quizVersionInfo = normalizeVersionInfo(data.versionInfo, "quizzes-plaintext");
      quizStore = { ...getDefaultQuizStore(), ...data, versionInfo: quizVersionInfo };
      renderQuizList();
      setQuizStatus("Imported quizzes from a legacy format.", "success");
    }
  } catch (e) {
    console.error("Error loading quizzes:", e);
    resetQuizState();
    setQuizStatus("Could not load quizzes. Try unlocking your vault again.", "error");
  }
}

async function persistUserProgress() {
  const user = auth.currentUser;
  if (!user) return false;
  if (!vaultDoc && !encryptedLessonProgressPayload && !derivedVaultKey) {
    alert("Set up and unlock your vault before saving lesson progress.");
    return false;
  }
  try {
    const { key, saltBytes } = await ensureProgressKey(encryptedLessonProgressPayload || vaultDoc);
    const encrypted = await encryptSecret(serializeLessonProgress(), key, saltBytes);
    await setDoc(doc(db, "lessonProgress", user.uid), encrypted);
    encryptedLessonProgressPayload = encrypted;
    pendingEncryptedProgressPayload = null;
    return true;
  } catch (e) {
    if (e && e.message && e.message.includes("Missing passphrase")) {
      showPassphraseGate();
      alert("Unlock your vault with your master passphrase to sync progress.");
      return false;
    }
    console.error("Error saving progress:", e);
    throw e;
  }
}

async function persistQuizStore() {
  const user = auth.currentUser;
  if (!user) return false;
  if (!vaultDoc && !encryptedQuizPayload && !derivedVaultKey) {
    setQuizStatus("Set up and unlock your vault before saving quizzes.", "error");
    return false;
  }
  try {
    const { key, saltBytes } = await ensureQuizKey(encryptedQuizPayload || vaultDoc);
    const encrypted = await encryptSecret(serializeQuizPayload(), key, saltBytes);
    await setDoc(doc(db, "quizzes", user.uid), encrypted);
    encryptedQuizPayload = encrypted;
    pendingEncryptedQuizPayload = null;
    return true;
  } catch (e) {
    if (e && e.message && e.message.includes("Missing passphrase")) {
      showPassphraseGate();
      setQuizStatus("Unlock with your passphrase to save quizzes.", "error");
      return false;
    }
    console.error("Error saving quizzes:", e);
    setQuizStatus("Could not save quizzes. Try again after unlocking your vault.", "error");
    throw e;
  }
}

function isLessonChecked(p, t) {
  const lessons = lessonProgress?.lessons || {};
  return !!(lessons[p] && lessons[p][t]);
}

function toggleLessonChecked(p, t, v) {
  if (!lessonProgress.lessons) lessonProgress.lessons = {};
  if (!lessonProgress.lessons[p]) lessonProgress.lessons[p] = {};
  lessonProgress.lessons[p][t] = v;
}

function buildNoteSummary(text = "") {
  const trimmed = (text || "").trim();
  if (trimmed.length <= 240) return trimmed;
  return trimmed.slice(0, 237) + "...";
}

function sanitizeHtml(html) {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(html || "", "text/html");
  parsed.querySelectorAll("script, style").forEach(node => node.remove());
  parsed.querySelectorAll("*").forEach(node => {
    Array.from(node.attributes).forEach(attr => {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || name === "data" || name === "srcset") {
        node.removeAttribute(attr.name);
        return;
      }
      if ((name === "href" || name === "src" || name === "xlink:href") && /^(javascript:|data:)/i.test(attr.value)) {
        node.removeAttribute(attr.name);
      }
    });
  });
  return parsed.body.innerHTML;
}

function getNoteModeKey(coursePath, lessonTitle, noteId = "") {
  return `${coursePath || ""}::${lessonTitle || ""}::${noteId || "draft"}`;
}

function getNoteMode(coursePath, lessonTitle, noteId = "") {
  return noteModeCache[getNoteModeKey(coursePath, lessonTitle, noteId)] || "edit";
}

function setNoteMode(coursePath, lessonTitle, noteId = "", mode = "edit") {
  noteModeCache[getNoteModeKey(coursePath, lessonTitle, noteId)] = mode;
}

function getLessonNoteEntries(p, t) {
  if (!lessonProgress.notes) lessonProgress.notes = {};
  if (!lessonProgress.notes[p]) lessonProgress.notes[p] = {};
  const entries = normalizeNoteList(lessonProgress.notes[p][t]);
  lessonProgress.notes[p][t] = entries;
  return entries;
}

function upsertLessonNote(p, t, val, noteId = "") {
  if (!lessonProgress.notes) lessonProgress.notes = {};
  if (!lessonProgress.notes[p]) lessonProgress.notes[p] = {};
  const entries = getLessonNoteEntries(p, t);
  const now = new Date().toISOString();
  if (noteId) {
    const idx = entries.findIndex(n => n.id === noteId);
    if (idx >= 0) {
      entries[idx] = {
        ...entries[idx],
        text: val,
        summary: buildNoteSummary(val),
        updatedAt: now
      };
      lessonProgress.notes[p][t] = entries;
      return entries[idx];
    }
  }
  const entry = normalizeNoteEntry({
    id: noteId || `note-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text: val,
    summary: buildNoteSummary(val),
    createdAt: now,
    updatedAt: now
  });
  entries.push(entry);
  lessonProgress.notes[p][t] = entries;
  return entry;
}

function getLatestLessonNote(p, t) {
  const entries = getLessonNoteEntries(p, t);
  if (!entries.length) return null;
  return entries[entries.length - 1];
}

function getLessonIcon(t) {
  if (t === "reading") return '<i class="fas fa-book"></i>';
  if (t === "quiz") return '<i class="fas fa-question-circle"></i>';
  if (t === "video") return '<i class="fas fa-video"></i>';
  return '<i class="fas fa-file-alt"></i>';
}

function renderNotesSummary() {
  if (!notesList || !notesEmptyState) return;
  notesList.innerHTML = "";
  const canRead = !!derivedVaultKey;
  const entries = [];
  if (canRead) {
    Object.entries(lessonProgress?.notes || {}).forEach(([path, lessonMap]) => {
      Object.entries(lessonMap || {}).forEach(([lessonTitle, notes]) => {
        normalizeNoteList(notes).forEach(note => {
          if (note && (note.text || note.summary)) {
            entries.push({
              coursePath: path,
              lessonTitle,
              ...note
            });
          }
        });
      });
    });
  }
  if (!canRead) {
    notesEmptyState.textContent = "Unlock with your master passphrase to view saved notes.";
    return;
  }
  if (!entries.length) {
    notesEmptyState.textContent = "No saved notes yet. Open a lesson and add notes to see them here.";
    return;
  }
  notesEmptyState.textContent = "";
  entries
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
    .forEach(entry => {
    const card = document.createElement("div");
    card.className = "notes-card";
    const h = document.createElement("h4");
    h.textContent = entry.lessonTitle;
    const meta = document.createElement("p");
    meta.className = "settings-note";
    const updated = entry.updatedAt || entry.createdAt || "";
    const updatedDisplay = updated ? new Date(updated).toLocaleString() : "";
    meta.textContent = `Course file: ${entry.coursePath}${updatedDisplay ? " • Updated " + updatedDisplay : ""}`;
    const body = document.createElement("div");
    body.className = "notes-card-body";
    const noteContent = entry.text || entry.summary || "";
    const previewHtml = noteContent.trim()
      ? sanitizeHtml(marked.parse(noteContent))
      : '<p class="note-empty">No note content saved yet.</p>';
    body.innerHTML = previewHtml;
    const actions = document.createElement("div");
    actions.className = "note-actions-inline";
    const viewBtn = document.createElement("button");
    viewBtn.textContent = "View lesson";
    viewBtn.addEventListener("click", () => {
      noteFocusTarget = { coursePath: entry.coursePath, lessonTitle: entry.lessonTitle, noteId: entry.id };
      handleViewLessons(entry.coursePath);
    });
    actions.appendChild(viewBtn);
    card.appendChild(h);
    card.appendChild(meta);
    card.appendChild(body);
    card.appendChild(actions);
    notesList.appendChild(card);
    });
}

function resetQuizState() {
  quizStore = getDefaultQuizStore();
  encryptedQuizPayload = null;
  pendingEncryptedQuizPayload = null;
  activeQuizId = null;
  renderQuizList();
}

function getQuestionOptions(question = {}) {
  if (Array.isArray(question.options) && question.options.length) return question.options;
  if (Array.isArray(question.choices) && question.choices.length) return question.choices;
  return null;
}

function normalizeQuestionType(question = {}) {
  const raw = (question.type || question.kind || "").toString().toLowerCase();
  if (raw.includes("choice") || raw === "mcq") return "multiple_choice";
  if (raw.includes("fill")) return "fill_in";
  if (getQuestionOptions(question)) return "multiple_choice";
  const promptText = (question.prompt || question.question || "").toLowerCase();
  if (promptText.includes("___")) return "fill_in";
  return "free_response";
}

function getQuestionKey(question, idx) {
  return question.id || question.questionId || question.key || `q-${idx + 1}`;
}

function getQuizAttempt(quizId) {
  if (!quizId) {
    return { responses: {}, feedback: null, status: "", error: null, submitting: false };
  }
  if (!quizAttempts[quizId]) {
    quizAttempts[quizId] = {
      responses: {},
      feedback: null,
      status: "",
      error: null,
      submitting: false
    };
  }
  return quizAttempts[quizId];
}

function findQuestionFeedback(feedback, key, idx) {
  if (!feedback) return null;
  const perQuestion = Array.isArray(feedback.perQuestion) ? feedback.perQuestion : [];
  return perQuestion.find(item => {
    const itemKey = item.question_id || item.id || item.key || item.questionKey;
    const index = typeof item.index === "number" ? item.index : null;
    return (itemKey && itemKey === key) || (index !== null && index === idx);
  }) || null;
}

function buildQuestionResponseControl(question, idx, attempt) {
  const type = normalizeQuestionType(question);
  const key = getQuestionKey(question, idx);
  const wrapper = document.createElement("div");
  wrapper.className = "quiz-response-control";
  if (type === "multiple_choice") {
    const options = getQuestionOptions(question);
    if (options && options.length) {
      const optionList = document.createElement("div");
      optionList.className = "quiz-options";
      options.forEach((opt, optIdx) => {
        const option = document.createElement("div");
        option.className = "quiz-option";
        const id = `${key}-${optIdx}`;
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = `${key}-choice`;
        radio.id = id;
        radio.value = opt;
        radio.checked = attempt.responses[key] === opt;
        radio.addEventListener("change", () => {
          attempt.responses[key] = opt;
        });
        const label = document.createElement("label");
        label.htmlFor = id;
        label.textContent = opt;
        option.appendChild(radio);
        option.appendChild(label);
        optionList.appendChild(option);
      });
      wrapper.appendChild(optionList);
      return wrapper;
    }
  }
  if (type === "fill_in") {
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Type your answer";
    input.value = attempt.responses[key] || "";
    input.addEventListener("input", e => {
      attempt.responses[key] = e.target.value;
    });
    wrapper.appendChild(input);
    return wrapper;
  }
  const textarea = document.createElement("textarea");
  textarea.rows = 3;
  textarea.placeholder = "Share your response";
  textarea.value = attempt.responses[key] || "";
  textarea.addEventListener("input", e => {
    attempt.responses[key] = e.target.value;
  });
  wrapper.appendChild(textarea);
  return wrapper;
}

function renderQuizDetails(quiz) {
  if (!quizDetails) return;
  if (!derivedVaultKey) {
    quizDetails.innerHTML = "<p class='settings-note'>Unlock with your master passphrase to view saved quizzes.</p>";
    return;
  }
  if (!quiz) {
    quizDetails.innerHTML = "<p class='settings-note'>Select a saved quiz to see its details.</p>";
    return;
  }
  const metadata = quiz.metadata || {};
  const title = metadata.lessonTitle || quiz.lessonTitle || "Lesson quiz";
  const courseTitle = metadata.courseTitle || metadata.coursePath || quiz.courseTitle || "";
  const created = metadata.createdAt || metadata.generatedAt || quiz.createdAt;
  const status = quiz.status || metadata.status || "saved";
  const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
  const attempt = getQuizAttempt(quiz.id);
  quizDetails.innerHTML = "";
  const detailActions = document.createElement("div");
  detailActions.className = "quiz-detail-actions";
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "quiz-delete";
  deleteBtn.type = "button";
  deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete quiz';
  deleteBtn.addEventListener("click", () => deleteQuiz(quiz.id));
  detailActions.appendChild(deleteBtn);
  const h = document.createElement("h4");
  h.textContent = title;
  const meta = document.createElement("div");
  meta.className = "quiz-meta";
  const statusPill = document.createElement("span");
  statusPill.className = "quiz-status-pill";
  statusPill.innerHTML = '<i class="fas fa-check-circle"></i>' + status;
  const time = document.createElement("span");
  time.textContent = `Saved: ${formatQuizTimestamp(created)}`;
  const lesson = document.createElement("span");
  lesson.textContent = courseTitle ? `Course: ${courseTitle}` : "";
  const count = document.createElement("span");
  count.textContent = `Questions: ${questions.length}`;
  meta.appendChild(statusPill);
  meta.appendChild(time);
  if (courseTitle) meta.appendChild(lesson);
  meta.appendChild(count);

  const gradingSummary = document.createElement("div");
  gradingSummary.className = "quiz-grade-summary";
  const feedback = attempt.feedback;
  if (feedback?.overallScore !== undefined && feedback?.overallScore !== null) {
    const score = document.createElement("div");
    score.className = "quiz-grade-score";
    score.textContent = `${Math.round(feedback.overallScore)} / 100`;
    const summary = document.createElement("p");
    summary.textContent = feedback.summary || "Grading complete.";
    gradingSummary.appendChild(score);
    gradingSummary.appendChild(summary);
  } else {
    const helper = document.createElement("p");
    helper.className = "settings-note";
    helper.textContent = "Answer each prompt and submit to get AI-generated feedback.";
    gradingSummary.appendChild(helper);
  }
  const list = document.createElement("ol");
  list.className = "quiz-question-list";
  if (!questions.length) {
    const li = document.createElement("li");
    li.textContent = "No questions were captured for this quiz.";
    list.appendChild(li);
  } else {
    questions.forEach((q, idx) => {
      const li = document.createElement("li");
      li.className = "quiz-question-card";
      const header = document.createElement("div");
      header.className = "quiz-question-header";
      const prompt = document.createElement("div");
      prompt.textContent = q.prompt || q.question || "Review this lesson.";
      const typeBadge = document.createElement("span");
      typeBadge.className = "quiz-question-type";
      typeBadge.textContent = normalizeQuestionType(q).replace(/_/g, " ");
      header.appendChild(prompt);
      header.appendChild(typeBadge);
      li.appendChild(header);
      if (q.detail) {
        const detail = document.createElement("div");
        detail.className = "settings-note";
        detail.textContent = q.detail;
        li.appendChild(detail);
      }
      const responseControl = buildQuestionResponseControl(q, idx, attempt);
      li.appendChild(responseControl);
      const questionFeedback = findQuestionFeedback(feedback, getQuestionKey(q, idx), idx);
      if (questionFeedback) {
        const fb = document.createElement("div");
        fb.className = "quiz-question-feedback";
        const label = document.createElement("strong");
        const isCorrect = questionFeedback.correct === true || questionFeedback.isCorrect === true;
        label.textContent = isCorrect ? "Looks good" : "Needs work";
        const copy = document.createElement("p");
        copy.textContent = questionFeedback.feedback || questionFeedback.comment || "";
        fb.appendChild(label);
        fb.appendChild(copy);
        li.appendChild(fb);
      }
      list.appendChild(li);
    });
  }
  const responseActions = document.createElement("div");
  responseActions.className = "quiz-response-actions";
  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.textContent = attempt.submitting ? "Submitting..." : "Submit responses";
  submitBtn.disabled = attempt.submitting || !questions.length;
  submitBtn.addEventListener("click", () => submitQuizForGrading(quiz));
  responseActions.appendChild(submitBtn);
  const statusNote = document.createElement("p");
  const statusClass = attempt.error ? "error" : feedback ? "success" : "info";
  statusNote.className = `settings-status ${statusClass}`;
  statusNote.textContent = attempt.error
    ? attempt.error
    : attempt.status || "Responses are kept locally and not saved to your vault.";
  responseActions.appendChild(statusNote);
  quizDetails.appendChild(h);
  quizDetails.appendChild(meta);
  quizDetails.appendChild(gradingSummary);
  quizDetails.appendChild(list);
  quizDetails.appendChild(responseActions);
  quizDetails.appendChild(detailActions);
}

function renderQuizList() {
  if (!quizList || !quizDetails) return;
  quizList.innerHTML = "";
  const canRead = !!derivedVaultKey;
  const filterValue = (quizLessonFilter?.value || "").toLowerCase().trim();
  if (!canRead) {
    quizList.innerHTML = "<p class='settings-note'>Unlock with your master passphrase to view saved quizzes.</p>";
    renderQuizDetails(null);
    return;
  }
  const entries = Array.isArray(quizStore?.quizzes) ? [...quizStore.quizzes] : [];
  const sorted = entries.sort((a, b) => {
    const aDate = new Date(a?.metadata?.createdAt || a?.createdAt || 0).getTime();
    const bDate = new Date(b?.metadata?.createdAt || b?.createdAt || 0).getTime();
    return bDate - aDate;
  });
  const filtered = sorted.filter(q => {
    if (!filterValue) return true;
    const lessonName = (q?.metadata?.lessonTitle || q?.lessonTitle || "").toLowerCase();
    return lessonName.includes(filterValue);
  });
  if (!filtered.length) {
    const emptyCopy = entries.length
      ? "No saved quizzes match this lesson filter yet."
      : "No saved quizzes yet. Generate one from a lesson to see it here.";
    quizList.innerHTML = `<p class='settings-note'>${emptyCopy}</p>`;
    activeQuizId = null;
    renderQuizDetails(null);
    return;
  }
  if (!activeQuizId || !filtered.some(q => q.id === activeQuizId)) {
    activeQuizId = filtered[0].id;
  }
  filtered.forEach(q => {
    const btn = document.createElement("button");
    btn.className = "quiz-card" + (q.id === activeQuizId ? " active" : "");
    const title = q?.metadata?.lessonTitle || q.lessonTitle || "Lesson quiz";
    const created = q?.metadata?.createdAt || q.createdAt;
    const status = q.status || q?.metadata?.status || "saved";
    btn.innerHTML =
      `<div class="quiz-card__header">` +
      `<h4>${title}</h4>` +
      `<button class="quiz-delete" aria-label="Delete quiz"><i class="fas fa-trash"></i></button>` +
      `</div>` +
      `<div class="quiz-meta"><span class="quiz-status-pill">${status}</span><span>${formatQuizTimestamp(created)}</span></div>`;
    const deleteBtn = btn.querySelector(".quiz-delete");
    deleteBtn?.addEventListener("click", evt => {
      evt.stopPropagation();
      deleteQuiz(q.id);
    });
    btn.addEventListener("click", () => {
      activeQuizId = q.id;
      renderQuizList();
    });
    quizList.appendChild(btn);
  });
  const activeQuiz = filtered.find(q => q.id === activeQuizId) || null;
  renderQuizDetails(activeQuiz);
}

async function submitQuizForGrading(quiz) {
  if (!quiz) return;
  const apiKey = (decryptedUserPayload || {}).apiKey;
  const attempt = getQuizAttempt(quiz.id);
  if (!apiKey) {
    attempt.error = "Add your OpenAI API key in Settings to submit for grading.";
    attempt.status = "";
    renderQuizDetails(quiz);
    return;
  }
  attempt.submitting = true;
  attempt.error = null;
  attempt.status = "Submitting responses for grading...";
  renderQuizDetails(quiz);
  try {
    const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
    const metadata = quiz.metadata || {};
    const payload = {
      quizId: quiz.id,
      metadata: {
        ...metadata,
        lessonTitle: metadata.lessonTitle || quiz.lessonTitle,
        courseTitle: metadata.courseTitle || quiz.courseTitle
      },
      questions: questions.map((q, idx) => {
        const key = getQuestionKey(q, idx);
        return {
          id: key,
          prompt: q.prompt || q.question || `Question ${idx + 1}`,
          detail: q.detail,
          type: normalizeQuestionType(q),
          options: getQuestionOptions(q),
          response: attempt.responses[key] || ""
        };
      })
    };
    const gradingPrompt = [
      "You are a tutor grading a student's quiz responses.",
      "Return strict JSON with keys: overall_score (0-100), summary (string), per_question (array).",
      "Each per_question entry should include id, feedback, correct (boolean), and score (0-100).",
      "Base feedback only on the provided quiz metadata, prompts, and student responses.",
      "Keep remarks concise and actionable."
    ].join(" \n");
    const userContent = [
      "Quiz submission to grade (JSON):",
      JSON.stringify(payload, null, 2)
    ].join("\n");
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: gradingPrompt },
          { role: "user", content: userContent }
        ],
        response_format: { type: "json_object" }
      })
    });
    if (!resp.ok) {
      const detail = await resp.text();
      throw new Error(`OpenAI grading failed: ${resp.status} ${detail}`);
    }
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned an empty grading response.");
    let parsed = null;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      console.error("Could not parse grading JSON", content);
      throw new Error("OpenAI grading response was not valid JSON.");
    }
    const overallScore =
      typeof parsed.overall_score === "number"
        ? parsed.overall_score
        : typeof parsed.overallScore === "number"
        ? parsed.overallScore
        : null;
    const perQuestion = Array.isArray(parsed.per_question)
      ? parsed.per_question
      : Array.isArray(parsed.questions)
      ? parsed.questions
      : [];
    let computedScore = overallScore;
    if (computedScore === null) {
      const numericScores = perQuestion
        .map(item => (typeof item.score === "number" ? item.score : null))
        .filter(v => v !== null);
      if (numericScores.length) {
        const avg = numericScores.reduce((a, b) => a + b, 0) / numericScores.length;
        computedScore = Math.round(avg);
      }
    }
    attempt.feedback = {
      overallScore: computedScore,
      summary: parsed.summary || parsed.feedback || parsed.overview || "",
      perQuestion
    };
    attempt.status = "Received AI feedback.";
  } catch (err) {
    console.error("Quiz grading failed", err);
    attempt.error = err?.message || "Could not submit quiz for grading.";
    attempt.status = "";
  }
  attempt.submitting = false;
  renderQuizDetails(quiz);
}

function clearVaultState() {
  derivedVaultKey = null;
  derivedVaultSalt = null;
  vaultDoc = null;
  decryptedUserPayload = null;
  encryptedLessonProgressPayload = null;
  pendingEncryptedProgressPayload = null;
  resetQuizState();
  if (gatePassphraseInput) gatePassphraseInput.value = "";
  setVaultUIState("locked");
  hidePassphraseGate();
  clearTrustedDeviceCache();
}

async function handleTrustedDeviceSelection(key, saltBytes) {
  if (gateTrustedDevice?.checked) {
    await persistTrustedCache(key, saltBytes);
  } else {
    await clearTrustedDeviceCache();
  }
}

async function tryAutoUnlockFromTrustedCache() {
  try {
    if (!vaultDoc) return false;
    const cache = await getTrustedCache();
    if (!cache || !cache.key) return false;
    const activeSalt = getActiveSaltBytes(vaultDoc) || cache.vaultSaltBytes;
    if (!activeSalt) throw new Error("Missing vault salt for cached key.");
    setDerivedVaultKeyContext(cache.key, activeSalt);
    const decryptedText = await decryptSecret(vaultDoc, cache.key);
    decryptedUserPayload = parseUserPayload(decryptedText);
    await tryDecryptAllPending();
    setVaultUIState("unlocked");
    if (gateTrustedDevice) gateTrustedDevice.checked = true;
    hidePassphraseGate();
    return true;
  } catch (err) {
    console.error("Trusted device auto-unlock failed", err);
    await clearTrustedDeviceCache();
    return false;
  }
}

function getDefaultUserPayload() {
  const normalized = normalizeVersionInfo(profileVersionInfo, "profile-default");
  profileVersionInfo = normalized;
  return {
    secret: "",
    displayName: "",
    apiKey: "",
    metadata: "",
    versionInfo: normalized
  };
}

function parseUserPayload(text) {
  try {
    const parsed = JSON.parse(text);
    profileVersionInfo = normalizeVersionInfo(parsed.versionInfo, "profile-import");
    return {
      ...getDefaultUserPayload(),
      ...parsed,
      versionInfo: profileVersionInfo
    };
  } catch (e) {
    const fallback = buildVersionInfo("profile-legacy");
    profileVersionInfo = fallback;
    return {
      ...getDefaultUserPayload(),
      secret: text || "",
      versionInfo: fallback
    };
  }
}

function serializeUserPayload() {
  const payload = {
    ...getDefaultUserPayload(),
    ...(decryptedUserPayload || {})
  };
  const normalized = normalizeVersionInfo(payload.versionInfo, "profile-save");
  profileVersionInfo = normalized;
  payload.versionInfo = normalized;
  return JSON.stringify(payload);
}

async function persistEncryptedPayload(key, saltBytes) {
  const user = auth.currentUser;
  if (!user) return;
  setDerivedVaultKeyContext(key, saltBytes);
  const encrypted = await encryptSecret(serializeUserPayload(), key, saltBytes);
  await setDoc(doc(db, "userData", user.uid), encrypted);
  vaultDoc = encrypted;
}

async function logMigrationMetadata(user, details) {
  try {
    await setDoc(
      doc(db, "userMetadata", user.uid),
      {
        ...details,
        version: DATA_MIGRATION_VERSION,
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    );
  } catch (err) {
    console.error("Metadata log failed", err);
  }
}

function setVaultUIState(mode) {
  const hasUser = !!auth.currentUser;
  if (hasUser && mode !== "unlocked") {
    openPassphraseGate(mode === "setup" ? "initialize" : "unlock");
  }
  if (mode === "unlocked") {
    hidePassphraseGate();
  }
  updateSettingsSectionState();
}

async function loadVaultState(user) {
  try {
    if (!user) {
      clearVaultState();
      return;
    }
    const snap = await getDoc(doc(db, "userData", user.uid));
    if (snap.exists()) {
      vaultDoc = snap.data();
      setVaultUIState("locked");
    } else {
      vaultDoc = null;
      setVaultUIState("setup");
    }
  } catch (e) {
    console.error("Error loading vault:", e);
    setVaultUIState("setup");
  }
}

async function initializeVault() {
  try {
    const user = auth.currentUser;
    if (!user) return;
    const passphrase = readPassphraseInput();
    if (passphrase.length < 12) {
      alert("Please choose a longer passphrase (at least 12 characters).");
      return;
    }
    const { key, salt } = await deriveKeyFromPassphrase(passphrase);
    setDerivedVaultKeyContext(key, salt);
    decryptedUserPayload = { ...getDefaultUserPayload() };
    await persistEncryptedPayload(key, salt);
    await handleTrustedDeviceSelection(key, salt);
    await tryDecryptAllPending();
    setVaultUIState("unlocked");
    hidePassphraseGate();
    alert("Vault initialized. Remember to store your passphrase safely—there is no recovery option.");
  } catch (err) {
    console.error("Error initializing vault", err);
    alert("Could not initialize vault. Please try again.");
  }
}

async function loadEncryptedProfile(passphrase) {
  if (!vaultDoc) {
    throw new Error("No encrypted profile available.");
  }
  const saltBytes = vaultDoc?.salt ? decodeSalt(vaultDoc.salt) : null;
  if (!saltBytes) throw new Error("Missing vault salt. Reinitialize the vault.");
  const { key } = await deriveKeyFromPassphrase(passphrase, saltBytes);
  const decryptedText = await decryptSecret(vaultDoc, key);
  setDerivedVaultKeyContext(key, saltBytes);
  decryptedUserPayload = parseUserPayload(decryptedText);
  await tryDecryptAllPending();
  hidePassphraseGate();
  return { key, saltBytes };
}

async function unlockVault() {
  try {
    if (!vaultDoc) {
      alert("No vault found to unlock.");
      return;
    }
    const passphrase = readPassphraseInput();
    if (!passphrase) {
      alert("Enter your master passphrase to unlock.");
      return;
    }
    const { key, saltBytes } = await loadEncryptedProfile(passphrase);
    await handleTrustedDeviceSelection(key, saltBytes);
    setVaultUIState("unlocked");
    hidePassphraseGate();
  } catch (err) {
    console.error("Unlock failed", err);
    alert("Could not unlock vault. Double-check your passphrase.");
  }
}

function resetSettingsForm() {
  settingsNewPassphrase.value = "";
  settingsDisplayName.value = "";
  settingsApiKey.value = "";
  settingsMetadata.value = "";
  settingsFields.style.display = "none";
  setSettingsStatus("", "info");
}

function populateSettingsFields() {
  const payload = decryptedUserPayload || getDefaultUserPayload();
  settingsDisplayName.value = payload.displayName || "";
  settingsApiKey.value = payload.apiKey || "";
  settingsMetadata.value = payload.metadata || "";
  settingsFields.style.display = "block";
}

async function saveSettings() {
  try {
    if (!vaultDoc) {
      alert("Initialize your encrypted profile first.");
      return;
    }
    if (!derivedVaultKey) {
      showPassphraseGate();
      alert("Unlock with your passphrase before saving settings.");
      return;
    }
    const saltBytes = getActiveSaltBytes(vaultDoc);
    if (!saltBytes) {
      alert("Missing vault salt. Reinitialize the vault.");
      return;
    }
    setSettingsStatus("Saving settings...", "info");
    decryptedUserPayload = {
      ...getDefaultUserPayload(),
      ...(decryptedUserPayload || {}),
      displayName: settingsDisplayName.value.trim(),
      apiKey: settingsApiKey.value.trim(),
      metadata: settingsMetadata.value.trim()
    };
    await persistEncryptedPayload(derivedVaultKey, saltBytes);
    settingsFields.style.display = "block";
    setSettingsStatus("Settings saved with updated encryption.", "success");
    alert("Settings saved. Keep your passphrase safe.");
  } catch (err) {
    console.error("Settings save failed", err);
    setSettingsStatus("Could not save settings. Unlock with your passphrase and try again.", "error");
    alert("Could not save settings. Please try again.");
  }
}

async function reencryptQuizDocs(oldKey, newKey, newSalt, missingCollections) {
  const user = auth.currentUser;
  if (!user) return null;
  const quizRef = doc(db, "quizzes", user.uid);
  const snap = await getDoc(quizRef);
  if (!snap.exists()) {
    missingCollections.push("quizzes");
    return null;
  }
  const data = snap.data();
  if (!data.ciphertext) {
    missingCollections.push("quizzes-unencrypted");
    return null;
  }
  const decrypted = await decryptSecret(data, oldKey);
  const serialized = attachVersionMetadata(decrypted, "quizzes-reencrypt");
  const encrypted = await encryptSecret(serialized, newKey, newSalt);
  await setDoc(quizRef, encrypted);
  return encrypted;
}

async function rotatePassphrase() {
  try {
    if (!vaultDoc) {
      alert("Nothing to rotate yet. Initialize your vault first.");
      return;
    }
    const user = auth.currentUser;
    if (!user) return;
    if (!derivedVaultKey) {
      showPassphraseGate();
      alert("Unlock with your passphrase to rotate it.");
      return;
    }
    const newPass = settingsNewPassphrase.value.trim();
    if (newPass.length < 12) {
      alert("Choose a stronger new passphrase (at least 12 characters).");
      return;
    }
    setSettingsStatus("Deriving new encryption key...", "info");
    const { key: newKey, salt: newSalt } = await deriveKeyFromPassphrase(newPass);
    setSettingsStatus("Re-encrypting profile and progress...", "info");

    const updatedVaultPayload = await encryptSecret(serializeUserPayload(), newKey, newSalt);
    const updatedProgressPayload = await encryptSecret(serializeLessonProgress(), newKey, newSalt);
    const missingCollections = [];
    let updatedQuizPayload = null;

    try {
      updatedQuizPayload = await reencryptQuizDocs(derivedVaultKey, newKey, newSalt, missingCollections);
      if (updatedQuizPayload) setSettingsStatus("Re-encrypted quiz history.", "info");
    } catch (err) {
      console.error("Quiz re-encryption failed", err);
      missingCollections.push("quizzes-error");
      setSettingsStatus("Quiz data could not be re-encrypted.", "error");
    }

    setSettingsStatus("Committing rotated keys...", "info");

    await runTransaction(db, async tx => {
      tx.set(doc(db, "userData", user.uid), updatedVaultPayload);
      tx.set(doc(db, "lessonProgress", user.uid), updatedProgressPayload);
      if (updatedQuizPayload) tx.set(doc(db, "quizzes", user.uid), updatedQuizPayload);
    });

    setDerivedVaultKeyContext(newKey, newSalt);
    vaultDoc = updatedVaultPayload;
    encryptedLessonProgressPayload = updatedProgressPayload;
    pendingEncryptedProgressPayload = null;
    settingsNewPassphrase.value = "";

    if (gateTrustedDevice && gateTrustedDevice.checked) {
      await persistTrustedCache(newKey, newSalt);
    }

    await logMigrationMetadata(user, {
      lastRotationAt: new Date().toISOString(),
      missingCollections
    });

    const statusNote = missingCollections.length
      ? `Rotation complete. Missing collections: ${missingCollections.join(", ")}`
      : "Passphrase rotated and data re-encrypted.";
    setSettingsStatus(statusNote, missingCollections.length ? "info" : "success");
    alert("Passphrase rotated. You must remember the new passphrase to keep access.");

    setVaultUIState("locked");
    showPassphraseGate();
  } catch (err) {
    console.error("Passphrase rotation failed", err);
    setSettingsStatus("Could not rotate passphrase. No changes were applied.", "error");
    alert("Could not rotate passphrase. Confirm your passphrase and try again. If the old passphrase was incorrect, no data was changed.");
  }
}

async function resetEncryptedAccount() {
  try {
    if (!vaultDoc) {
      alert("No encrypted data to reset.");
      return;
    }
    const confirmed = confirm("This will delete your encrypted data and progress. Continue?");
    if (!confirmed) return;
    const user = auth.currentUser;
    if (!user) return;
    const missingCollections = [];
    setSettingsStatus("Deleting encrypted documents...", "info");
    await deleteDoc(doc(db, "userData", user.uid));
    await deleteDoc(doc(db, "lessonProgress", user.uid));
    try {
      await deleteDoc(doc(db, "quizzes", user.uid));
    } catch (err) {
      console.error("Quiz deletion failed", err);
      missingCollections.push("quizzes-error");
    }
    await deleteDoc(doc(db, "userMetadata", user.uid));
    clearVaultState();
    lessonProgress = { lessons: {}, notes: {} };
    profileVersionInfo = buildVersionInfo("profile-reset");
    progressVersionInfo = buildVersionInfo("lesson-progress-reset");
    setQuizStatus("Quiz history cleared from your vault.", "info");
    setVaultUIState("setup");
    await logMigrationMetadata(user, {
      lastResetAt: new Date().toISOString(),
      missingCollections
    });
    setSettingsStatus("Encrypted data cleared. Defaults restored.", "success");
    showPassphraseGate();
    alert("Encrypted profile reset. Set up a new passphrase to start again.");
  } catch (err) {
    console.error("Reset failed", err);
    setSettingsStatus("Could not reset encrypted data.", "error");
    alert("Could not reset encrypted data. Try again.");
  }
}

async function loadCourses() {
  try {
    const r = await fetch("lessons.json");
    if (!r.ok) throw new Error("Could not load lessons.json");
    return await r.json();
  } catch (e) {
    console.error("Error fetching lessons.json:", e);
    return [];
  }
}

async function updateAllCourseStatuses(cs) {
  const tasks = cs.map(async c => {
    try {
      const resp = await fetch(c.file);
      if (!resp.ok) throw new Error("Could not load " + c.file);
      const yText = await resp.text();
      const data = jsyaml.load(yText);
      if (data && data.course && Array.isArray(data.course.lessons)) {
        const total = data.course.lessons.length;
        const completed = data.course.lessons.filter(l => {
          const lbl = l.title || "Lesson " + l.lesson_id;
          return isLessonChecked(c.file, lbl);
        }).length;
        c._status = computeCourseStatus(completed, total);
      } else c._status = "N/A";
    } catch (err) {
      console.error("Error fetching YAML for", c.file, err);
      c._status = "N/A";
    }
  });
  await Promise.all(tasks);
}

async function refreshCourseStatuses() {
  await updateAllCourseStatuses(allCourses);
  renderCourses(allCourses);
}

function computeCourseStatus(cmp, tot) {
  if (tot === 0) return "N/A";
  if (cmp === 0) return "Not Started";
  if (cmp === tot) return "Complete";
  return "In Progress";
}

function renderCourses(cs) {
  const cl = document.getElementById("courseList");
  cl.innerHTML = "";
  cs.forEach(cr => {
    const d = document.createElement("div");
    d.classList.add("course-card");
    let st = "n-a";
    if (cr._status) st = cr._status.toLowerCase().replace(/\s+/g, "-");
    d.innerHTML =
      "<h3>" +
      cr.title +
      "</h3><p>Course ID: " +
      cr.id +
      "</p><p class='course-status " +
      st +
      "'>" +
      (cr._status || "N/A") +
      "</p><button data-file='" +
      cr.file +
      "'>View Lessons</button>";
    cl.appendChild(d);
  });
}

function filterCourses(cs, q) {
  return cs.filter(c => c.title.toLowerCase().includes(q.toLowerCase()));
}

async function handleViewLessons(p) {
  try {
    if (!auth.currentUser) {
      alert("Please sign in to access this lesson.");
      return;
    }
    if (!derivedVaultKey) {
      showPassphraseGate();
      alert("Unlock with your passphrase to view lessons.");
      return;
    }
    const resp = await fetch(p);
    if (!resp.ok) throw new Error("Unable to load YAML file: " + p);
    const y = await resp.text();
    const cd = jsyaml.load(y);
    currentCourseData = cd;
    currentCoursePath = p;
    currentLessonSelection = null;
    setActiveSection("lessons");
    updateQuizContext();
    showCourseContent(cd, p);
  } catch (e) {
    console.error("Error fetching YAML:", e);
  }
}

function showCourseContent(cd, fp) {
  if (!cd || !cd.course) return;
  setActiveSection("lessons");
  updateQuizContext();
  setQuizStatus("");
  const cObj = cd.course;
  const container = document.getElementById("lessonsContainer");
  const cTitle = document.getElementById("selectedCourseTitle");
  const cDesc = document.getElementById("selectedCourseDesc");
  const lList = document.getElementById("lessonList");
  const lContent = document.getElementById("lessonContent");
  const lProgress = document.getElementById("lessonProgress");
  container.style.display = "block";
  cTitle.textContent = cObj.title || "Untitled Course";
  cDesc.textContent = cObj.description || "";
  lList.innerHTML = "";
  lContent.innerHTML = "<p style='color:#999;'>Select a lesson on the left to see details here.</p>";
  const lessonItems = [];
  (cObj.lessons || []).forEach(lesson => {
    const lbl = lesson.title || "Lesson " + lesson.lesson_id;
    if (lesson.section && !document.getElementById("section-" + lesson.section)) {
      const s = document.createElement("h4");
      s.id = "section-" + lesson.section;
      s.classList.add("title-text");
      s.textContent = lesson.section;
      lList.appendChild(s);
    }
    const li = document.createElement("li");
    if (isLessonChecked(fp, lbl)) li.classList.add("completed");
    const icon = lesson.type ? getLessonIcon(lesson.type) : '<i class="fas fa-file-alt"></i>';
    li.innerHTML =
      "<div class='icon-area'>" +
      icon +
      "</div><div class='lesson-title'>" +
      lbl +
      "</div><div class='hover-checkbox'><input type='checkbox'" +
      (isLessonChecked(fp, lbl) ? " checked" : "") +
      " /></div>";
    li.addEventListener("click", e => {
      if (!e.target.closest(".hover-checkbox")) {
        if (!auth.currentUser && fp !== defaultGuidePath && lbl !== "Getting Started") {
          alert("Please sign in to access this lesson.");
          return;
        }
        document.querySelectorAll("#lessonList li").forEach(n => n.classList.remove("active"));
        li.classList.add("active");
        displayLessonContent(lesson);
      }
    });
    const cb = li.querySelector(".hover-checkbox input[type='checkbox']");
    cb.addEventListener("change", async () => {
      const desiredState = cb.checked;
      toggleLessonChecked(fp, lbl, desiredState);
      li.classList.toggle("completed", desiredState);
      updateProgress(fp);
      try {
        const saved = await persistUserProgress();
        if (saved === false) {
          cb.checked = !desiredState;
          toggleLessonChecked(fp, lbl, cb.checked);
          li.classList.toggle("completed", cb.checked);
          updateProgress(fp);
          return;
        }
      } catch (err) {
        console.error("Progress save failed", err);
        cb.checked = !desiredState;
        toggleLessonChecked(fp, lbl, cb.checked);
        li.classList.toggle("completed", cb.checked);
        updateProgress(fp);
        const retry = confirm("Could not save progress. Re-enter your passphrase to retry?");
        if (retry) {
          try {
            await persistUserProgress();
          } catch (err2) {
            console.error("Retry failed", err2);
            alert("Progress not synced. Unlock with your passphrase and try again.");
          }
        }
      }
    });
    if (!auth.currentUser && fp !== defaultGuidePath && lbl !== "Getting Started") li.classList.add("locked");
    lList.appendChild(li);
    lessonItems.push({ label: lbl, element: li, lesson });
  });
  function updateProgress(path) {
    const tot = (cObj.lessons || []).length;
    const comp = (cObj.lessons || []).filter(ls => isLessonChecked(path, ls.title || "Lesson " + ls.lesson_id)).length;
    lProgress.textContent = "Completed " + comp + " / " + tot + " lessons";
    let status = "";
    if (comp === 0) status = "(not-started)";
    else if (comp === tot) status = "(complete)";
    else status = "(in-progress)";
    cTitle.textContent = (cObj.title || "Untitled Course") + " " + status;
    updateCourseCardStatus(path);
  }
  updateProgress(fp);
  if (noteFocusTarget && noteFocusTarget.coursePath === fp) {
    const target = lessonItems.find(item => item.label === noteFocusTarget.lessonTitle);
    if (target) {
      document.querySelectorAll("#lessonList li").forEach(n => n.classList.remove("active"));
      target.element.classList.add("active");
      displayLessonContent(target.lesson);
      target.element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
}

function displayLessonContent(lsn) {
  const el = document.getElementById("lessonContent");
  el.innerHTML = "";
  const title = lsn.title || "Lesson " + lsn.lesson_id;
  currentLessonSelection = { title, coursePath: currentCoursePath, lesson: lsn };
  updateQuizContext();
  setQuizStatus("");
  const h = document.createElement("h1");
  h.textContent = title;
  el.appendChild(h);
  const hr = document.createElement("hr");
  el.appendChild(hr);
  if (lsn.course) {
    const n = document.createElement("div");
    n.innerHTML = marked.parse(lsn.course);
    el.appendChild(n);
  }
  if (lsn.exercises && Array.isArray(lsn.exercises) && lsn.exercises.length) {
    const exH = document.createElement("h2");
    exH.textContent = "Exercises:";
    el.appendChild(exH);
    let m = "\n";
    lsn.exercises.forEach((ex, i) => {
      m += i + 1 + ". **" + ex.name + "** – " + ex.prompt + "\n";
    });
    const d = document.createElement("div");
    d.innerHTML = marked.parse(m);
    el.appendChild(d);
  }
  if (lsn.assignments && Array.isArray(lsn.assignments) && lsn.assignments.length) {
    const asH = document.createElement("h2");
    asH.textContent = "Assignments:";
    el.appendChild(asH);
    let m = "\n";
    lsn.assignments.forEach((a, i) => {
      m += i + 1 + ". **" + a.name + "** – " + a.description + "\n";
    });
    const d = document.createElement("div");
    d.innerHTML = marked.parse(m);
    el.appendChild(d);
  }
  if (lsn.sources && Array.isArray(lsn.sources) && lsn.sources.length) {
    const srcH = document.createElement("h2");
    srcH.textContent = "Sources:";
    el.appendChild(srcH);
    let m = "\n";
    lsn.sources.forEach((s, i) => {
      m += i + 1 + ". " + s + "\n";
    });
    const d = document.createElement("div");
    d.innerHTML = marked.parse(m);
    el.appendChild(d);
  }
  const notesWrapper = document.createElement("div");
  notesWrapper.className = "lesson-notes";
  const notesHeading = document.createElement("h3");
  notesHeading.textContent = "Your notes";
  const noteHint = document.createElement("p");
  noteHint.className = "settings-note";
  noteHint.textContent = "Notes are encrypted with your passphrase and saved per lesson. Use New note to append another entry.";
  const noteField = document.createElement("textarea");
  const latestNote = getLatestLessonNote(currentCoursePath, title);
  noteField.value = latestNote?.text || "";
  if (latestNote?.id) noteField.dataset.noteId = latestNote.id;
  noteField.placeholder = "Add private notes for this lesson.";
  const notePreview = document.createElement("div");
  notePreview.className = "note-preview";
  const notePreviewContent = document.createElement("div");
  notePreviewContent.className = "note-preview-body";
  notePreview.appendChild(notePreviewContent);
  const noteModeActions = document.createElement("div");
  noteModeActions.className = "note-actions note-mode";
  const editModeBtn = document.createElement("button");
  editModeBtn.textContent = "Edit";
  const previewModeBtn = document.createElement("button");
  previewModeBtn.textContent = "Preview";
  noteModeActions.appendChild(editModeBtn);
  noteModeActions.appendChild(previewModeBtn);
  const noteActions = document.createElement("div");
  noteActions.className = "note-actions";
  const newNoteBtn = document.createElement("button");
  newNoteBtn.textContent = "New note";
  newNoteBtn.addEventListener("click", () => {
    noteField.value = "";
    noteField.dataset.noteId = "";
    noteField.focus();
    applyNoteMode(getNoteMode(currentCoursePath, title, ""), "");
  });
  const saveNoteBtn = document.createElement("button");
  saveNoteBtn.textContent = "Save notes";
  saveNoteBtn.addEventListener("click", async () => {
    if (!auth.currentUser) {
      alert("Sign in before saving notes.");
      return;
    }
    if (!derivedVaultKey) {
      showPassphraseGate();
      alert("Unlock with your passphrase before saving notes.");
      return;
    }
    const noteId = noteField.dataset.noteId || "";
    const entry = upsertLessonNote(currentCoursePath, title, noteField.value, noteId);
    try {
      await persistUserProgress();
      noteField.dataset.noteId = entry.id;
      applyNoteMode(currentNoteMode, entry.id);
      renderNotesSummary();
      saveNoteBtn.textContent = "Saved";
      setTimeout(() => (saveNoteBtn.textContent = "Save notes"), 1500);
    } catch (err) {
      console.error("Note save failed", err);
      alert("Could not save notes. Unlock with your passphrase and try again.");
    }
  });
  let currentNoteMode = getNoteMode(currentCoursePath, title, noteField.dataset.noteId || "");
  function renderNotePreview() {
    const noteContent = noteField.value.trim();
    if (!noteContent) {
      notePreviewContent.innerHTML = '<p class="note-empty">No content to preview yet.</p>';
      return;
    }
    notePreviewContent.innerHTML = sanitizeHtml(marked.parse(noteContent));
  }
  function applyNoteMode(mode, noteIdOverride = null) {
    currentNoteMode = mode;
    const activeNoteId = noteIdOverride !== null ? noteIdOverride : noteField.dataset.noteId || "";
    setNoteMode(currentCoursePath, title, activeNoteId, mode);
    editModeBtn.classList.toggle("active", mode === "edit");
    previewModeBtn.classList.toggle("active", mode === "preview");
    noteField.style.display = mode === "edit" ? "block" : "none";
    notePreview.style.display = mode === "preview" ? "block" : "none";
    if (mode === "preview") {
      renderNotePreview();
    }
  }
  noteField.addEventListener("input", () => {
    if (currentNoteMode === "preview") {
      renderNotePreview();
    }
  });
  editModeBtn.addEventListener("click", () => applyNoteMode("edit"));
  previewModeBtn.addEventListener("click", () => applyNoteMode("preview"));
  applyNoteMode(currentNoteMode);
  noteActions.appendChild(newNoteBtn);
  noteActions.appendChild(saveNoteBtn);
  notesWrapper.appendChild(notesHeading);
  notesWrapper.appendChild(noteHint);
  notesWrapper.appendChild(noteModeActions);
  notesWrapper.appendChild(noteField);
  notesWrapper.appendChild(notePreview);
  notesWrapper.appendChild(noteActions);
  if (
    noteFocusTarget &&
    noteFocusTarget.coursePath === currentCoursePath &&
    noteFocusTarget.lessonTitle === title
  ) {
    const focusedEntry = getLessonNoteEntries(currentCoursePath, title).find(
      n => n.id === noteFocusTarget.noteId
    );
    if (focusedEntry) {
      noteField.value = focusedEntry.text || focusedEntry.summary || "";
      noteField.dataset.noteId = focusedEntry.id;
      applyNoteMode(getNoteMode(currentCoursePath, title, focusedEntry.id), focusedEntry.id);
    }
    notesWrapper.classList.add("note-highlight");
    notesWrapper.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => notesWrapper.classList.remove("note-highlight"), 1800);
    noteFocusTarget = null;
  }
  renderNotePreview();
  el.appendChild(notesWrapper);
  if (isMobileViewport()) {
    setMobileSidebarOpen(false);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function buildLessonContext(selection) {
  const course = currentCourseData?.course || {};
  const lesson = selection.lesson || {};
  const base = [
    `Course Title: ${course.title || "Untitled"}`,
    course.description ? `Course Description: ${course.description}` : null,
    `Lesson Title: ${lesson.title || selection.title}`,
    lesson.course ? `Lesson Overview: ${lesson.course}` : null
  ].filter(Boolean);
  const exercises = Array.isArray(lesson.exercises)
    ? lesson.exercises
        .map(ex => `${ex.name || "Exercise"}: ${ex.prompt || ex.description || ""}`)
        .filter(Boolean)
    : [];
  const assignments = Array.isArray(lesson.assignments)
    ? lesson.assignments.map(a => `${a.name || "Assignment"}: ${a.description || ""}`).filter(Boolean)
    : [];
  const sources = Array.isArray(lesson.sources) ? lesson.sources.filter(Boolean) : [];
  if (exercises.length) base.push(`Exercises: ${exercises.join(" | ")}`);
  if (assignments.length) base.push(`Assignments: ${assignments.join(" | ")}`);
  if (sources.length) base.push(`Sources: ${sources.join(", ")}`);
  return base.join("\n");
}

async function generateQuizWithOpenAI(selection) {
  const apiKey = (decryptedUserPayload || {}).apiKey;
  if (!apiKey) {
    throw new Error("Add your OpenAI API key in Settings before generating quizzes.");
  }
  const now = new Date().toISOString();
  const quizId = crypto.randomUUID ? crypto.randomUUID() : `quiz-${Date.now()}`;
  const context = buildLessonContext(selection);
  const prompt = [
    "You are a tutor generating reflective quiz questions for a student.",
    "Create concise, open-ended questions that reference the supplied lesson context.",
    "Return a JSON object with keys: id (string), status (string), metadata (object), questions (array of {prompt, detail}).",
    "Metadata should include lessonTitle, courseTitle, createdAt, and questionCount.",
    "Respond ONLY with valid JSON."
  ].join(" \n");
  const userMessage = `Lesson context:\n${context}\nGenerate 5 thoughtful questions tailored to this lesson.`;
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: userMessage }
      ],
      response_format: { type: "json_object" }
    })
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`OpenAI request failed: ${resp.status} ${detail}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned an empty response.");
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.error("Could not parse quiz JSON", content);
    throw new Error("OpenAI response was not valid JSON.");
  }
  const lesson = selection.lesson || {};
  const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
  return {
    id: parsed.id || quizId,
    metadata: {
      lessonTitle: selection.title,
      lessonId: lesson.lesson_id || selection.title,
      courseTitle: currentCourseData?.course?.title || "",
      coursePath: selection.coursePath,
      createdAt: parsed?.metadata?.createdAt || now,
      status: parsed?.metadata?.status || parsed.status || "generated",
      questionCount: parsed?.metadata?.questionCount || questions.length
    },
    questions,
    status: parsed.status || "generated"
  };
}

async function startQuizGeneration() {
  if (!quizStatus) return;
  if (!auth.currentUser) {
    alert("Please sign in to generate quizzes.");
    setQuizStatus("Sign in to generate quizzes.", "error");
    return;
  }
  if (!derivedVaultKey) {
    showPassphraseGate();
    setQuizStatus("Unlock with your passphrase to generate quizzes.", "error");
    return;
  }
  if (!currentLessonSelection) {
    setQuizStatus("Open a lesson in the Lessons page before generating a quiz.", "error");
    return;
  }
  setQuizStatus(`Starting quiz generation for ${currentLessonSelection.title}...`, "info");
  const previousQuizzes = Array.isArray(quizStore?.quizzes) ? [...quizStore.quizzes] : [];
  try {
    setQuizStatus(`Contacting OpenAI with ${currentLessonSelection.title}...`, "info");
    const quiz = await generateQuizWithOpenAI(currentLessonSelection);
    const existing = Array.isArray(quizStore?.quizzes) ? quizStore.quizzes.filter(q => q.id !== quiz.id) : [];
    quizStore.quizzes = [quiz, ...existing];
    activeQuizId = quiz.id;
    setQuizStatus(`Encrypting and saving quiz for ${currentLessonSelection.title}...`, "info");
    const saved = await persistQuizStore();
    if (!saved) {
      quizStore.quizzes = previousQuizzes;
      activeQuizId = previousQuizzes[0]?.id || null;
      renderQuizList();
      return;
    }
    setQuizStatus(`Quiz saved for ${currentLessonSelection.title}.`, "success");
    renderQuizList();
  } catch (err) {
    console.error("Quiz generation failed", err);
    quizStore.quizzes = previousQuizzes;
    activeQuizId = previousQuizzes[0]?.id || null;
    renderQuizList();
    const message = err?.message
      ? `Could not generate quiz: ${err.message}`
      : "Could not generate or save the quiz. Unlock with your passphrase and try again.";
    setQuizStatus(message, "error");
  }
}

function updateCourseCardStatus(p) {
  const co = allCourses.find(c => c.file === p);
  if (!co || !currentCourseData.course) return;
  const tot = (currentCourseData.course.lessons || []).length;
  const comp = (currentCourseData.course.lessons || []).filter(l =>
    isLessonChecked(p, l.title || "Lesson " + l.lesson_id)
  ).length;
  co._status = computeCourseStatus(comp, tot);
  const card = document
    .querySelector(".course-card button[data-file='" + p + "']")
    ?.closest(".course-card");
  if (card) {
    const st = card.querySelector(".course-status");
    if (st) {
      st.classList.remove("not-started", "in-progress", "complete", "n-a");
      st.textContent = co._status;
      const cls = co._status.toLowerCase().replace(/\s+/g, "-");
      st.classList.add(cls);
    }
  }
}

function toggleSidebar() {
  const sb = document.getElementById("lessonSidebar");
  const lo = document.getElementById("lessonLayout");
  if (!sb || !lo) return;
  if (isMobileViewport()) {
    setMobileSidebarOpen(!isSidebarOpen);
    return;
  }
  isSidebarCollapsed = !isSidebarCollapsed;
  if (isSidebarCollapsed) {
    sb.classList.add("collapsed");
    lo.classList.add("collapsed");
  } else {
    sb.classList.remove("collapsed");
    lo.classList.remove("collapsed");
  }
}

gateUnlockBtn?.addEventListener("click", unlockVault);
gateInitializeBtn?.addEventListener("click", initializeVault);
gateGenerateBtn?.addEventListener("click", () => {
  const generated = generatePassphrase();
  gatePassphraseInput.value = generated;
  alert("Passphrase generated. Copy it and store it somewhere safe.");
});

openSettingsBtn?.addEventListener("click", e => {
  e.preventDefault();
  setActiveSection("settings");
  if (!derivedVaultKey) {
    resetSettingsForm();
    updateSettingsSectionState();
    showPassphraseGate();
    return;
  }
  updateSettingsSectionState();
});

saveSettingsBtn?.addEventListener("click", saveSettings);
rotatePassphraseBtn?.addEventListener("click", rotatePassphrase);
resetAccountBtn?.addEventListener("click", resetEncryptedAccount);

document.addEventListener("DOMContentLoaded", async () => {
  updateStickyHeights();
  allCourses = await loadCourses();
  await refreshCourseStatuses();
  setActiveSection("home");
  updateQuizContext();
  renderNotesSummary();
  document.getElementById("courseSearch")?.addEventListener("input", e => {
    renderCourses(filterCourses(allCourses, e.target.value));
  });
  quizLessonFilter?.addEventListener("input", renderQuizList);
  document.addEventListener("click", e => {
    const b = e.target;
    if (b.tagName === "BUTTON" && b.hasAttribute("data-file")) {
      handleViewLessons(b.getAttribute("data-file"));
    }
  });
  Object.entries(navLinks).forEach(([section, link]) => {
    if (!link) return;
    link.addEventListener("click", e => {
      e.preventDefault();
      if (section === "lessons" && !currentCoursePath) {
        setActiveSection("lessons");
        updateQuizContext("Select a course from Home to view lessons.");
        return;
      }
      if (section === "settings") {
        setActiveSection("settings");
        updateSettingsSectionState();
        if (!derivedVaultKey) {
          showPassphraseGate();
        }
        return;
      }
      setActiveSection(section);
      if (section === "quizzes") {
        updateQuizContext();
        renderQuizList();
      }
    });
  });
  resetSidebarForViewport();
  sidebarToggleButton?.addEventListener("click", toggleSidebar);
  mobileSidebarToggle?.addEventListener("click", toggleSidebar);
  sidebarOverlay?.addEventListener("click", () => setMobileSidebarOpen(false));
  if (mobileBreakpoint?.addEventListener) {
    mobileBreakpoint.addEventListener("change", resetSidebarForViewport);
  } else if (mobileBreakpoint?.addListener) {
    mobileBreakpoint.addListener(resetSidebarForViewport);
  }
  window.addEventListener("resize", updateStickyHeights);
  document.addEventListener("keyup", e => {
    if (e.key === "Escape" && isMobileViewport() && isSidebarOpen) {
      setMobileSidebarOpen(false);
    }
  });
  generateQuizBtn?.addEventListener("click", startQuizGeneration);
});
