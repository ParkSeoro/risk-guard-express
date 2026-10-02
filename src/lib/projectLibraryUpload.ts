/** Matches project_library_files insert policy: master, project admin, or safety manager. */
export function canUploadProjectLibrary(role: string | null | undefined): boolean {
  return role === "master" || role === "project_admin" || role === "safety_manager";
}
