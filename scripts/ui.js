const mobileBreakpoint = window.matchMedia("(max-width: 1024px)");

export function isMobileViewport() {
  return mobileBreakpoint.matches;
}

export function getMobileBreakpoint() {
  return mobileBreakpoint;
}

export function updateStickyHeights() {
  const root = document.documentElement;
  const header = document.querySelector("header");
  const nav = document.querySelector(".primary-nav");
  const headerHeight = header?.offsetHeight || 0;
  const navHeight = nav?.offsetHeight || 0;
  const safeAreaBottom = Number.parseFloat(getComputedStyle(root).getPropertyValue("--safe-area-bottom")) || 0;
  const navTotalHeight = navHeight || safeAreaBottom;
  const navContribution = isMobileViewport() ? 0 : navHeight;
  const stackHeight = headerHeight + navContribution;
  root.style.setProperty("--nav-height", `${navHeight}px`);
  root.style.setProperty("--content-bottom-offset", `${navTotalHeight}px`);
  root.style.setProperty("--nav-offset", `${navContribution}px`);
  root.style.setProperty("--header-height", `${headerHeight}px`);
  root.style.setProperty("--header-stack-height", `${stackHeight}px`);
  root.style.setProperty("--sticky-offset", `${stackHeight}px`);
}

export function scheduleStickyHeightUpdate() {
  requestAnimationFrame(updateStickyHeights);
}

export function updateMobileChromeVisibility(currentSection) {
  const shouldHideHeader = isMobileViewport() && currentSection !== "home";
  document.body?.classList.toggle("mobile-hide-header", shouldHideHeader);
  scheduleStickyHeightUpdate();
}

export function applyMobileSidebarOpen(open) {
  const sidebar = document.getElementById("lessonSidebar");
  const sidebarOverlay = document.getElementById("sidebarOverlay");
  const mobileSidebarToggle = document.getElementById("mobileSidebarToggle");
  const layout = document.getElementById("lessonLayout");
  if (layout) layout.classList.remove("collapsed");
  sidebar?.classList.toggle("mobile-open", open);
  sidebarOverlay?.classList.toggle("active", open);
  document.body?.classList.toggle("sidebar-locked", open);
  mobileSidebarToggle?.setAttribute("aria-expanded", open ? "true" : "false");
  if (!open && sidebar) {
    sidebar.scrollTop = 0;
  }
}

export function resetSidebarForViewport() {
  updateStickyHeights();
  const sidebar = document.getElementById("lessonSidebar");
  const layout = document.getElementById("lessonLayout");
  if (!sidebar || !layout) return;
  if (isMobileViewport()) {
    layout.classList.remove("collapsed");
    sidebar.classList.remove("collapsed");
    applyMobileSidebarOpen(false);
    return;
  }
  applyMobileSidebarOpen(false);
  sidebar.classList.remove("mobile-open");
  layout.classList.remove("collapsed");
}

export function renderCourseCards(container, courses) {
  if (!container) return;
  container.innerHTML = "";
  courses.forEach(course => {
    const wrapper = document.createElement("div");
    wrapper.classList.add("course-card");
    let statusClass = "n-a";
    if (course._status) statusClass = course._status.toLowerCase().replace(/\s+/g, "-");
    wrapper.innerHTML =
      "<h3>" +
      course.title +
      "</h3><p>Course ID: " +
      course.id +
      "</p><p class='course-status " +
      statusClass +
      "'>" +
      (course._status || "N/A") +
      "</p><button data-file='" +
      course.file +
      "'>View Lessons</button>";
    container.appendChild(wrapper);
  });
}

export function renderLessonContentEmptyState(currentCourseData, allCourses) {
  const lessonContent = document.getElementById("lessonContent");
  if (!lessonContent) return;
  lessonContent.innerHTML = "";
  if (currentCourseData?.course) {
    const prompt = document.createElement("p");
    prompt.classList.add("lesson-placeholder");
    prompt.textContent = "Select a lesson on the left to see details here.";
    lessonContent.appendChild(prompt);
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.classList.add("lesson-empty-state");
  const title = document.createElement("h3");
  title.textContent = "Choose a course to begin";
  const helper = document.createElement("p");
  helper.textContent = "Pick a course below to load its lessons.";
  wrapper.appendChild(title);
  wrapper.appendChild(helper);
  lessonContent.appendChild(wrapper);

  const courseGrid = document.createElement("div");
  courseGrid.classList.add("course-list");
  courseGrid.id = "lessonCourseList";
  lessonContent.appendChild(courseGrid);
  renderCourseCards(courseGrid, allCourses);
}

export function updateLessonLayoutVisibility(hasCourse) {
  const layout = document.getElementById("lessonLayout");
  const sidebar = document.getElementById("lessonSidebar");
  const container = document.getElementById("lessonsContainer");
  if (!layout || !sidebar) return;
  if (container) container.style.display = "block";
  layout.classList.toggle("no-course", !hasCourse);
  sidebar.style.display = hasCourse ? "" : "none";
  layout.style.display = "block";
}

