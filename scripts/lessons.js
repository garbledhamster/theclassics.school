export const defaultGuidePath = "lessons/0000_HowToUseThisSite.yaml";

export async function loadCourses() {
  try {
    const response = await fetch("lessons.json");
    if (!response.ok) throw new Error("Could not load lessons.json");
    return await response.json();
  } catch (err) {
    console.error("Error fetching lessons.json:", err);
    return [];
  }
}

export async function updateAllCourseStatuses(courses, isLessonChecked) {
  const tasks = courses.map(async course => {
    try {
      const resp = await fetch(course.file);
      if (!resp.ok) throw new Error("Could not load " + course.file);
      const yamlText = await resp.text();
      const data = jsyaml.load(yamlText);
      if (data && data.course && Array.isArray(data.course.lessons)) {
        const total = data.course.lessons.length;
        const completed = data.course.lessons.filter(lesson => {
          const label = lesson.title || "Lesson " + lesson.lesson_id;
          return isLessonChecked(course.file, label);
        }).length;
        course._status = computeCourseStatus(completed, total);
      } else {
        course._status = "N/A";
      }
    } catch (err) {
      console.error("Error fetching YAML for", course.file, err);
      course._status = "N/A";
    }
  });
  await Promise.all(tasks);
}

export function computeCourseStatus(completed, total) {
  if (total === 0) return "N/A";
  if (completed === 0) return "Not Started";
  if (completed === total) return "Complete";
  return "In Progress";
}

export function filterCourses(courses, query) {
  return courses.filter(course => course.title.toLowerCase().includes(query.toLowerCase()));
}

